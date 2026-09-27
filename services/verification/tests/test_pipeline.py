"""Behavioural tests for the verification agent.

These assert on *decisions*, not on implementation details, so thresholds
can be retuned without rewriting the suite. When you change a threshold,
this file tells you which personas moved.
"""

from __future__ import annotations

import pytest

from app.models import Band, CheckResult, CheckType
from app.pipeline import VerificationAgent
from app.checks.live_capture import _centroid
from app.vendors import mock_vendors

from .personas import (
    device_farm_account,
    disposable_number,
    document_age_mismatch,
    face_swapped_mid_capture,
    impostor_holding_id,
    injected_frames,
    live_session,
    printed_photo_at_camera,
    skipped_camera_step,
    emulator_account,
    genuine_man_gold,
    genuine_woman,
    low_effort_applicant,
    married_man_contradiction,
    romance_scammer,
    screen_replay_spoof,
    stolen_photos,
)


@pytest.fixture
def agent() -> VerificationAgent:
    return VerificationAgent(mock_vendors())


# --------------------------------------------------------------------- #
# Genuine applicants must not be punished for being genuine.
# --------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_genuine_woman_is_admitted(agent):
    run = await agent.run(genuine_woman())
    assert run.trust.band is Band.AUTO_ADMIT, run.trust.rationale
    assert run.trust.identity_confidence >= 85
    assert run.trust.intent_confidence >= 70


@pytest.mark.asyncio
async def test_gold_tier_runs_the_document_check(agent):
    run = await agent.run(genuine_man_gold())
    doc = run.by_type(CheckType.DOCUMENT)
    assert doc is not None and doc.result is CheckResult.PASS
    assert run.trust.band is Band.AUTO_ADMIT


@pytest.mark.asyncio
async def test_bronze_tier_skips_the_document_check(agent):
    applicant = genuine_woman()
    run = await agent.run(applicant)
    doc = run.by_type(CheckType.DOCUMENT)
    assert doc is None or doc.result is CheckResult.SKIPPED
    # ... and is still admitted, which is the whole point of the tier.
    assert run.trust.band is Band.AUTO_ADMIT


# --------------------------------------------------------------------- #
# Fraud must be stopped, and stopped cheaply.
# --------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_presentation_attack_is_rejected(agent):
    run = await agent.run(screen_replay_spoof())
    assert run.trust.band is Band.AUTO_REJECT
    assert run.short_circuited_on is CheckType.LIVENESS
    assert any("screen_replay" in f.code for f in run.all_findings)


@pytest.mark.asyncio
async def test_hard_fail_stops_spending(agent):
    """A spoofed selfie must not go on to pay for a document check."""
    spoof = await agent.run(screen_replay_spoof())
    clean = await agent.run(genuine_man_gold())
    assert spoof.total_cost_usd < clean.total_cost_usd
    assert spoof.total_cost_usd < 0.40


@pytest.mark.asyncio
async def test_stolen_photos_are_caught(agent):
    run = await agent.run(stolen_photos())
    codes = {f.code for f in run.all_findings}
    # Named by the pair that failed, not as a generic "face mismatch":
    # "the photos are of someone else" is a different problem from
    # "the man holding this ID is not its owner".
    assert "live_not_photos" in codes
    assert run.trust.band is Band.AUTO_REJECT


@pytest.mark.asyncio
async def test_romance_scammer_is_rejected(agent):
    run = await agent.run(romance_scammer())
    assert run.trust.band is Band.AUTO_REJECT
    codes = {f.code for f in run.all_findings}
    assert any(c.startswith("scam_") or c == "disposable_number" for c in codes)


@pytest.mark.asyncio
async def test_disposable_number_fails_first_and_cheapest(agent):
    run = await agent.run(disposable_number())
    assert run.short_circuited_on is CheckType.PHONE
    assert run.total_cost_usd <= 0.03
    assert run.trust.band is Band.AUTO_REJECT


@pytest.mark.asyncio
async def test_emulator_is_rejected(agent):
    run = await agent.run(emulator_account())
    assert run.trust.band is Band.AUTO_REJECT
    assert "emulator" in {f.code for f in run.all_findings}


