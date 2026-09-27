"""Deterministic mock vendors.

These let the whole pipeline, the console and the tests run end to end with
no vendor account and no spend. Behaviour is driven by markers in the file
path so a test persona can be described declaratively:

    "selfies/amira_ok.jpg"          -> clean pass
    "selfies/omar_spoof.jpg"        -> liveness fail (screen replay)
    "photos/stolen_instagram.jpg"   -> reverse image hit
    "docs/fake_expired.jpg"         -> document fail

Swap these for a real adapter one file at a time; nothing else changes.
"""

from __future__ import annotations

import hashlib
import math
import random
from datetime import date
from typing import Any


def _seed(path: str) -> random.Random:
    return random.Random(int(hashlib.sha256(path.encode()).hexdigest()[:8], 16))


def _unit_vector(path: str, dim: int = 512) -> list[float]:
    rnd = _seed(path)
    v = [rnd.gauss(0, 1) for _ in range(dim)]
    norm = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / norm for x in v]


class MockLivenessVendor:
    name = "mock-liveness"
    cost_per_check_usd = 0.25

    async def check(self, selfie_path: str, *, challenge: str | None = None) -> dict[str, Any]:
        if "spoof" in selfie_path or "screen" in selfie_path:
            return {"passed": False, "score": 0.12, "spoof_type": "screen_replay", "raw": {}}
        if "mask" in selfie_path:
            return {"passed": False, "score": 0.20, "spoof_type": "presentation_attack", "raw": {}}
        if "deepfake" in selfie_path:
            return {"passed": False, "score": 0.31, "spoof_type": "injection", "raw": {}}
        if "blurry" in selfie_path:
            return {"passed": False, "score": 0.55, "spoof_type": None, "raw": {"quality": "low"}}
        return {"passed": True, "score": 0.96, "spoof_type": None, "raw": {}}


class MockDocumentVendor:
    name = "mock-document"
    cost_per_check_usd = 1.60
    supported_countries = {"PS", "JO", "IL", "EG", "AE", "SA", "GB", "US", "DE", "CL", "TR"}

    async def verify(self, document_path: str, selfie_path: str) -> dict[str, Any]:
        if "fake" in document_path or "expired" in document_path:
            return {
                "passed": False,
                "score": 0.18,
                "fields": {},
                "face_match_score": 0.0,
                "raw": {"reason": "tampering_detected" if "fake" in document_path else "expired"},
            }
        rnd = _seed(document_path)
        fields: dict[str, Any] = {
            "full_name": "REDACTED",
            "expiry": "2031-04-18",
            "document_type": "national_id",
            "issuing_country": "PS",
        }
        # A `dob:YYYY` marker in the path lets a test express "the document
        # says a different birth year than the applicant declared".
        if "dob:" in document_path:
            year = int(document_path.split("dob:")[1][:4])
            fields["date_of_birth"] = date(year, rnd.randint(1, 12), rnd.randint(1, 28)).isoformat()

        return {
            "passed": True,
            "score": 0.94,
            "fields": fields,
            "face_match_score": 0.91,
            "raw": {},
        }


class MockFaceVendor:
    """Cosine similarity over deterministic pseudo-embeddings.

    Paths sharing a `person:<name>` marker embed close together, which is
    how the tests express "these images are the same human". They are not
    embedded *identically*, though, and that distinction matters: two
    frames of a live face are alike but never the same, while a printed
    photo held to the lens produces byte-identical frames. The pipeline
    treats near-perfect consistency as evidence of a static image, so a
    mock that returned 1.0 for every frame of one person would make that
    detector fire on everybody.

    Same person, different frames  -> ~0.985
    Same path twice                -> exactly 1.0
    Different people               -> ~0.0
    """

    name = "mock-face"

    # Identity carries ~98.5% of the vector; the rest is per-image jitter.
    _IDENTITY = 1.0
    _JITTER = 0.123

    async def embed(self, image_path: str) -> list[float]:
        person = image_path
        if "person:" in image_path:
            person = "person:" + image_path.split("person:")[1].split("/")[0]

        identity = _unit_vector(person)
        if person == image_path:
            return identity

        jitter = _unit_vector(image_path)
        mixed = [
            self._IDENTITY * a + self._JITTER * b
            for a, b in zip(identity, jitter)
        ]
        norm = math.sqrt(sum(x * x for x in mixed)) or 1.0
        return [x / norm for x in mixed]

    async def compare(self, a: list[float], b: list[float]) -> float:
        return max(-1.0, min(1.0, sum(x * y for x, y in zip(a, b))))


