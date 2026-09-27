"""Trust scoring and admission bands.

The scoring is deliberately arithmetic and legible. Every rejection must be
explainable to the person rejected, and every threshold must be traceable
to a decision the review desk actually made.

  identity_confidence  -> the badge the user sees
  intent_confidence    -> ranking and review priority, never shown

Bands:
  identity >= 85 and intent >= 70  -> auto admit
  identity <  40 or  intent <  30  -> auto reject (appealable, always)
  otherwise                        -> human review

Tune these from `admin_decisions`: the first months of human rulings are
the training set, which is why that table is append-only and records the
agent's score at the time of each decision.
"""

from __future__ import annotations

from .models import Band, CheckResult, CheckType, PipelineRun, TrustScore

AGENT_VERSION = "verify-1.0.0"

# Identity is a product of independent evidence: each check can only lower
# confidence, and a check that did not run contributes its neutral prior.
IDENTITY_WEIGHTS: dict[CheckType, float] = {
    CheckType.PHONE: 0.08,
    CheckType.DEVICE: 0.08,
    CheckType.LIVENESS: 0.20,
    # The guided capture and the three-way match carry the most weight
    # between them, and that is the point: a still selfie is no longer
    # enough on its own to be admitted automatically. Someone who skips
    # the camera step lands in review rather than through the door.
    CheckType.LIVE_CAPTURE: 0.16,
    CheckType.THREE_WAY_MATCH: 0.22,
    CheckType.FACE_MATCH: 0.12,
    CheckType.DUPLICATE_FACE: 0.09,
    CheckType.REVERSE_IMAGE: 0.05,
}

DOCUMENT_BONUS = 15          # a verified document lifts identity confidence
NEUTRAL_PRIOR = 0.55         # a check that did not run

INTENT_WEIGHTS: dict[CheckType, float] = {
    CheckType.CONSISTENCY: 0.55,
    CheckType.SCAM_PATTERN: 0.25,
    CheckType.INTENT: 0.20,
}

SEVERITY_PENALTY = {"low": 2, "medium": 6, "high": 15, "critical": 40}

AUTO_ADMIT_IDENTITY = 85
AUTO_ADMIT_INTENT = 70
AUTO_REJECT_IDENTITY = 40
AUTO_REJECT_INTENT = 30


def _component(run: PipelineRun, check: CheckType) -> float:
    outcome = run.by_type(check)
    if outcome is None or outcome.result in (CheckResult.SKIPPED, CheckResult.ERROR):
        return NEUTRAL_PRIOR
    if outcome.result == CheckResult.FAIL:
        return 0.0
    if outcome.result == CheckResult.INCONCLUSIVE:
        return NEUTRAL_PRIOR
    if outcome.score is None:
        return 1.0
    return max(0.0, min(1.0, outcome.score))


def score(run: PipelineRun) -> TrustScore:
    rationale: list[str] = []

    # --- a hard fail is decisive, and says exactly why -------------------
    hard = [o for o in run.outcomes if o.hard_fail]
    if hard:
        reasons = [f.detail for o in hard for f in o.findings] or [
            f"{o.type.value} failed" for o in hard
        ]
        return TrustScore(
            identity_confidence=0,
            intent_confidence=0,
            band=Band.AUTO_REJECT,
            rationale=reasons,
        )

    identity = sum(w * _component(run, c) for c, w in IDENTITY_WEIGHTS.items()) * 100
    intent = sum(w * _component(run, c) for c, w in INTENT_WEIGHTS.items()) * 100

    doc = run.by_type(CheckType.DOCUMENT)
    if doc and doc.result == CheckResult.PASS:
        identity = min(100.0, identity + DOCUMENT_BONUS)
        rationale.append("Government document verified and matched to the liveness selfie.")

    # --- findings subtract from whichever number they bear on -----------
    identity_checks = set(IDENTITY_WEIGHTS) | {CheckType.DOCUMENT}
    for outcome in run.outcomes:
        for finding in outcome.findings:
            penalty = SEVERITY_PENALTY[finding.severity]
            if outcome.type in identity_checks:
                identity -= penalty
            else:
                intent -= penalty
            if finding.severity in ("high", "critical"):
                rationale.append(finding.detail)

    identity_i = int(max(0, min(100, round(identity))))
    intent_i = int(max(0, min(100, round(intent))))

    # Conditions under which a good score is still not enough to admit
    # automatically. Scores alone would let a three-word bio through on the
    # strength of a clean selfie, and would let a vendor outage look like a
    # pass.
    blockers: list[str] = []

    consistency = run.by_type(CheckType.CONSISTENCY)
    if consistency is None or consistency.result == CheckResult.SKIPPED:
        blockers.append("No free text to assess intent against.")
    elif consistency.details.get("intent") != "marriage_seeking":
        blockers.append(
            f"Intent classified as {consistency.details.get('intent', 'unknown')}, "
            "not clearly marriage-seeking."
        )

    errored = [o.type.value for o in run.outcomes if o.result == CheckResult.ERROR]
    if errored:
        blockers.append(f"Checks could not be completed: {', '.join(errored)}.")

    if identity_i < AUTO_REJECT_IDENTITY or intent_i < AUTO_REJECT_INTENT:
        band = Band.AUTO_REJECT
    elif identity_i >= AUTO_ADMIT_IDENTITY and intent_i >= AUTO_ADMIT_INTENT and not blockers:
        band = Band.AUTO_ADMIT
    else:
        band = Band.REVIEW
        rationale.extend(blockers)

    if band == Band.AUTO_ADMIT and not rationale:
        rationale.append("All checks passed; no finding above low severity.")
    if band == Band.REVIEW and not rationale:
        rationale.append("Scores fall between the automatic thresholds; a reviewer decides.")

    return TrustScore(
        identity_confidence=identity_i,
        intent_confidence=intent_i,
        band=band,
        rationale=rationale,
    )


def badge_for(identity_confidence: int, document_verified: bool) -> str:
    """What the other user sees. Deliberately coarse — a numeric trust
    score shown in-product turns into a ranking people optimise for."""
    if document_verified and identity_confidence >= 85:
        return "id_verified"
    if identity_confidence >= 75:
        return "photo_verified"
    return "unverified"
