#!/usr/bin/env python3
"""Export the review queue as JSON, for the admin console.

In production the console reads `/v1/runs/{id}` from the service. This
script produces the same shape from the test personas so the console can be
developed, demoed and reviewed without a running backend.

    python3 export_queue.py > ../../apps/admin/queue.json
"""

from __future__ import annotations

import asyncio
import json
import sys
from datetime import datetime, timedelta, timezone

from app.models import Band
from app.pipeline import VerificationAgent
from app.vendors import mock_vendors
from tests.personas import ALL_PERSONAS

# Applications that never reach a human: a clean auto-admit needs no
# reviewer, and a hard fail is already explained. The queue is the
# ambiguous middle plus anything a user reported.
SHOW_IN_QUEUE = {Band.REVIEW, Band.AUTO_REJECT}

# The console is Arabic: the reviewers are local and the evidence they read
# — bios, notes, names — is Arabic. A half-English console means a reviewer
# reading right-to-left evidence inside a left-to-right frame all day.
QUEUE_LABEL = {
    Band.REVIEW: "طلب انضمام على الحدّ",
    Band.AUTO_REJECT: "اعتراض",
}

# Queue order, as the blueprint sets it: reports on an active conversation
# first (minutes), then photo requests (they hold two people up), then
# appeals, then borderline admissions, then the audit sample.
QUEUE_PRIORITY = {
    "بلاغ": 0,
    "طلب رؤية صور": 1,
    "ترتيب لقاء": 2,
    "اعتراض": 3,
    "طلب انضمام على الحدّ": 4,
    "عيّنة تدقيق": 5,
}


async def main() -> None:
    rows = []
    now = datetime.now(timezone.utc)

    for i, (name, make) in enumerate(ALL_PERSONAS.items()):
        agent = VerificationAgent(mock_vendors())
        applicant = make()
        run = await agent.run(applicant)
        packet = await agent.evidence_packet(applicant, run)
        assert run.trust is not None

        rows.append(
            {
                "name": name,
                "queue": QUEUE_LABEL.get(run.trust.band, "عيّنة تدقيق"),
                "in_queue": run.trust.band in SHOW_IN_QUEUE,
                # Waits inside the published SLA: appeals under 24h,
                # borderline admissions under 12h.
                "waiting_since": (now - timedelta(hours=1 + (i * 1.7) % 10)).isoformat(),
                "applicant": {
                    "display_name": applicant.display_name,
                    "age": applicant.age,
                    "gender": applicant.gender.value,
                    "city": applicant.city,
                    "country": applicant.country_code,
                    "tier": applicant.tier.value,
                    "marital_status": applicant.marital_status.value,
                    "children_count": applicant.children_count,
                    "occupation": applicant.occupation,
                    "education": applicant.education,
                    "timeline": applicant.timeline,
                    "family_aware": applicant.family_aware,
                    "bio": applicant.bio,
                    "photo_count": len(applicant.photos),
                    "phone_masked": applicant.phone_e164[:5] + "•" * 6 + applicant.phone_e164[-2:],
                },
                "device": applicant.device.model_dump() if applicant.device else None,
                "trust": {
                    "identity": run.trust.identity_confidence,
                    "intent": run.trust.intent_confidence,
                    "band": run.trust.band.value,
                    "rationale": run.trust.rationale,
                },
                "checks": [
                    {
                        "type": o.type.value,
                        "result": o.result.value,
                        "score": o.score,
                        "vendor": o.vendor,
                        "cost_usd": o.cost_usd,
                        "duration_ms": o.duration_ms,
                        "details": o.details,
                    }
                    for o in run.outcomes
                ],
                "findings": [
                    {
                        "code": f.code,
                        "severity": f.severity,
                        "detail": f.detail,
                        "quote": f.quote,
                        "check": o.type.value,
                    }
                    for o in run.outcomes
                    for f in o.findings
                ],
                "run": {
                    "run_id": str(run.run_id),
                    "agent_version": run.agent_version,
                    "cost_usd": round(run.total_cost_usd, 4),
                    "short_circuited_on": (
                        run.short_circuited_on.value if run.short_circuited_on else None
                    ),
                },
                "duplicate_accounts": [str(u) for u in packet.duplicate_accounts],
                "prior_reports": 0,
            }
        )

    rows.extend(_photo_requests(now))
    rows.extend(_meeting_requests(now))
    rows.sort(key=lambda r: (QUEUE_PRIORITY.get(r["queue"], 9), r["waiting_since"]))

    json.dump({"generated_at": now.isoformat(), "cases": rows}, sys.stdout,
              ensure_ascii=False, indent=2)

