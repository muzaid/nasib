"""Layer 1 — is this a real, unique human?

Ordered by cost. Phone and device screening removes a meaningful share of
fraudulent signups for a fraction of a cent, before a single liveness
check is paid for.
"""

from __future__ import annotations

from ..models import Applicant, CheckOutcome, CheckResult, CheckType, Finding
from .base import Check, CheckContext

# Cosine similarity thresholds. Tune these from the review desk's own
# rulings — the first months of human decisions are the training set.
SAME_PERSON = 0.62
DUPLICATE_ACCOUNT = 0.78
BANNED_MATCH = 0.75


class PhoneCheck(Check):
    """Throwaway numbers and bulk signup. Cheapest filter, runs first."""

    type = CheckType.PHONE
    stage = 0
    cost_usd = 0.02

    async def run(self, applicant: Applicant, ctx: CheckContext) -> CheckOutcome:
        intel = await ctx.vendors["phone"].lookup(applicant.phone_e164)
        findings: list[Finding] = []
        hard_fail = False

        if intel.get("disposable") or intel.get("line_type") == "voip":
            findings.append(Finding(
                code="disposable_number",
                detail=f"Number is {intel.get('line_type')} on {intel.get('carrier')}.",
                severity="high",
            ))
            hard_fail = True

        risk = float(intel.get("risk", 0.0))
        return CheckOutcome(
            type=self.type,
            result=CheckResult.FAIL if hard_fail else CheckResult.PASS,
            score=1.0 - risk,
            vendor=ctx.vendors["phone"].name,
            findings=findings,
            details=intel,
            cost_usd=self.cost_usd,
            hard_fail=hard_fail,
        )


class DeviceCheck(Check):
    """Emulators, rooted devices, and registration farms."""

    type = CheckType.DEVICE
    stage = 0
    cost_usd = 0.01

    def applies_to(self, applicant: Applicant, ctx: CheckContext) -> bool:
        return applicant.device is not None

    async def run(self, applicant: Applicant, ctx: CheckContext) -> CheckOutcome:
        d = applicant.device
        assert d is not None
        findings: list[Finding] = []
        hard_fail = False

        if d.is_emulator:
            findings.append(Finding(code="emulator", detail="Running on an emulator.", severity="high"))
            hard_fail = True
        if d.integrity_verdict in {"FAIL", "UNEVALUATED"}:
            findings.append(Finding(
                code="integrity_failed",
                detail=f"Platform attestation returned {d.integrity_verdict}.",
                severity="high",
            ))
            hard_fail = True
        if d.is_rooted:
            findings.append(Finding(code="rooted_device", detail="Device is rooted or jailbroken.",
                                    severity="medium"))
        if d.install_id_seen_count >= 3:
            findings.append(Finding(
                code="device_reuse",
                detail=f"{d.install_id_seen_count} accounts have registered from this device.",
                severity="high",
            ))
            hard_fail = d.install_id_seen_count >= 5

        score = 1.0 - min(1.0, 0.25 * len(findings))
        return CheckOutcome(
            type=self.type,
            result=CheckResult.FAIL if hard_fail else CheckResult.PASS,
            score=score,
            findings=findings,
            details=d.model_dump(),
            cost_usd=self.cost_usd,
            hard_fail=hard_fail,
        )


class LivenessCheck(Check):
    """Photo-of-a-photo, screen replay, masks, injected video.

    A flagged applicant gets a server-issued active challenge instead of
    the passive check — randomised, so a pre-recorded response fails.
    """

    type = CheckType.LIVENESS
    stage = 1
    cost_usd = 0.25

    def applies_to(self, applicant: Applicant, ctx: CheckContext) -> bool:
        return applicant.selfie_path is not None

    async def run(self, applicant: Applicant, ctx: CheckContext) -> CheckOutcome:
        challenge = "turn_head_left,say_4_7_1" if ctx.require_active_challenge else None
        res = await ctx.vendors["liveness"].check(applicant.selfie_path, challenge=challenge)

        findings: list[Finding] = []
        if not res["passed"]:
            spoof = res.get("spoof_type")
            findings.append(Finding(
                code=f"liveness_{spoof or 'low_quality'}",
                detail=(f"Presentation attack detected: {spoof}." if spoof
                        else "Capture quality too low to establish liveness."),
                severity="critical" if spoof else "low",
            ))

        # A genuine bad capture is a retake, not a rejection.
        hard_fail = bool(res.get("spoof_type"))
        result = CheckResult.PASS if res["passed"] else (
            CheckResult.FAIL if hard_fail else CheckResult.INCONCLUSIVE
        )
        return CheckOutcome(
            type=self.type, result=result, score=res["score"],
            vendor=ctx.vendors["liveness"].name, findings=findings,
            details={"challenge": challenge, **res.get("raw", {})},
            cost_usd=self.cost_usd, hard_fail=hard_fail,
        )


