"""Guided live capture, and the three-way match it makes possible.

The user looks at the camera and follows a short sequence of instructions.
From that we learn three things a single still selfie cannot tell us:

  1. **There is a live person there.** The sequence is issued by the server,
     randomised per session, and expires in ninety seconds. A pre-recorded
     video cannot satisfy an order it was filmed before.

  2. **It is one person throughout.** Every accepted frame is embedded and
     compared to the others. A face swapped mid-sequence, or a second
     person stepping in for the hard step, shows up as a break.

  3. **Who that person is, against two references.** The live face is
     compared to the portrait on the ID *and* to the profile photos, and
     the two results are reported separately — because "the man holding
     this ID is not its owner" and "this account's photos are of someone
     else" are different problems with different responses.

One counter-intuitive signal worth keeping: frames that are *too* similar
are suspicious. A printed photo or a screen held in front of the lens
produces near-identical embeddings. A real face moving through a sequence
varies a little from frame to frame, and the absence of that variation is
itself evidence.
"""

from __future__ import annotations

import statistics
from datetime import datetime, timezone

from ..models import (
    Applicant,
    ChallengeStep,
    CheckOutcome,
    CheckResult,
    CheckType,
    Finding,
    LiveCaptureSession,
    MatchPair,
    PairScore,
)
from .base import Check, CheckContext

# Cosine thresholds. Tune from the review desk's own rulings — the first
# months of human decisions are the training set.
SAME_PERSON_LIVE = 0.62          # live frame ↔ reference
FRAME_COHERENCE = 0.70           # frame ↔ frame within one session
TOO_COHERENT = 0.995             # a real face is never this consistent

# The pose each instruction should produce, in degrees. Generous, because
# people hold phones at odd angles and a strict gate here reads as the app
# being broken rather than the user being wrong.
EXPECTED_YAW = {
    ChallengeStep.TURN_LEFT: (12.0, 70.0),
    ChallengeStep.TURN_RIGHT: (-70.0, -12.0),
    ChallengeStep.LOOK_STRAIGHT: (-12.0, 12.0),
}
EXPECTED_PITCH = {ChallengeStep.LOOK_UP: (10.0, 60.0)}

SESSION_SECONDS = 90
MIN_STEP_GAP_MS = 250            # faster than a person can actually move


