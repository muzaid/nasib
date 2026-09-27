"""The verification agent.

An orchestrator, not a model. It runs a fixed sequence of cheap-to-expensive
checks, stops early on a hard fail, and produces an evidence packet plus two
scores. It never silently bans anyone: every rejection is either rule-based
and explainable, or human-confirmed.

Ordering matters commercially as well as technically — phone and device
screening removes a large share of fraudulent signups for a fraction of a
cent, before a liveness check is ever paid for.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .checks.base import Check, CheckContext
from .checks.identity import (
    DeviceCheck,
    DocumentCheck,
    DuplicateFaceCheck,
    FaceMatchCheck,
    LivenessCheck,
    PhoneCheck,
    ReverseImageCheck,
)
from .checks.intent import ConsistencyAndIntentCheck, EffortCheck, ScamPatternCheck
from .checks.live_capture import LiveCaptureCheck, ThreeWayMatchCheck
from .models import (
    Applicant,
    Band,
    CheckResult,
    EvidencePacket,
    LiveCaptureSession,
    PipelineRun,
)
from .scoring import AGENT_VERSION, score

DEFAULT_CHECKS: list[Check] = [
    PhoneCheck(),
    DeviceCheck(),
    LivenessCheck(),
    LiveCaptureCheck(),
    ScamPatternCheck(),
    FaceMatchCheck(),
    DuplicateFaceCheck(),
    ReverseImageCheck(),
    ConsistencyAndIntentCheck(),
    EffortCheck(),
    DocumentCheck(),
    # Last, because it needs the document portrait the document check
    # extracts. It is also the most decisive check in the pipeline, which
    # is a good argument for it being the one that runs on the fullest
    # picture rather than the earliest.
    ThreeWayMatchCheck(),
]


class VerificationAgent:
    def __init__(self, vendors: dict[str, Any], checks: list[Check] | None = None) -> None:
        self.vendors = vendors
        self.checks = sorted(checks or DEFAULT_CHECKS, key=lambda c: (c.stage, c.cost_usd))

    async def run(
        self,
        applicant: Applicant,
        *,
        require_document: bool = False,
        require_active_challenge: bool = False,
        live_session: LiveCaptureSession | None = None,
    ) -> PipelineRun:
        run = PipelineRun(
            user_id=applicant.user_id,
            agent_version=AGENT_VERSION,
            started_at=datetime.now(timezone.utc),
        )
        ctx = CheckContext(
            vendors=self.vendors,
            require_document=require_document,
            require_active_challenge=require_active_challenge,
        )
        session = live_session or applicant.live_session
        if session is not None:
            ctx.scratch["live_session"] = session

        for check in self.checks:
            outcome = await check.execute(applicant, ctx)
            run.outcomes.append(outcome)
            run.total_cost_usd += outcome.cost_usd

            if outcome.hard_fail:
                # Stop paying for checks whose answer cannot change the
                # decision. The reviewer still sees everything gathered.
                run.short_circuited_on = outcome.type
                break

        run.trust = score(run)
        run.finished_at = datetime.now(timezone.utc)

        # Only index the face of someone who got far enough to matter, and
        # never one who hard-failed.
        reference = ctx.scratch.get("live_embedding") or ctx.scratch.get("selfie_embedding")
        if run.short_circuited_on is None and reference is not None:
            await self.vendors["embedding_index"].upsert(
                str(applicant.user_id), reference, "mock-face"
            )

        self._last_context = ctx
        return run

    async def evidence_packet(self, applicant: Applicant, run: PipelineRun,
                              prior_reports: int = 0) -> EvidencePacket:
        """Everything a reviewer needs on one screen.

        The recommendation is assembled last and rendered last, so the
        reviewer forms a view from the evidence before being anchored.
        """
        ctx = getattr(self, "_last_context", None)
        dupes = (ctx.scratch.get("duplicate_accounts", []) if ctx else [])

        return EvidencePacket(
            run=run,
            applicant=applicant,
            duplicate_accounts=dupes,
            prior_reports=prior_reports,
            recommendation=run.trust.band if run.trust else Band.REVIEW,
            recommendation_reasons=run.trust.rationale if run.trust else [],
        )


def summarise(run: PipelineRun) -> dict[str, Any]:
    """Compact form for logs and the console list view."""
    return {
        "run_id": str(run.run_id),
        "user_id": str(run.user_id),
        "agent_version": run.agent_version,
        "band": run.trust.band.value if run.trust else None,
        "identity": run.trust.identity_confidence if run.trust else None,
        "intent": run.trust.intent_confidence if run.trust else None,
        "cost_usd": round(run.total_cost_usd, 4),
        "short_circuited_on": run.short_circuited_on.value if run.short_circuited_on else None,
        "checks": [
            {
                "type": o.type.value,
                "result": o.result.value,
                "score": o.score,
                "findings": len(o.findings),
                "ms": o.duration_ms,
            }
            for o in run.outcomes
        ],
        "findings": [
            {"code": f.code, "severity": f.severity, "detail": f.detail, "quote": f.quote}
            for f in run.all_findings
        ],
    }


def failed_checks(run: PipelineRun) -> list[str]:
    return [o.type.value for o in run.outcomes if o.result == CheckResult.FAIL]