@pytest.mark.asyncio
async def test_device_farm_is_rejected(agent):
    run = await agent.run(device_farm_account())
    assert run.trust.band is Band.AUTO_REJECT
    assert "device_reuse" in {f.code for f in run.all_findings}


# --------------------------------------------------------------------- #
# The ambiguous middle must reach a human, not a machine verdict.
# --------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_contradiction_goes_to_review_not_to_a_ban(agent):
    run = await agent.run(married_man_contradiction())
    assert run.trust.band is Band.REVIEW
    finding = next(f for f in run.all_findings if f.code == "children_contradiction")
    assert finding.quote, "a contradiction must be quotable or a reviewer cannot act on it"


@pytest.mark.asyncio
async def test_low_effort_is_reviewed_not_rejected(agent):
    """Not a fraud, just not ready. A clean selfie must not carry a
    three-word bio into automatic admission."""
    run = await agent.run(low_effort_applicant())
    assert run.trust.band is Band.REVIEW
    assert "minimal_bio" in {f.code for f in run.all_findings}


@pytest.mark.asyncio
async def test_an_incomplete_check_blocks_automatic_admission(agent):
    class SlowVendor:
        name = "slow"
        cost_per_check_usd = 0.0

        async def search(self, *a, **kw):
            raise TimeoutError("vendor timeout")

    agent.vendors["reverse_image"] = SlowVendor()
    run = await agent.run(genuine_woman())
    assert run.trust.band is Band.REVIEW
    assert any("could not be completed" in r for r in run.trust.rationale)


@pytest.mark.asyncio
async def test_document_contradicting_declared_age_is_caught(agent):
    run = await agent.run(document_age_mismatch())
    assert "age_contradiction" in {f.code for f in run.all_findings}
    assert run.trust.band is not Band.AUTO_ADMIT


# --------------------------------------------------------------------- #
# Duplicate accounts and banned users returning.
# --------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_same_face_twice_is_flagged_as_duplicate(agent):
    first = genuine_woman()
    await agent.run(first)

    second = genuine_woman()          # same photo paths, new user id
    run = await agent.run(second)

    dup = run.by_type(CheckType.DUPLICATE_FACE)
    assert dup is not None and dup.result is CheckResult.FAIL
    assert run.trust.band is not Band.AUTO_ADMIT


@pytest.mark.asyncio
async def test_banned_face_cannot_return(agent):
    """A removed account must not come back by doing the camera step
    instead of uploading a selfie. The ban list and the live capture have
    to be built from the same reference, or the ban is decorative."""
    applicant = genuine_woman()
    face = agent.vendors["face"]
    index = agent.vendors["embedding_index"]

    frames = [await face.embed(f.image_path) for f in applicant.live_session.frames]
    await index.ban(_centroid(frames))

    run = await agent.run(applicant)
    assert run.trust.band is Band.AUTO_REJECT
    assert "banned_user_returning" in {f.code for f in run.all_findings}


# --------------------------------------------------------------------- #
# Guided live capture
# --------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_completing_the_camera_step_is_what_earns_admission(agent):
    """A still selfie alone is deliberately not enough any more."""
    with_camera = await agent.run(genuine_woman())
    without = await agent.run(skipped_camera_step())

    assert with_camera.trust.band is Band.AUTO_ADMIT
    assert without.trust.band is Band.REVIEW
    assert without.trust.identity_confidence < with_camera.trust.identity_confidence


@pytest.mark.asyncio
async def test_impostor_holding_someone_elses_id_is_caught(agent):
    """He is really there and follows every instruction. The ID is not his.

    A still selfie plus a generous vendor face-match can let this through;
    comparing the live face to the ID portrait is what stops it."""
    run = await agent.run(impostor_holding_id())
    assert run.trust.band is Band.AUTO_REJECT
    assert "live_not_id" in {f.code for f in run.all_findings}