class LiveCaptureCheck(Check):
    """Validates the session itself: did the person do what they were asked,
    in the order asked, in a plausible amount of time, and was it the same
    face throughout."""

    type = CheckType.LIVE_CAPTURE
    stage = 1
    cost_usd = 0.0               # in-house; the vendor liveness call is separate

    def applies_to(self, applicant: Applicant, ctx: CheckContext) -> bool:
        return ctx.scratch.get("live_session") is not None

    async def run(self, applicant: Applicant, ctx: CheckContext) -> CheckOutcome:
        session: LiveCaptureSession = ctx.scratch["live_session"]
        face = ctx.vendors["face"]
        findings: list[Finding] = []

        # --- did the session expire ------------------------------------
        if datetime.now(timezone.utc) > session.expires_at:
            return CheckOutcome(
                type=self.type,
                result=CheckResult.INCONCLUSIVE,
                findings=[Finding(
                    code="live_session_expired",
                    detail="The capture took longer than the session allowed. Ask for a retake.",
                    severity="low",
                )],
            )

        # --- every step answered, in order ------------------------------
        answered = [f.step for f in session.frames]
        if answered != session.challenge:
            missing = [s.value for s in session.challenge if s not in answered]
            findings.append(Finding(
                code="challenge_not_followed",
                detail=(
                    f"The sequence was not followed. Missing: {', '.join(missing)}."
                    if missing else
                    "The steps came back in a different order than they were issued."
                ),
                severity="high",
            ))

        # --- timing ------------------------------------------------------
        times = [f.captured_at_ms for f in session.frames]
        if times != sorted(times):
            findings.append(Finding(
                code="frames_out_of_order",
                detail="Frame timestamps are not monotonic; the capture was assembled, not recorded.",
                severity="critical",
            ))
        gaps = [b - a for a, b in zip(times, times[1:])]
        if gaps and min(gaps) < MIN_STEP_GAP_MS:
            findings.append(Finding(
                code="impossible_timing",
                detail=(
                    f"Two steps are {min(gaps)}ms apart. A person cannot turn their "
                    "head that fast; the frames were fed in."
                ),
                severity="critical",
            ))

        # --- pose actually matches the instruction -----------------------
        for f in session.frames:
            lo_hi = EXPECTED_YAW.get(f.step)
            if lo_hi and f.yaw is not None and not (lo_hi[0] <= f.yaw <= lo_hi[1]):
                findings.append(Finding(
                    code="pose_mismatch",
                    detail=f"Asked to {f.step.value.replace('_', ' ')}, head yaw was {f.yaw:.0f}°.",
                    severity="medium",
                ))
            lo_hi = EXPECTED_PITCH.get(f.step)
            if lo_hi and f.pitch is not None and not (lo_hi[0] <= f.pitch <= lo_hi[1]):
                findings.append(Finding(
                    code="pose_mismatch",
                    detail=f"Asked to look up, head pitch was {f.pitch:.0f}°.",
                    severity="medium",
                ))
            if f.step is ChallengeStep.BLINK and f.eyes_open is True:
                findings.append(Finding(
                    code="blink_not_detected",
                    detail="Asked to blink; eyes were open in the captured frame.",
                    severity="medium",
                ))

        # --- one face, all the way through -------------------------------
        embeddings = [await face.embed(f.image_path) for f in session.frames]
        pairwise: list[float] = []
        for i in range(len(embeddings)):
            for j in range(i + 1, len(embeddings)):
                pairwise.append(await face.compare(embeddings[i], embeddings[j]))

        coherence = min(pairwise) if pairwise else 1.0

        if pairwise and coherence < FRAME_COHERENCE:
            findings.append(Finding(
                code="face_changed_mid_capture",
                detail=(
                    f"The face is not the same across the sequence (lowest similarity "
                    f"{coherence:.2f}). Someone else answered part of it."
                ),
                severity="critical",
            ))

        # The counter-intuitive one: a real face varies a little.
        if len(pairwise) >= 3 and statistics.mean(pairwise) > TOO_COHERENT:
            findings.append(Finding(
                code="unnaturally_consistent",
                detail=(
                    f"Frames are {statistics.mean(pairwise):.3f} identical to each other. "
                    "A live face varies between frames; a printed photo or a screen does not."
                ),
                severity="high",
            ))

        # The median embedding is the reference the three-way match uses:
        # more robust than the single best frame, which is often the one
        # where the lighting happened to be kindest.
        if embeddings:
            ctx.scratch["live_embedding"] = _centroid(embeddings)

        critical = any(f.severity == "critical" for f in findings)
        return CheckOutcome(
            type=self.type,
            result=CheckResult.FAIL if findings else CheckResult.PASS,
            score=round(coherence, 3),
            findings=findings,
            details={
                "challenge": [s.value for s in session.challenge],
                "frames": len(session.frames),
                "coherence_min": round(coherence, 3),
                "coherence_mean": round(statistics.mean(pairwise), 3) if pairwise else None,
                "duration_ms": (times[-1] - times[0]) if len(times) > 1 else 0,
            },
            hard_fail=critical,
        )