# ---------------------------------------------------------------------- #
# The two queues that are not about admission.
#
# A photo request holds two people up and is the most consequential thing a
# reviewer touches: a bad screening decision either exposes a woman's face
# to someone who should not have asked, or troubles her with a request from
# a man with reports against him. It sits directly below live reports.
# ---------------------------------------------------------------------- #


def _photo_requests(now) -> list[dict]:
    return [
        {
            "name": "photo_request_hassan",
            "queue": "طلب رؤية صور",
            "in_queue": True,
            "waiting_since": (now - timedelta(hours=2)).isoformat(),
            "kind": "photo_request",
            "requester": {
                "display_name": "حسن",
                "age": 32,
                "city": "عمّان",
                "document_verified": False,
                "identity": 98,
                "intent": 52,
                "reports_against": 0,
                "requests_last_30d": 2,
                "approved_before": 1,
                "note": "أهلاً، أنا وعيلتي من نابلس وحابب أتعرف عليكم.",
            },
            "owner": {"display_name": "أميرة", "age": 28, "city": "رام الله"},
            "flags": [
                {
                    "severity": "medium",
                    "detail": "تناقض مسجّل في ملفه: صرّح بعدم وجود أبناء، ونصّه يذكر أولاده.",
                }
            ],
        },
        {
            "name": "photo_request_serial",
            "queue": "طلب رؤية صور",
            "in_queue": True,
            "waiting_since": (now - timedelta(hours=5)).isoformat(),
            "kind": "photo_request",
            "requester": {
                "display_name": "طارق",
                "age": 30,
                "city": "نابلس",
                "document_verified": True,
                "identity": 88,
                "intent": 79,
                "reports_against": 3,
                "requests_last_30d": 14,
                "approved_before": 0,
                "note": None,
            },
            "owner": {"display_name": "أميرة", "age": 28, "city": "رام الله"},
            "flags": [
                {
                    "severity": "critical",
                    "detail": "ثلاثة بلاغات ضدّ هذا الحساب خلال شهر.",
                },
                {
                    "severity": "high",
                    "detail": "14 طلب رؤية صور خلال 30 يوماً، لم يُقبل أيّ منها.",
                },
            ],
        },
    ]


def _meeting_requests(now) -> list[dict]:
    return [
        {
            "name": "meeting_ramallah",
            "queue": "ترتيب لقاء",
            "in_queue": True,
            "waiting_since": (now - timedelta(hours=7)).isoformat(),
            "kind": "meeting",
            "pair": ["يوسف، 32", "أميرة، 28"],
            "city": "رام الله",
            "families_attending": True,
            "slots": [
                {"when": "الخميس 25 أيلول · 5:00 مساءً", "office": "مكتب رام الله",
                 "room": "غرفة 1", "staff": "أم محمد"},
                {"when": "الجمعة 26 أيلول · 11:00 صباحاً", "office": "مكتب رام الله",
                 "room": "غرفة 2", "staff": "أبو خالد"},
                {"when": "السبت 27 أيلول · 4:00 مساءً", "office": "مكتب رام الله",
                 "room": "غرفة 1", "staff": "أم محمد"},
            ],
        },
    ]


if __name__ == "__main__":
    asyncio.run(main())
