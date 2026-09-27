-- =====================================================================
-- Table privileges.
--
-- RLS filters rows; GRANT decides whether a table is reachable at all.
-- Both are used deliberately here: tables a user has a legitimate reason
-- to query are granted and filtered by policy, and tables no client should
-- ever touch are simply not granted, so an attempt errors at the door
-- rather than quietly returning an empty set.
-- =====================================================================

grant usage on schema public to authenticated, anon;

-- --- reachable by a signed-in client, filtered by policy ---------------

grant select, insert, update on
  users, profiles, match_preferences, compatibility_answers, photos
to authenticated;

grant select on
  verifications, trust_scores, devices, guardians,
  candidate_slates, subscriptions
to authenticated;

grant insert, update, delete on guardians to authenticated;
grant insert, update on match_preferences, compatibility_answers to authenticated;
grant update on candidate_items to authenticated;
grant select on candidate_items to authenticated;

grant select, update on matches to authenticated;
grant select, insert on messages to authenticated;
grant select, insert on reports, appeals, outcomes to authenticated;
grant select, insert, delete on blocks to authenticated;

-- --- unreachable by any client, whatever the policy --------------------
-- Biometric data, raw vendor payloads, ban lists and the reviewer access
-- log. Nothing in the app needs these; the verification service and the
-- console reach them with the service role.

revoke all on verification_evidence, trust_score_history,
              banned_devices, banned_phones, admin_access_log
from authenticated, anon;

revoke all on all tables in schema biometric from authenticated, anon;
revoke usage on schema biometric from authenticated, anon;

-- --- callable functions ------------------------------------------------

grant execute on function draw_daily_slate(uuid, int) to authenticated;
grant execute on function express_interest(uuid, uuid, boolean, text) to authenticated;
grant execute on function unlock_contact(uuid) to authenticated;
grant execute on function eligible_candidates(uuid) to authenticated;
grant execute on function compatibility_score(uuid, uuid) to authenticated;

-- Retention jobs and the purge functions are service-role only.
revoke execute on function purge_expired_evidence() from authenticated, anon;
revoke execute on function purge_stale_messages() from authenticated, anon;

-- Anonymous callers can do nothing but sign up.
revoke all on all tables in schema public from anon;