class ThreeWayMatchCheck(Check):
    """Live face against the ID portrait and against the profile photos,
    reported as two separate verdicts."""

    type = CheckType.THREE_WAY_MATCH
    stage = 5                     # after the document check has run
    cost_usd = 0.0

    def applies_to(self, applicant: Applicant, ctx: CheckContext) -> bool:
        return "live_embedding" in ctx.scratch

    async def run(self, applicant: Applicant, ctx: CheckContext) -> CheckOutcome:
        face = ctx.vendors["face"]
        live = ctx.scratch["live_embedding"]
        pairs: list[PairScore] = []
        findings: list[Finding] = []

        # --- live ↔ profile photos ---------------------------------------
        photo_scores: dict[str, float] = {}
        for photo in applicant.photos:
            emb = await face.embed(photo.storage_path)
            photo_scores[str(photo.id)] = await face.compare(live, emb)

        if photo_scores:
            worst = min(photo_scores.values())
            matched = worst >= SAME_PERSON_LIVE
            pairs.append(PairScore(
                pair=MatchPair.LIVE_TO_PHOTOS,
                similarity=round(worst, 3),
                threshold=SAME_PERSON_LIVE,
                matched=matched,
            ))
            if not matched:
                n = sum(1 for s in photo_scores.values() if s < SAME_PERSON_LIVE)
                findings.append(Finding(
                    code="live_not_photos",
                    detail=(
                        f"The person on camera does not match {n} of "
                        f"{len(photo_scores)} profile photos (lowest {worst:.2f}). "
                        "The photos are of someone else."
                    ),
                    severity="critical",
                ))

        # --- live ↔ ID portrait -------------------------------------------
        doc_path = ctx.scratch.get("document_portrait_path") or applicant.document_path
        doc_emb = None
        if doc_path:
            doc_emb = await face.embed(doc_path)
            sim = await face.compare(live, doc_emb)
            matched = sim >= SAME_PERSON_LIVE
            pairs.append(PairScore(
                pair=MatchPair.LIVE_TO_DOCUMENT,
                similarity=round(sim, 3),
                threshold=SAME_PERSON_LIVE,
                matched=matched,
            ))
            if not matched:
                findings.append(Finding(
                    code="live_not_id",
                    detail=(
                        f"The person on camera is not the person on the identity "
                        f"document ({sim:.2f}). Someone is holding another person's ID."
                    ),
                    severity="critical",
                ))

        # --- ID ↔ photos ----------------------------------------------------
        # Only interesting when both of the above passed: it catches the case
        # where the gallery is a younger or heavily edited version of the same
        # person, which is a conversation rather than a rejection.
        if doc_emb is not None and photo_scores:
            best_photo = max(applicant.photos, key=lambda p: photo_scores[str(p.id)])
            sim = await face.compare(doc_emb, await face.embed(best_photo.storage_path))
            pairs.append(PairScore(
                pair=MatchPair.DOCUMENT_TO_PHOTOS,
                similarity=round(sim, 3),
                threshold=SAME_PERSON_LIVE,
                matched=sim >= SAME_PERSON_LIVE,
            ))
            if sim < SAME_PERSON_LIVE and all(
                p.matched for p in pairs if p.pair is not MatchPair.DOCUMENT_TO_PHOTOS
            ):
                findings.append(Finding(
                    code="photos_dated_or_edited",
                    detail=(
                        f"Live capture matches both the ID and the photos, but the ID "
                        f"and the photos do not match each other ({sim:.2f}). Usually an "
                        "old or heavily edited gallery rather than a fraud."
                    ),
                    severity="low",
                ))

        matched_all = all(p.matched for p in pairs) if pairs else False
        lowest = min((p.similarity for p in pairs), default=0.0)

        return CheckOutcome(
            type=self.type,
            result=CheckResult.PASS if matched_all else CheckResult.FAIL,
            score=round(lowest, 3),
            findings=findings,
            details={
                "pairs": [p.model_dump() for p in pairs],
                "per_photo": {k: round(v, 3) for k, v in photo_scores.items()},
                "threshold": SAME_PERSON_LIVE,
            },
            # A live face that does not match the ID is the single most
            # decisive signal the whole pipeline produces. Nothing later
            # can redeem it.
            hard_fail=any(f.code in ("live_not_id", "live_not_photos") for f in findings),
        )


def _centroid(vectors: list[list[float]]) -> list[float]:
    """Mean of the accepted frames, renormalised. More robust than picking
    the single best frame, which tends to be whichever one had the kindest
    light rather than the most representative face."""
    n = len(vectors)
    dim = len(vectors[0])
    mean = [sum(v[i] for v in vectors) / n for i in range(dim)]
    norm = sum(x * x for x in mean) ** 0.5 or 1.0
    return [x / norm for x in mean]


def issue_challenge(rng) -> tuple[list[ChallengeStep], str | None]:
    """Build a session's instruction sequence.

    Always starts with a straight-on frame, which is the one used as the
    reference, then two or three randomised movements. The order is what
    makes it unforgeable, so it is drawn per session and never reused.
    """
    movements = [
        ChallengeStep.TURN_LEFT,
        ChallengeStep.TURN_RIGHT,
        ChallengeStep.LOOK_UP,
        ChallengeStep.BLINK,
        ChallengeStep.SMILE,
    ]
    rng.shuffle(movements)
    steps = [ChallengeStep.LOOK_STRAIGHT] + movements[:3]

    digits = None
    if rng.random() < 0.35:
        # Spoken digits defeat a silent video replay, but they exclude
        # anyone who cannot speak or is somewhere they cannot, so it is a
        # sometimes-step with a "can't do this" way out in the UI.
        steps.append(ChallengeStep.SPEAK_DIGITS)
        digits = "".join(str(rng.randint(0, 9)) for _ in range(4))

    return steps, digits