class FaceMatchCheck(Check):
    """Are the profile photos the same person as the liveness selfie?"""

    type = CheckType.FACE_MATCH
    stage = 2
    cost_usd = 0.0          # in-house

    def applies_to(self, applicant: Applicant, ctx: CheckContext) -> bool:
        # Superseded by the three-way match when a guided capture exists:
        # that check compares against the centroid of several live frames
        # rather than one uncontrolled selfie, and it names which pair
        # failed. Running both would weigh the same evidence twice.
        if ctx.scratch.get("live_session") is not None:
            return False
        return bool(applicant.selfie_path and applicant.photos)

    async def run(self, applicant: Applicant, ctx: CheckContext) -> CheckOutcome:
        face = ctx.vendors["face"]
        selfie_vec = await face.embed(applicant.selfie_path)
        ctx.scratch["selfie_embedding"] = selfie_vec

        scores: dict[str, float] = {}
        for photo in applicant.photos:
            vec = await face.embed(photo.storage_path)
            scores[str(photo.id)] = await face.compare(selfie_vec, vec)

        worst = min(scores.values())
        mismatched = [pid for pid, s in scores.items() if s < SAME_PERSON]

        findings: list[Finding] = []
        if mismatched:
            findings.append(Finding(
                code="photo_not_applicant",
                detail=(f"{len(mismatched)} of {len(scores)} profile photos do not match the "
                        f"liveness selfie (lowest similarity {worst:.2f})."),
                severity="critical" if len(mismatched) == len(scores) else "high",
            ))

        hard_fail = len(mismatched) == len(scores)
        return CheckOutcome(
            type=self.type,
            result=CheckResult.FAIL if mismatched else CheckResult.PASS,
            score=worst,
            findings=findings,
            details={"per_photo": scores, "threshold": SAME_PERSON, "mismatched": mismatched},
            hard_fail=hard_fail,
        )


class DuplicateFaceCheck(Check):
    """One person with many accounts, and banned users coming back.

    This is what makes a ban stick. It is also the most sensitive thing the
    system stores, which is why embeddings live in their own schema with
    their own key and no readable foreign keys.
    """

    type = CheckType.DUPLICATE_FACE
    stage = 2
    cost_usd = 0.0

    def applies_to(self, applicant: Applicant, ctx: CheckContext) -> bool:
        return "live_embedding" in ctx.scratch or "selfie_embedding" in ctx.scratch

    async def run(self, applicant: Applicant, ctx: CheckContext) -> CheckOutcome:
        index = ctx.vendors["embedding_index"]
        # Prefer the live centroid: it is the same reference the ban list is
        # built from, so a removed account cannot come back simply by doing
        # the camera step instead of uploading a selfie.
        vec = ctx.scratch.get("live_embedding") or ctx.scratch["selfie_embedding"]

        banned = await index.search_banned(vec, BANNED_MATCH)
        if banned:
            return CheckOutcome(
                type=self.type, result=CheckResult.FAIL, score=banned[0][1],
                findings=[Finding(
                    code="banned_user_returning",
                    detail=f"Face matches a removed account (similarity {banned[0][1]:.2f}).",
                    severity="critical",
                )],
                details={"banned_similarity": banned[0][1]},
                hard_fail=True,
            )

        dupes = [
            (uid, s) for uid, s in await index.search_active(vec, DUPLICATE_ACCOUNT)
            if uid != str(applicant.user_id)
        ]
        findings: list[Finding] = []
        if dupes:
            findings.append(Finding(
                code="duplicate_account",
                detail=f"Face matches {len(dupes)} existing account(s); highest {dupes[0][1]:.2f}.",
                severity="high",
            ))
        ctx.scratch["duplicate_accounts"] = [uid for uid, _ in dupes]

        # Score is "confidence this account is unique", so a clean search
        # scores 1.0. Getting this the wrong way round silently caps every
        # honest applicant's identity confidence — worth a comment.
        return CheckOutcome(
            type=self.type,
            result=CheckResult.FAIL if dupes else CheckResult.PASS,
            score=1.0 - (dupes[0][1] if dupes else 0.0),
            findings=findings,
            details={"matches": dupes, "threshold": DUPLICATE_ACCOUNT},
        )


