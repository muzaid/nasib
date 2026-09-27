"""Vendor adapters.

Liveness and document verification are bought, not built: anti-spoofing is
an arms race against injection attacks and deepfakes, and an in-house
attempt will consume the whole engineering budget for a worse result.

Everything vendor-specific lives behind these protocols so the bake-off
(Onfido / Jumio / Sumsub / Veriff / iDenfy / Regula) can be run by swapping
one implementation, and so no vendor SDK leaks into the pipeline.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class LivenessVendor(Protocol):
    name: str
    cost_per_check_usd: float

    async def check(self, selfie_path: str, *, challenge: str | None = None) -> dict[str, Any]:
        """Return {passed: bool, score: float, spoof_type: str|None, raw: dict}."""
        ...


@runtime_checkable
class DocumentVendor(Protocol):
    name: str
    cost_per_check_usd: float
    supported_countries: set[str]

    async def verify(self, document_path: str, selfie_path: str) -> dict[str, Any]:
        """Return {passed, score, fields: {full_name, date_of_birth, expiry,
        document_type, issuing_country}, face_match_score, raw}."""
        ...


@runtime_checkable
class FaceVendor(Protocol):
    """Run in-house: open face models are strong and the cost is near zero
    at our scale. Kept behind a protocol only so it is swappable."""

    name: str

    async def embed(self, image_path: str) -> list[float]: ...
    async def compare(self, a: list[float], b: list[float]) -> float: ...


@runtime_checkable
class ReverseImageVendor(Protocol):
    name: str
    cost_per_check_usd: float

    async def search(self, image_path: str) -> dict[str, Any]:
        """Return {matches: [{url, domain, similarity}], raw: dict}."""
        ...


@runtime_checkable
class PhoneIntelVendor(Protocol):
    name: str
    cost_per_check_usd: float

    async def lookup(self, phone_e164: str) -> dict[str, Any]:
        """Return {line_type, carrier, country, disposable: bool, risk: float}."""
        ...


@runtime_checkable
class LanguageModel(Protocol):
    """Used for consistency and intent analysis only.

    Never for identity decisions, never for scoring personality, never for
    inferring anything about a face.
    """

    name: str
    cost_per_call_usd: float

    async def analyse(self, system: str, user: str, schema: dict[str, Any]) -> dict[str, Any]: ...


@runtime_checkable
class EmbeddingIndex(Protocol):
    """pgvector, in the isolated `biometric` schema."""

    async def search_active(self, embedding: list[float], threshold: float) -> list[tuple[str, float]]: ...
    async def search_banned(self, embedding: list[float], threshold: float) -> list[tuple[str, float]]: ...
    async def upsert(self, user_id: str, embedding: list[float], model: str) -> None: ...
