"""Check protocol.

Every check declares its cost and its stage. The pipeline runs them
cheap-to-expensive and stops on a hard fail — ordering is the difference
between a verification bill you can absorb and one that caps growth.
"""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from ..models import Applicant, CheckOutcome, CheckResult, CheckType


@dataclass
class CheckContext:
    """Shared state for one pipeline run.

    Checks read what earlier checks produced (the face embedding, the
    document fields) instead of recomputing or re-paying for it.
    """

    vendors: dict[str, Any]
    scratch: dict[str, Any] = field(default_factory=dict)
    require_document: bool = False
    require_active_challenge: bool = False


class Check(ABC):
    type: CheckType
    stage: int          # lower runs first
    cost_usd: float = 0.0

    @abstractmethod
    async def run(self, applicant: Applicant, ctx: CheckContext) -> CheckOutcome: ...

    def applies_to(self, applicant: Applicant, ctx: CheckContext) -> bool:
        return True

    async def execute(self, applicant: Applicant, ctx: CheckContext) -> CheckOutcome:
        if not self.applies_to(applicant, ctx):
            return CheckOutcome(type=self.type, result=CheckResult.SKIPPED)
        started = time.perf_counter()
        try:
            outcome = await self.run(applicant, ctx)
        except Exception as exc:  # a vendor being down must never ban a user
            outcome = CheckOutcome(
                type=self.type,
                result=CheckResult.ERROR,
                details={"error": type(exc).__name__, "message": str(exc)},
            )
        outcome.duration_ms = int((time.perf_counter() - started) * 1000)
        return outcome
