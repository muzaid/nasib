"""FastAPI surface for the verification service.

Deliberately a separate service from the app API: different scaling,
different secrets, and — most importantly — it keeps biometric data out of
the main database's blast radius. Splitting it later, after embeddings have
spread through the primary schema, is a migration nobody enjoys.
"""

from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from uuid import UUID

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from .checks.live_capture import SESSION_SECONDS, issue_challenge
from .models import (
    Applicant,
    Band,
    ChallengeStep,
    EvidencePacket,
    LiveCaptureSession,
    LiveFrame,
)
from .pipeline import VerificationAgent, summarise
from .vendors import mock_vendors

app = FastAPI(
    title="Nasib verification service",
    version="1.0.0",
    description="Identity and intent verification for a gated-entry marriage platform.",
)

USE_MOCKS = os.getenv("NASIB_USE_MOCK_VENDORS", "1") == "1"
SERVICE_TOKEN = os.getenv("NASIB_SERVICE_TOKEN", "dev-token")

def _build_agent() -> VerificationAgent:
    return VerificationAgent(mock_vendors() if USE_MOCKS else _real_vendors())


_agent: VerificationAgent | None = None


def agent() -> VerificationAgent:
    global _agent
    if _agent is None:
        _agent = _build_agent()
    return _agent


# Runs are cached in memory here for the dev server; in production they are
# written to `verifications` / `verification_evidence` and read back by the
# console.
_runs: dict[str, Any] = {}


def _authorise(token: str | None) -> None:
    if token != f"Bearer {SERVICE_TOKEN}":
        raise HTTPException(status_code=401, detail="unauthorised")


class VerifyRequest(BaseModel):
    applicant: Applicant
    require_document: bool = False
    require_active_challenge: bool = False


class VerifyResponse(BaseModel):
    run_id: UUID
    band: Band
    identity_confidence: int
    intent_confidence: int
    user_message: str
    cost_usd: float


# What the applicant is told. Never the score, never the internal codes —
# a specific reason and, for a rejection, one route to appeal.
USER_MESSAGES = {
    Band.AUTO_ADMIT: "Your profile is approved. Welcome.",
    Band.REVIEW: (
        "A member of our team is reviewing your application. "
        "This usually takes a few hours and never more than 12."
    ),
    Band.AUTO_REJECT: (
        "We could not verify your application. If you believe this is a mistake, "
        "you can appeal and a person will look at it."
    ),
}


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "vendors": "mock" if USE_MOCKS else "live"}


@app.post("/v1/verify", response_model=VerifyResponse)
async def verify(req: VerifyRequest, authorization: str | None = Header(default=None)) -> VerifyResponse:
    _authorise(authorization)

    a = agent()
    run = await a.run(
        req.applicant,
        require_document=req.require_document,
        require_active_challenge=req.require_active_challenge,
    )
    packet = await a.evidence_packet(req.applicant, run)
    _runs[str(run.run_id)] = packet

    assert run.trust is not None
    return VerifyResponse(
        run_id=run.run_id,
        band=run.trust.band,
        identity_confidence=run.trust.identity_confidence,
        intent_confidence=run.trust.intent_confidence,
        user_message=USER_MESSAGES[run.trust.band],
        cost_usd=round(run.total_cost_usd, 4),
    )


@app.get("/v1/runs/{run_id}", response_model=EvidencePacket)
async def get_run(run_id: str, authorization: str | None = Header(default=None)) -> EvidencePacket:
    """The evidence packet the console renders."""
    _authorise(authorization)
    packet = _runs.get(run_id)
    if packet is None:
        raise HTTPException(status_code=404, detail="run not found")
    return packet


