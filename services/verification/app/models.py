"""Domain types for the verification pipeline.

Two numbers are kept and never blended: identity confidence (are you who
you say you are) and intent confidence (are you here to marry). The first
drives the badge the user sees; the second drives ranking and review
priority and is never shown to anyone outside the console.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class CheckType(str, Enum):
    PHONE = "phone"
    DEVICE = "device"
    LIVENESS = "liveness"
    LIVE_CAPTURE = "live_capture"
    THREE_WAY_MATCH = "three_way_match"
    FACE_MATCH = "face_match"
    DUPLICATE_FACE = "duplicate_face"
    REVERSE_IMAGE = "reverse_image"
    DOCUMENT = "document"
    CONSISTENCY = "consistency"
    INTENT = "intent"
    SCAM_PATTERN = "scam_pattern"
    BEHAVIOURAL = "behavioural"


class CheckResult(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    INCONCLUSIVE = "inconclusive"
    SKIPPED = "skipped"
    ERROR = "error"


class Band(str, Enum):
    AUTO_ADMIT = "auto_admit"
    REVIEW = "review"
    AUTO_REJECT = "auto_reject"


class Gender(str, Enum):
    MALE = "male"
    FEMALE = "female"


class MaritalStatus(str, Enum):
    NEVER_MARRIED = "never_married"
    DIVORCED = "divorced"
    WIDOWED = "widowed"


class Tier(str, Enum):
    BRONZE = "bronze"
    GOLD = "gold"
    FAMILY = "family"


class Photo(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    storage_path: str
    is_primary: bool = False


# --------------------------------------------------------------------- #
# Guided live capture
# --------------------------------------------------------------------- #


class ChallengeStep(str, Enum):
    """One instruction in the sequence the user is asked to perform.

    The sequence is issued by the server, randomised per session and
    short-lived. That is the whole point: a pre-recorded video cannot
    satisfy an order it was filmed before.
    """

    LOOK_STRAIGHT = "look_straight"
    TURN_LEFT = "turn_left"
    TURN_RIGHT = "turn_right"
    LOOK_UP = "look_up"
    BLINK = "blink"
    SMILE = "smile"
    SPEAK_DIGITS = "speak_digits"


class LiveFrame(BaseModel):
    """A single captured frame, tagged with the step it answers."""

    step: ChallengeStep
    image_path: str
    captured_at_ms: int          # ms since the session started
    face_bbox: tuple[float, float, float, float] | None = None
    yaw: float | None = None     # degrees, + is the user's left
    pitch: float | None = None
    eyes_open: bool | None = None


class LiveCaptureSession(BaseModel):
    """Issued by the server, answered by the client."""

    session_id: UUID = Field(default_factory=uuid4)
    user_id: UUID
    challenge: list[ChallengeStep]
    spoken_digits: str | None = None      # when SPEAK_DIGITS is in the list
    issued_at: datetime
    expires_at: datetime
    frames: list[LiveFrame] = Field(default_factory=list)


class MatchPair(str, Enum):
    """Which two things were compared. Naming the pair is what makes a
    failure actionable: "your photos are of someone else" and "the person
    holding this ID is not its owner" are different problems with
    different responses."""

    LIVE_TO_DOCUMENT = "live_to_document"
    LIVE_TO_PHOTOS = "live_to_photos"
    DOCUMENT_TO_PHOTOS = "document_to_photos"


class PairScore(BaseModel):
    pair: MatchPair
    similarity: float
    threshold: float
    matched: bool


class DeviceSignals(BaseModel):
    fingerprint: str
    platform: Literal["ios", "android"]
    integrity_verdict: str | None = None       # Play Integrity / App Attest
    is_emulator: bool = False
    is_rooted: bool = False
    vpn_detected: bool = False
    install_id_seen_count: int = 1             # same device, how many accounts


class Applicant(BaseModel):
    """Everything the pipeline is allowed to see about one applicant."""

    user_id: UUID
    phone_e164: str
    gender: Gender
    date_of_birth: date
    country_code: str
    city: str | None = None
    locale: str = "ar"
    tier: Tier = Tier.BRONZE

    display_name: str
    bio: str | None = None
    education: str | None = None
    occupation: str | None = None
    marital_status: MaritalStatus
    children_count: int = 0
    timeline: str
    willing_to_relocate: bool = False
    family_aware: bool = False

    photos: list[Photo] = Field(default_factory=list)
    selfie_path: str | None = None
    document_path: str | None = None
    device: DeviceSignals | None = None

    # The guided capture, when the applicant completed one. Carried on the
    # applicant rather than passed separately, so every call site that
    # already had an Applicant keeps working.
    live_session: LiveCaptureSession | None = None

    @property
    def age(self) -> int:
        today = date.today()
        return (
            today.year
            - self.date_of_birth.year
            - ((today.month, today.day) < (self.date_of_birth.month, self.date_of_birth.day))
        )


class Finding(BaseModel):
    """A specific, quotable problem. Never a vibe, never a bare number."""

    code: str
    detail: str
    quote: str | None = None
    severity: Literal["low", "medium", "high", "critical"] = "medium"


class CheckOutcome(BaseModel):
    type: CheckType
    result: CheckResult
    score: float | None = None                  # 0..1, vendor-native where meaningful
    vendor: str | None = None
    findings: list[Finding] = Field(default_factory=list)
    details: dict[str, Any] = Field(default_factory=dict)
    cost_usd: float = 0.0
    hard_fail: bool = False                     # short-circuits the pipeline
    duration_ms: int = 0


class TrustScore(BaseModel):
    identity_confidence: int = Field(ge=0, le=100)
    intent_confidence: int = Field(ge=0, le=100)
    band: Band
    rationale: list[str] = Field(default_factory=list)


class PipelineRun(BaseModel):
    run_id: UUID = Field(default_factory=uuid4)
    user_id: UUID
    agent_version: str
    started_at: datetime
    finished_at: datetime | None = None
    outcomes: list[CheckOutcome] = Field(default_factory=list)
    trust: TrustScore | None = None
    total_cost_usd: float = 0.0
    short_circuited_on: CheckType | None = None

    def by_type(self, t: CheckType) -> CheckOutcome | None:
        for o in self.outcomes:
            if o.type == t:
                return o
        return None

    @property
    def all_findings(self) -> list[Finding]:
        return [f for o in self.outcomes for f in o.findings]


class EvidencePacket(BaseModel):
    """What a reviewer sees on one screen.

    The agent's recommendation comes last so the reviewer forms a view
    before being anchored by it.
    """

    run: PipelineRun
    applicant: Applicant
    duplicate_accounts: list[UUID] = Field(default_factory=list)
    prior_reports: int = 0
    recommendation: Band | None = None
    recommendation_reasons: list[str] = Field(default_factory=list)
