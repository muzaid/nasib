"""Layer 2 — is this person serious?

This is where a language model earns its place, and where most teams get it
wrong by asking a model for a seriousness score. Instead the model returns
specific contradictions with quotes, and a classification against a fixed
taxonomy; the scoring is done by code we can explain to a rejected user.
"""

from __future__ import annotations

from ..models import Applicant, CheckOutcome, CheckResult, CheckType, Finding
from ..prompts import (
    ANALYSIS_SCHEMA,
    CONSISTENCY_SYSTEM,
    CONSISTENCY_USER_TEMPLATE,
    SCAM_PATTERNS,
)
from .base import Check, CheckContext


class ScamPatternCheck(Check):
    """Cheap literal pre-filter. Runs before the model, never instead of it."""

    type = CheckType.SCAM_PATTERN
    stage = 1
    cost_usd = 0.0

    def applies_to(self, applicant: Applicant, ctx: CheckContext) -> bool:
        return bool(applicant.bio)

    async def run(self, applicant: Applicant, ctx: CheckContext) -> CheckOutcome:
        text = (applicant.bio or "").lower()
        hits: dict[str, list[str]] = {}
        for category, tokens in SCAM_PATTERNS.items():
            matched = [t for t in tokens if t in text]
            if matched:
                hits[category] = matched

        findings = [
            Finding(
                code=f"scam_{category}",
                detail=f"Bio matches known {category.replace('_', ' ')} pattern.",
                quote=", ".join(matched),
                severity="high" if category in {"money_talk", "classic_persona"} else "medium",
            )
            for category, matched in hits.items()
        ]

        ctx.scratch["scam_categories"] = list(hits)
        return CheckOutcome(
            type=self.type,
            result=CheckResult.FAIL if hits else CheckResult.PASS,
            score=1.0 - min(1.0, 0.34 * len(hits)),
            findings=findings,
            details={"hits": hits},
            hard_fail="money_talk" in hits and "classic_persona" in hits,
        )


class ConsistencyAndIntentCheck(Check):
    """Runs the structured fields, the free text and the photos against
    each other, and classifies declared intent."""

    type = CheckType.CONSISTENCY
    stage = 3
    cost_usd = 0.02

    def applies_to(self, applicant: Applicant, ctx: CheckContext) -> bool:
        return bool(applicant.bio and applicant.bio.strip())

    async def run(self, applicant: Applicant, ctx: CheckContext) -> CheckOutcome:
        llm = ctx.vendors["llm"]
        user_prompt = CONSISTENCY_USER_TEMPLATE.format(
            gender=applicant.gender.value,
            age=applicant.age,
            city=applicant.city or "—",
            country=applicant.country_code,
            marital_status=applicant.marital_status.value,
            children_count=applicant.children_count,
            occupation=applicant.occupation or "—",
            education=applicant.education or "—",
            timeline=applicant.timeline,
            relocate=applicant.willing_to_relocate,
            family_aware=applicant.family_aware,
            bio=applicant.bio,
        )

        analysis = await llm.analyse(CONSISTENCY_SYSTEM, user_prompt, ANALYSIS_SCHEMA)
        ctx.scratch["analysis"] = analysis

        findings = [
            Finding(
                code=c["code"],
                detail=c["detail"],
                quote=c.get("quote"),
                severity="high",
            )
            for c in analysis.get("contradictions", [])
        ]

        intent = analysis.get("intent", "ambiguous")
        if intent in {"casual_seeking", "commercial", "scam_or_commercial"}:
            findings.append(Finding(
                code=f"intent_{intent}",
                detail=f"Free text classifies as {intent.replace('_', ' ')}.",
                severity="critical" if intent == "scam_or_commercial" else "high",
            ))

        result = CheckResult.PASS
        if intent == "scam_or_commercial":
            result = CheckResult.FAIL
        elif findings:
            result = CheckResult.INCONCLUSIVE

        return CheckOutcome(
            type=self.type,
            result=result,
            score=float(analysis.get("intent_confidence", 0.5)),
            vendor=llm.name,
            findings=findings,
            details=analysis,
            cost_usd=self.cost_usd,
            hard_fail=intent == "scam_or_commercial",
        )


class EffortCheck(Check):
    """Weak on its own, useful combined with everything above."""

    type = CheckType.INTENT
    stage = 3
    cost_usd = 0.0

    async def run(self, applicant: Applicant, ctx: CheckContext) -> CheckOutcome:
        bio_len = len((applicant.bio or "").strip())
        photos = len(applicant.photos)
        filled = sum(
            1 for v in (applicant.education, applicant.occupation, applicant.city)
            if v and v.strip()
        )

        effort = min(1.0, bio_len / 400) * 0.5 + min(1.0, photos / 3) * 0.25 + (filled / 3) * 0.25

        findings: list[Finding] = []
        if bio_len < 40:
            findings.append(Finding(
                code="minimal_bio",
                detail=f"Bio is {bio_len} characters. Applicants who write little rarely convert.",
                severity="low",
            ))
        if photos < 2:
            findings.append(Finding(code="few_photos", detail=f"{photos} photo(s) uploaded.",
                                    severity="low"))

        return CheckOutcome(
            type=self.type,
            result=CheckResult.PASS,
            score=round(effort, 3),
            findings=findings,
            details={"bio_length": bio_len, "photo_count": photos, "fields_filled": filled},
        )