class MockReverseImageVendor:
    name = "mock-reverse-image"
    cost_per_check_usd = 0.03

    async def search(self, image_path: str) -> dict[str, Any]:
        if "stolen" in image_path or "instagram" in image_path:
            return {
                "matches": [
                    {"url": "https://example.com/p/abc", "domain": "instagram.com", "similarity": 0.97},
                    {"url": "https://example.com/model/12", "domain": "shutterstock.com", "similarity": 0.88},
                ],
                "raw": {},
            }
        return {"matches": [], "raw": {}}


class MockPhoneIntelVendor:
    name = "mock-phone-intel"
    cost_per_check_usd = 0.02

    async def lookup(self, phone_e164: str) -> dict[str, Any]:
        if phone_e164.startswith("+1555") or "voip" in phone_e164:
            return {"line_type": "voip", "carrier": "Disposable Inc", "country": "US",
                    "disposable": True, "risk": 0.92}
        return {"line_type": "mobile", "carrier": "Jawwal", "country": "PS",
                "disposable": False, "risk": 0.05}


class MockLanguageModel:
    """Pattern-driven stand-in for the LLM.

    The real implementation calls a model with the prompts in
    `app/prompts.py`. The mock reproduces the same output schema so the
    pipeline, scoring and console can be developed and tested without an
    API key — and so the test suite is deterministic.
    """

    name = "mock-llm"
    cost_per_call_usd = 0.02

    async def analyse(self, system: str, user: str, schema: dict[str, Any]) -> dict[str, Any]:
        # Judge the applicant's own words, not the structured fields the
        # template wraps around them.
        bio = user.split('"""')[1] if '"""' in user else user
        text = bio.lower()           # the applicant's own words
        full = user.lower()          # words plus the structured fields
        contradictions: list[dict[str, str]] = []
        scam_signals: list[str] = []

        if "my kids" in text or "أولادي" in bio or "my children" in text:
            if "never_married" in full and "children_count: 0" in full:
                contradictions.append({
                    "code": "children_contradiction",
                    "detail": "Profile declares no children, bio refers to the applicant's own children.",
                    "quote": "my kids",
                })

        for token in ("oil rig", "widowed engineer", "crypto", "bitcoin", "gold investment",
                      "send me", "western union", "whatsapp me", "بيتكوين"):
            if token in text:
                scam_signals.append(token)

        if "whatsapp" in text or "telegram" in text or "instagram" in text or "snap" in text:
            scam_signals.append("off_platform_push")

        intent = "marriage_seeking"
        if scam_signals:
            intent = "scam_or_commercial"
        elif any(t in text for t in ("just chatting", "fun", "no strings", "دردشة")):
            intent = "casual_seeking"
        elif not text.strip() or len(text) < 120:
            intent = "ambiguous"

        effort = min(1.0, len(bio.strip()) / 400.0)

        return {
            "intent": intent,
            "intent_confidence": 0.9 if intent == "marriage_seeking" else 0.6,
            "contradictions": contradictions,
            "scam_signals": scam_signals,
            "effort": round(effort, 2),
            "language": "ar" if any("؀" <= c <= "ۿ" for c in bio) else "en",
        }


class InMemoryEmbeddingIndex:
    """Stand-in for pgvector, same interface."""

    def __init__(self) -> None:
        self._active: dict[str, list[float]] = {}
        self._banned: list[list[float]] = []

    @staticmethod
    def _cos(a: list[float], b: list[float]) -> float:
        return sum(x * y for x, y in zip(a, b))

    async def search_active(self, embedding: list[float], threshold: float) -> list[tuple[str, float]]:
        hits = [(uid, self._cos(embedding, v)) for uid, v in self._active.items()]
        return sorted([h for h in hits if h[1] >= threshold], key=lambda h: -h[1])

    async def search_banned(self, embedding: list[float], threshold: float) -> list[tuple[str, float]]:
        hits = [("banned", self._cos(embedding, v)) for v in self._banned]
        return sorted([h for h in hits if h[1] >= threshold], key=lambda h: -h[1])

    async def upsert(self, user_id: str, embedding: list[float], model: str) -> None:
        self._active[user_id] = embedding

    async def ban(self, embedding: list[float]) -> None:
        self._banned.append(embedding)
