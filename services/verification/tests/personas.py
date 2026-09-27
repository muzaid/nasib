"""Test personas.

These are the cases the review desk will actually see. Keeping them as
named fixtures means a threshold change can be evaluated against all of
them at once, which is how you avoid tuning the agent by anecdote.
"""

from __future__ import annotations

import random
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

from app.checks.live_capture import issue_challenge
from app.models import (
    Applicant,
    ChallengeStep,
    DeviceSignals,
    Gender,
    LiveCaptureSession,
    LiveFrame,
    MaritalStatus,
    Photo,
    Tier,
)


def _device(**kw) -> DeviceSignals:
    base = dict(fingerprint=f"fp-{uuid4().hex[:12]}", platform="android",
                integrity_verdict="MEETS_DEVICE_INTEGRITY")
    base.update(kw)
    return DeviceSignals(**base)


# --------------------------------------------------------------------- #
# Guided live capture
# --------------------------------------------------------------------- #

# The pose each instruction should produce. Frames are built to actually
# answer the challenge rather than merely claim to, so a test that expects
# a pass fails loudly if the pose gate tightens.
_POSE = {
    ChallengeStep.LOOK_STRAIGHT: (0.0, 0.0, True),
    ChallengeStep.TURN_LEFT: (32.0, 0.0, True),
    ChallengeStep.TURN_RIGHT: (-30.0, 0.0, True),
    ChallengeStep.LOOK_UP: (0.0, 24.0, True),
    ChallengeStep.BLINK: (0.0, 0.0, False),
    ChallengeStep.SMILE: (3.0, 0.0, True),
    ChallengeStep.SPEAK_DIGITS: (0.0, 0.0, True),
}


def live_session(
    user_id,
    person: str,
    *,
    seed: int = 7,
    frame_person: dict[int, str] | None = None,
    gap_ms: int = 1400,
    expired: bool = False,
    drop_step: bool = False,
    identical_frames: bool = False,
) -> LiveCaptureSession:
    """Build a completed capture session.

    `frame_person` swaps the face in one frame, which is how a test says
    "someone else answered the hard step". `identical_frames` repeats one
    image, which is what a printed photo held to the lens looks like.
    """
    rng = random.Random(seed)
    steps, digits = issue_challenge(rng)

    frames = []
    for i, step in enumerate(steps):
        yaw, pitch, eyes = _POSE[step]
        who = (frame_person or {}).get(i, person)
        path = (
            f"live/person:{who}/frame_0.jpg"
            if identical_frames
            else f"live/person:{who}/frame_{i}.jpg"
        )
        frames.append(
            LiveFrame(
                step=step,
                image_path=path,
                captured_at_ms=(i + 1) * gap_ms,
                yaw=yaw,
                pitch=pitch,
                eyes_open=eyes,
            )
        )

    if drop_step:
        # The challenge stands; one of its steps simply was not answered.
        frames = frames[:-1]

    issued = datetime.now(timezone.utc) - timedelta(seconds=200 if expired else 20)
    return LiveCaptureSession(
        user_id=user_id,
        challenge=steps,
        spoken_digits=digits,
        issued_at=issued,
        expires_at=issued + timedelta(seconds=90),
        frames=frames,
    )


# --------------------------------------------------------------------- #
# Genuine applicants
# --------------------------------------------------------------------- #


def genuine_woman() -> Applicant:
    """Should sail through. If this persona ever needs review, the
    thresholds are wrong and onboarding conversion will collapse."""
    uid = uuid4()
    return Applicant(
        user_id=uid,
        phone_e164="+970599123456",
        gender=Gender.FEMALE,
        date_of_birth=date(1998, 3, 12),
        country_code="PS",
        city="رام الله",
        display_name="أميرة",
        bio=(
            "خريجة صيدلة من جامعة بيرزيت وبشتغل بصيدلية بالبيرة من ثلاث سنين. "
            "عيلتي عارفة إني مسجلة هون وبابا هو الولي. بدور على إنسان متدين، "
            "محترم، وجاد بموضوع الزواج خلال السنة الجاية. بحب القراءة والمشي، "
            "وبفضل نسكن قريب من العيلة بعد الزواج إن شاء الله."
        ),
        education="BSc Pharmacy, Birzeit University",
        occupation="Pharmacist",
        marital_status=MaritalStatus.NEVER_MARRIED,
        children_count=0,
        timeline="within_1_year",
        willing_to_relocate=False,
        family_aware=True,
        selfie_path="selfies/person:amira/live.jpg",
        photos=[
            Photo(storage_path="photos/person:amira/1.jpg", is_primary=True),
            Photo(storage_path="photos/person:amira/2.jpg"),
            Photo(storage_path="photos/person:amira/3.jpg"),
        ],
        device=_device(),
        # The camera step is part of ordinary onboarding now, not an extra.
        live_session=live_session(uid, "amira"),
    )


