"""Vendor adapters: protocols in `base`, runnable mocks in `mock`."""

from .base import (
    DocumentVendor,
    EmbeddingIndex,
    FaceVendor,
    LanguageModel,
    LivenessVendor,
    PhoneIntelVendor,
    ReverseImageVendor,
)
from .mock import (
    InMemoryEmbeddingIndex,
    MockDocumentVendor,
    MockFaceVendor,
    MockLanguageModel,
    MockLivenessVendor,
    MockPhoneIntelVendor,
    MockReverseImageVendor,
)


def mock_vendors() -> dict[str, object]:
    """The full vendor set, wired with mocks. Used by tests, the local
    dev server, and the console's demo mode."""
    return {
        "phone": MockPhoneIntelVendor(),
        "liveness": MockLivenessVendor(),
        "document": MockDocumentVendor(),
        "face": MockFaceVendor(),
        "reverse_image": MockReverseImageVendor(),
        "llm": MockLanguageModel(),
        "embedding_index": InMemoryEmbeddingIndex(),
    }


__all__ = [
    "LivenessVendor",
    "DocumentVendor",
    "FaceVendor",
    "ReverseImageVendor",
    "PhoneIntelVendor",
    "LanguageModel",
    "EmbeddingIndex",
    "mock_vendors",
    "MockLivenessVendor",
    "MockDocumentVendor",
    "MockFaceVendor",
    "MockReverseImageVendor",
    "MockPhoneIntelVendor",
    "MockLanguageModel",
    "InMemoryEmbeddingIndex",
]
