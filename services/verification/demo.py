#!/usr/bin/env python3
"""Run every test persona through the agent and print what the review desk
would see. No vendor account needed.

    python3 demo.py
"""

from __future__ import annotations

import asyncio

from app.models import Band
from app.pipeline import VerificationAgent, summarise
from app.vendors import mock_vendors
from tests.personas import ALL_PERSONAS

BAND_LABEL = {
    Band.AUTO_ADMIT: "ADMIT ",
    Band.REVIEW: "REVIEW",
    Band.AUTO_REJECT: "REJECT",
}


async def main() -> None:
    # A fresh index per persona, so each line shows that applicant on their
    # own. Cross-account duplicate detection is covered in the test suite,
    # where two accounts are deliberately run against a shared index.
    print()
    print(f"{'persona':<28} {'band':<7} {'id':>4} {'int':>4} {'cost':>7}  first finding")
    print("-" * 104)

    total_cost = 0.0
    for name, make in ALL_PERSONAS.items():
        agent = VerificationAgent(mock_vendors())
        run = await agent.run(make())
        s = summarise(run)
        total_cost += run.total_cost_usd
        first = run.all_findings[0].detail if run.all_findings else "—"
        print(
            f"{name:<28} {BAND_LABEL[run.trust.band]:<7} "
            f"{s['identity']:>4} {s['intent']:>4} ${s['cost_usd']:>6.3f}  {first[:56]}"
        )

    print("-" * 104)
    print(f"{'total spend on 10 applications':<28} {'':<7} {'':>4} {'':>4} ${total_cost:>6.3f}")
    print()
    print("Note how the fraudulent applicants cost the least: the pipeline")
    print("stops as soon as the answer cannot change, before any paid check.")
    print()


if __name__ == "__main__":
    asyncio.run(main())