def genuine_man_gold() -> Applicant:
    """Paid tier, so the document check runs and the three-way match has
    all three references to compare."""
    uid = uuid4()
    return Applicant(
        user_id=uid,
        phone_e164="+962791234567",
        gender=Gender.MALE,
        date_of_birth=date(1994, 7, 2),
        country_code="JO",
        city="عمّان",
        tier=Tier.GOLD,
        display_name="يوسف",
        bio=(
            "Civil engineer working in Amman for the last five years, originally "
            "from a Palestinian family from Al-Khalil. I pray regularly and my "
            "family knows I am looking. I would like to marry within the year and "
            "settle in Amman, though I am open to moving for the right person. "
            "I read a lot of history and play football on Fridays."
        ),
        education="BSc Civil Engineering",
        occupation="Civil engineer",
        marital_status=MaritalStatus.NEVER_MARRIED,
        timeline="within_1_year",
        willing_to_relocate=True,
        family_aware=True,
        selfie_path="selfies/person:yousef/live.jpg",
        document_path="docs/person:yousef/dob:1994/id.jpg",
        photos=[
            Photo(storage_path="photos/person:yousef/1.jpg", is_primary=True),
            Photo(storage_path="photos/person:yousef/2.jpg"),
        ],
        device=_device(platform="ios", integrity_verdict="PASS"),
        live_session=live_session(uid, "yousef"),
    )


# --------------------------------------------------------------------- #
# Identity fraud
# --------------------------------------------------------------------- #


def screen_replay_spoof() -> Applicant:
    """Holding a phone up to the camera. Hard fail, no further spend."""
    p = genuine_man_gold()
    p.user_id = uuid4()
    p.display_name = "رامي"
    p.selfie_path = "selfies/person:unknown/spoof_screen.jpg"
    p.tier = Tier.BRONZE
    p.document_path = None
    p.live_session = None
    return p


def stolen_photos() -> Applicant:
    """He is really there and really follows the instructions — the photos
    are simply not of him. A still selfie handles this badly; the three-way
    match names it exactly."""
    p = genuine_man_gold()
    p.user_id = uuid4()
    p.display_name = "آدم"
    p.tier = Tier.BRONZE
    p.document_path = None
    p.selfie_path = "selfies/person:mystery/live.jpg"
    p.photos = [
        Photo(storage_path="photos/person:model/stolen_instagram_1.jpg", is_primary=True),
        Photo(storage_path="photos/person:model/stolen_instagram_2.jpg"),
    ]
    p.live_session = live_session(p.user_id, "mystery")
    return p


def impostor_holding_id() -> Applicant:
    """Follows every instruction perfectly. It is simply not his ID.

    A still selfie plus a document check can let this through when the
    vendor's own face match is generous. Comparing the *live* face to the
    ID portrait is what catches it."""
    p = genuine_man_gold()
    p.user_id = uuid4()
    p.display_name = "زياد"
    p.selfie_path = "selfies/person:ziad/live.jpg"
    p.photos = [Photo(storage_path="photos/person:ziad/1.jpg", is_primary=True)]
    p.live_session = live_session(p.user_id, "ziad")
    # The document still belongs to Yousef.
    return p


def face_swapped_mid_capture() -> Applicant:
    """One person starts the sequence, another finishes it — the oldest
    trick against a multi-step challenge."""
    p = genuine_woman()
    p.user_id = uuid4()
    p.display_name = "ليلى"
    p.live_session = live_session(p.user_id, "amira", frame_person={2: "stranger"})
    return p


def printed_photo_at_camera() -> Applicant:
    """A printed photo or a screen held up. Every frame is identical, and a
    real face never is."""
    p = genuine_woman()
    p.user_id = uuid4()
    p.display_name = "ميساء"
    p.live_session = live_session(p.user_id, "amira", identical_frames=True)
    return p


def injected_frames() -> Applicant:
    """Frames fed into the camera pipeline faster than a head can turn."""
    p = genuine_woman()
    p.user_id = uuid4()
    p.display_name = "دعاء"
    p.live_session = live_session(p.user_id, "amira", gap_ms=90)
    return p