class ReverseImageCheck(Check):
    """Photos lifted from Instagram or a stock library."""

    type = CheckType.REVERSE_IMAGE
    stage = 3
    cost_usd = 0.03

    def applies_to(self, applicant: Applicant, ctx: CheckContext) -> bool:
        return bool(applicant.photos)

    async def run(self, applicant: Applicant, ctx: CheckContext) -> CheckOutcome:
        primary = next((p for p in applicant.photos if p.is_primary), applicant.photos[0])
        res = await ctx.vendors["reverse_image"].search(primary.storage_path)
        matches = res.get("matches", [])
        strong = [m for m in matches if m["similarity"] >= 0.9]

        findings: list[Finding] = []
        if strong:
            findings.append(Finding(
                code="photo_found_elsewhere",
                detail=("Primary photo appears on "
                        + ", ".join(sorted({m['domain'] for m in strong}))
                        + f" (similarity {strong[0]['similarity']:.2f})."),
                severity="high",
            ))

        return CheckOutcome(
            type=self.type,
            result=CheckResult.FAIL if strong else CheckResult.PASS,
            score=1.0 - (strong[0]["similarity"] if strong else 0.0),
            vendor=ctx.vendors["reverse_image"].name,
            findings=findings,
            details={"matches": matches},
            cost_usd=self.cost_usd,
        )


class DocumentCheck(Check):
    """Name, age and — where the document shows it — marital status.

    Optional at the free tier by design. A hard ID requirement at signup
    costs a large share of legitimate women users who are, correctly,
    cautious about handing an ID to a new app. Make the higher tier
    visibly more trusted and let demand pull people up.
    """

    type = CheckType.DOCUMENT
    stage = 4
    cost_usd = 1.60

    def applies_to(self, applicant: Applicant, ctx: CheckContext) -> bool:
        if not applicant.document_path or not applicant.selfie_path:
            return False
        return ctx.require_document or applicant.tier != "bronze"

    async def run(self, applicant: Applicant, ctx: CheckContext) -> CheckOutcome:
        vendor = ctx.vendors["document"]
        if applicant.country_code not in vendor.supported_countries:
            return CheckOutcome(
                type=self.type, result=CheckResult.INCONCLUSIVE,
                vendor=vendor.name,
                findings=[Finding(
                    code="document_country_unsupported",
                    detail=f"No coverage for {applicant.country_code}; needs manual review.",
                    severity="low",
                )],
            )

        res = await vendor.verify(applicant.document_path, applicant.selfie_path)
        findings: list[Finding] = []
        if not res["passed"]:
            findings.append(Finding(
                code="document_failed",
                detail=f"Document check failed: {res.get('raw', {}).get('reason', 'unknown')}.",
                severity="critical",
            ))
        elif res.get("face_match_score", 1.0) < 0.75:
            findings.append(Finding(
                code="document_face_mismatch",
                detail=f"Document portrait does not match the selfie ({res['face_match_score']:.2f}).",
                severity="critical",
            ))

        dob = res.get("fields", {}).get("date_of_birth")
        if dob and dob[:4].isdigit():
            declared, actual = applicant.date_of_birth.year, int(dob[:4])
            if abs(declared - actual) > 1:
                findings.append(Finding(
                    code="age_contradiction",
                    detail=f"Declared birth year {declared}, document shows {actual}.",
                    severity="high",
                ))

        # Retention: only name, date of birth and expiry are kept. The
        # image itself is deleted 7 days after the decision.
        kept = {k: v for k, v in res.get("fields", {}).items()
                if k in {"full_name", "date_of_birth", "expiry", "document_type", "issuing_country"}}

        return CheckOutcome(
            type=self.type,
            result=CheckResult.PASS if res["passed"] and not findings else CheckResult.FAIL,
            score=res.get("score"),
            vendor=vendor.name,
            findings=findings,
            details={"fields": kept, "face_match_score": res.get("face_match_score")},
            cost_usd=self.cost_usd,
            hard_fail=any(f.severity == "critical" for f in findings),
        )