@pytest.mark.asyncio
async def test_face_swapped_mid_sequence_is_caught(agent):
    run = await agent.run(face_swapped_mid_capture())
    assert run.trust.band is Band.AUTO_REJECT
    assert "face_changed_mid_capture" in {f.code for f in run.all_findings}


@pytest.mark.asyncio
async def test_a_photo_held_to_the_lens_is_too_consistent(agent):
    """The counter-intuitive signal: a real face varies between frames and
    a printed photo does not. Review rather than rejection, because an
    unusually still person is a plausible false positive."""
    run = await agent.run(printed_photo_at_camera())
    assert "unnaturally_consistent" in {f.code for f in run.all_findings}
    assert run.trust.band is Band.REVIEW


@pytest.mark.asyncio
async def test_injected_frames_are_caught_on_timing(agent):
    run = await agent.run(injected_frames())
    assert run.trust.band is Band.AUTO_REJECT
    assert "impossible_timing" in {f.code for f in run.all_findings}


@pytest.mark.asyncio
async def test_capture_fraud_is_caught_before_anything_is_paid_for(agent):
    """The guided capture runs in-house at stage 1, so the most decisive
    identity checks are also among the cheapest."""
    run = await agent.run(face_swapped_mid_capture())
    assert run.total_cost_usd <= 0.05


@pytest.mark.asyncio
async def test_a_challenge_is_never_the_same_twice(agent):
    """The sequence is what a pre-recorded video cannot satisfy, so it has
    to actually vary between sessions."""
    import uuid
    sequences = {
        tuple(s.value for s in live_session(uuid.uuid4(), "amira", seed=i).challenge)
        for i in range(25)
    }
    assert len(sequences) > 5, "challenge sequences are not varying enough to be unforgeable"


@pytest.mark.asyncio
async def test_an_expired_session_asks_for_a_retake_rather_than_rejecting(agent):
    applicant = genuine_woman()
    applicant.live_session = live_session(applicant.user_id, "amira", expired=True)
    run = await agent.run(applicant)

    capture = run.by_type(CheckType.LIVE_CAPTURE)
    assert capture.result is CheckResult.INCONCLUSIVE
    assert run.trust.band is not Band.AUTO_REJECT


@pytest.mark.asyncio
async def test_skipping_a_step_is_reported(agent):
    applicant = genuine_woman()
    applicant.live_session = live_session(applicant.user_id, "amira", drop_step=True)
    run = await agent.run(applicant)
    assert "challenge_not_followed" in {f.code for f in run.all_findings}


# --------------------------------------------------------------------- #
# Guarantees that hold for every persona.
# --------------------------------------------------------------------- #


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "make",
    [genuine_woman, genuine_man_gold, screen_replay_spoof, stolen_photos,
     romance_scammer, married_man_contradiction, low_effort_applicant],
)
async def test_every_rejection_carries_a_reason(agent, make):
    run = await agent.run(make())
    if run.trust.band is Band.AUTO_REJECT:
        assert run.trust.rationale, "a rejection with no stated reason cannot be appealed"


@pytest.mark.asyncio
async def test_a_vendor_outage_never_bans_anyone(agent):
    class BrokenLiveness:
        name = "broken"
        cost_per_check_usd = 0.0

        async def check(self, *a, **kw):
            raise ConnectionError("vendor timeout")

    agent.vendors["liveness"] = BrokenLiveness()
    run = await agent.run(genuine_woman())

    liveness = run.by_type(CheckType.LIVENESS)
    assert liveness.result is CheckResult.ERROR
    assert run.trust.band is not Band.AUTO_REJECT, "an outage must degrade to review, not rejection"


@pytest.mark.asyncio
async def test_evidence_packet_puts_recommendation_last(agent):
    applicant = married_man_contradiction()
    run = await agent.run(applicant)
    packet = await agent.evidence_packet(applicant, run, prior_reports=0)

    # Field order is the render order in the console: evidence first so the
    # reviewer forms a view before seeing the agent's opinion.
    fields = list(packet.model_dump().keys())
    assert fields.index("run") < fields.index("recommendation")
    assert packet.recommendation is Band.REVIEW