def skipped_camera_step() -> Applicant:
    """Never did the guided capture. Not a fraud — but not automatically
    admitted either, which is the point of weighting it heavily."""
    p = genuine_woman()
    p.user_id = uuid4()
    p.display_name = "بيان"
    p.live_session = None
    return p


def romance_scammer() -> Applicant:
    """The signature that costs diaspora women the most money."""
    return Applicant(
        user_id=uuid4(),
        phone_e164="+15550001234",
        gender=Gender.MALE,
        date_of_birth=date(1979, 1, 20),
        country_code="US",
        city="Houston",
        display_name="David A.",
        bio=(
            "I am a widowed engineer currently working on an oil rig offshore. "
            "Allah brought us together for a reason. I am serious and I want to "
            "marry soon. Message me on WhatsApp, I do not check this app often. "
            "I also help people with crypto investment if you are interested."
        ),
        occupation="Engineer",
        marital_status=MaritalStatus.WIDOWED,
        timeline="within_6_months",
        willing_to_relocate=True,
        family_aware=False,
        selfie_path="selfies/person:stockman/live.jpg",
        photos=[Photo(storage_path="photos/person:stockman/stolen_1.jpg", is_primary=True)],
        device=_device(is_emulator=False, install_id_seen_count=2),
    )


# --------------------------------------------------------------------- #
# The ambiguous middle
# --------------------------------------------------------------------- #


def married_man_contradiction() -> Applicant:
    """Declares never married with no children; the bio gives him away.
    This is the complaint that will define your reputation if it gets
    through, so it must land in review rather than auto-admit."""
    p = genuine_man_gold()
    p.user_id = uuid4()
    p.display_name = "حسن"
    p.tier = Tier.BRONZE
    p.document_path = None
    p.live_session = live_session(p.user_id, "yousef")
    p.bio = (
        "Engineer in Amman. My kids are the most important thing in my life and "
        "any woman I marry must accept them. Looking for someone serious."
    )
    p.children_count = 0
    p.marital_status = MaritalStatus.NEVER_MARRIED
    return p


def document_age_mismatch() -> Applicant:
    """Says 32 on the profile; the ID says 44. Caught at the paid tier."""
    p = genuine_man_gold()
    p.user_id = uuid4()
    p.display_name = "نبيل"
    p.document_path = "docs/person:yousef/dob:1982/id.jpg"
    p.live_session = live_session(p.user_id, "yousef")
    return p


def low_effort_applicant() -> Applicant:
    """Three words and one photo. Not a fraud, just not ready — should go
    to review, not to a ban."""
    p = genuine_woman()
    p.user_id = uuid4()
    p.display_name = "رنا"
    p.live_session = live_session(p.user_id, "amira")
    p.bio = "بدور على زوج"
    p.education = None
    p.occupation = None
    p.photos = [Photo(storage_path="photos/person:amira/1.jpg", is_primary=True)]
    return p


# --------------------------------------------------------------------- #
# Device and phone
# --------------------------------------------------------------------- #


def device_farm_account() -> Applicant:
    """Fifth account registered from the same handset."""
    p = genuine_woman()
    p.user_id = uuid4()
    p.display_name = "هدى"
    p.device = _device(install_id_seen_count=6, is_rooted=True)
    return p


def emulator_account() -> Applicant:
    p = genuine_woman()
    p.user_id = uuid4()
    p.display_name = "سارة"
    p.device = _device(is_emulator=True, integrity_verdict="FAIL")
    return p


def disposable_number() -> Applicant:
    p = genuine_woman()
    p.user_id = uuid4()
    p.display_name = "نور"
    p.phone_e164 = "+15550009999"
    return p


ALL_PERSONAS = {
    "genuine_woman": genuine_woman,
    "genuine_man_gold": genuine_man_gold,
    "screen_replay_spoof": screen_replay_spoof,
    "stolen_photos": stolen_photos,
    "impostor_holding_id": impostor_holding_id,
    "face_swapped_mid_capture": face_swapped_mid_capture,
    "printed_photo_at_camera": printed_photo_at_camera,
    "injected_frames": injected_frames,
    "skipped_camera_step": skipped_camera_step,
    "romance_scammer": romance_scammer,
    "married_man_contradiction": married_man_contradiction,
    "document_age_mismatch": document_age_mismatch,
    "low_effort_applicant": low_effort_applicant,
    "device_farm_account": device_farm_account,
    "emulator_account": emulator_account,
    "disposable_number": disposable_number,
}