@app.get("/v1/runs/{run_id}/summary")
async def get_summary(run_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    _authorise(authorization)
    packet = _runs.get(run_id)
    if packet is None:
        raise HTTPException(status_code=404, detail="run not found")
    return summarise(packet.run)


def _real_vendors() -> dict[str, Any]:
    """Wire live vendors here after the bake-off.

    Evaluate on MENA document coverage (Palestinian, Jordanian, Israeli,
    Gulf and the major diaspora passports), Arabic OCR quality, injection
    resistance, per-check price, and willingness to sign a DPA with EU
    data residency. Coverage claims in this region are frequently
    overstated — test with real documents before committing.
    """
    raise NotImplementedError(
        "Set NASIB_USE_MOCK_VENDORS=1 for local development, or implement this "
        "after the vendor bake-off."
    )


# ===================================================================== #
# Guided live capture
#
# Two calls. The client asks for a challenge, performs it, and sends the
# frames back. The challenge is issued here and never by the device: a
# client that picks its own challenge has not been challenged.
# ===================================================================== #

_sessions: dict[str, LiveCaptureSession] = {}


class ChallengeResponse(BaseModel):
    session_id: UUID
    steps: list[ChallengeStep]
    spoken_digits: str | None
    expires_at: datetime


class SubmitCaptureRequest(BaseModel):
    session_id: UUID
    frames: list[LiveFrame]
    applicant: Applicant


class CaptureVerdictResponse(BaseModel):
    verdict: Literal[
        "matched", "not_your_photos", "not_your_id", "retake", "under_review"
    ]
    user_message: str
    run_id: UUID


# What the user is told. Never a score, never the internal check names, and
# never the word "failed" for a capture that simply did not come out.
CAPTURE_MESSAGES = {
    "matched": "الوجه الذي أمام الكاميرا يطابق صورك ويطابق هويتك.",
    "not_your_photos": "الوجه أمام الكاميرا لا يطابق الصور التي رفعتها.",
    "not_your_id": "الوجه أمام الكاميرا لا يطابق صورة الهوية.",
    "retake": "لم تتضح الصورة. جرّب في مكان أوضح، وأبعد الهاتف قليلاً.",
    "under_review": "شخص من فريقنا سيتأكد بنفسه. سنُشعرك خلال ساعات.",
}


@app.post("/v1/live-capture/challenge", response_model=ChallengeResponse)
async def start_capture(
    user_id: UUID, authorization: str | None = Header(default=None)
) -> ChallengeResponse:
    _authorise(authorization)

    steps, digits = issue_challenge(secrets.SystemRandom())
    now = datetime.now(timezone.utc)
    session = LiveCaptureSession(
        user_id=user_id,
        challenge=steps,
        spoken_digits=digits,
        issued_at=now,
        expires_at=now + timedelta(seconds=SESSION_SECONDS),
    )
    _sessions[str(session.session_id)] = session

    return ChallengeResponse(
        session_id=session.session_id,
        steps=steps,
        spoken_digits=digits,
        expires_at=session.expires_at,
    )


@app.post("/v1/live-capture/submit", response_model=CaptureVerdictResponse)
async def submit_capture(
    req: SubmitCaptureRequest, authorization: str | None = Header(default=None)
) -> CaptureVerdictResponse:
    _authorise(authorization)

    session = _sessions.pop(str(req.session_id), None)
    if session is None:
        # Single use. A session that could be replayed is not a challenge.
        raise HTTPException(status_code=404, detail="no such session")
    if session.user_id != req.applicant.user_id:
        raise HTTPException(status_code=403, detail="session belongs to another user")

    session.frames = req.frames
    req.applicant.live_session = session

    a = agent()
    run = await a.run(req.applicant)
    packet = await a.evidence_packet(req.applicant, run)
    _runs[str(run.run_id)] = packet

    codes = {f.code for f in run.all_findings}
    if "live_not_id" in codes:
        verdict = "not_your_id"
    elif "live_not_photos" in codes:
        verdict = "not_your_photos"
    elif codes & {"live_session_expired", "liveness_low_quality"}:
        verdict = "retake"
    elif run.trust and run.trust.band is Band.AUTO_ADMIT:
        verdict = "matched"
    else:
        verdict = "under_review"

    return CaptureVerdictResponse(
        verdict=verdict,
        user_message=CAPTURE_MESSAGES[verdict],
        run_id=run.run_id,
    )
