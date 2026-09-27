-- ---------------------------------------------------------------------
-- Closing the default grant on the internal functions.
--
-- Found by a test asserting that `grant_admin` was unreachable from a
-- client. It was not: PostgreSQL grants EXECUTE on a new function to
-- PUBLIC, and `anon` is in PUBLIC, so revoking from `authenticated` and
-- `anon` by name left the function callable by both of them anyway.
--
-- The same default had been quietly applying to every function in
-- migrations 0002 through 0006. Most are harmless — a predicate that
-- takes two user ids and returns a boolean. Two groups are not:
--
--   * The maintenance functions. `purge_stale_messages()` and
--     `purge_expired_evidence()` delete rows. They exist to be run on a
--     schedule by the service role, and a caller who can reach one from a
--     browser has a way to destroy data with a single request.
--   * `eligible_candidates(viewer)` and the scoring functions. They take
--     the viewer as an argument rather than reading auth.uid(), because
--     the matching job runs them for other people. Reachable from a
--     client, that argument is an invitation: pass any id and read the
--     slate — or the score — that belongs to somebody else.
--
-- The bare predicates are revoked too, but two of them had to be granted
-- straight back, and the reason is worth stating precisely because
-- guessing it wrong breaks every read in the app:
--
--   A function named in a row-level security policy, or in the body of a
--   view, is checked against the QUERYING role — not the owner of the
--   policy, the table, or the view. So any role that must pass such a
--   policy or read such a view needs EXECUTE on those functions.
--
-- Only a `security definer` function runs as its owner, which is why the
-- predicates called from inside one can be revoked freely. Both halves of
-- that were established by revoking everything and reading the failures
-- rather than by reasoning about it; the two exceptions are named below.
--
-- The rest are worth revoking: `is_admitted(uuid)` reachable from a
-- browser is an oracle answering whether a given account is a member of
-- this app, one guess at a time.
--
-- What a client keeps is the short list at the bottom: the functions
-- written for it, each of which reads auth.uid() and decides for itself
-- what the caller may see.
-- ---------------------------------------------------------------------

-- Maintenance. Service role only — these are cron jobs, not requests.
revoke all on function purge_stale_messages()    from public, anon, authenticated;
revoke all on function purge_expired_evidence()  from public, anon, authenticated;
revoke all on function expire_photo_requests()   from public, anon, authenticated;
revoke all on function expired_grant_objects()   from public, anon, authenticated;

grant execute on function purge_stale_messages()   to service_role;
grant execute on function purge_expired_evidence() to service_role;
grant execute on function expire_photo_requests()  to service_role;
grant execute on function expired_grant_objects()  to service_role;

-- Matching and ranking. Called by the matching job and by
-- draw_daily_slate, never by a client.
revoke all on function eligible_candidates(uuid)        from public, anon, authenticated;
revoke all on function candidate_score(uuid, uuid)      from public, anon, authenticated;
revoke all on function compatibility_score(uuid, uuid)  from public, anon, authenticated;
revoke all on function responsiveness_score(uuid)       from public, anon, authenticated;

grant execute on function eligible_candidates(uuid)       to service_role;
grant execute on function candidate_score(uuid, uuid)     to service_role;
grant execute on function compatibility_score(uuid, uuid) to service_role;
grant execute on function responsiveness_score(uuid)      to service_role;

-- Predicates called only from inside definer functions, which do run as
-- their owner — so revoking these costs nothing at runtime.
revoke all on function blocked_between(uuid, uuid)      from public, anon, authenticated;
revoke all on function is_admitted(uuid)                from public, anon, authenticated;
revoke all on function photo_requests_today(uuid)       from public, anon, authenticated;

grant execute on function blocked_between(uuid, uuid)   to service_role;
grant execute on function is_admitted(uuid)             to service_role;
grant execute on function photo_requests_today(uuid)    to service_role;

-- The two exceptions, both granted back. Each was revoked first and each
-- broke something immediately, which is how the rule above was arrived at:
--
--   can_view_profile   named by the `profiles_read` policy and the photo
--                      and answer policies. A revoke fails every profile
--                      read with "permission denied for function".
--   has_photo_access   called in the body of the `photo_gallery` view,
--                      which the app reads directly. A view's function
--                      calls are checked the same way a policy's are.
--
-- Neither leaks more than the policy it serves: both answer about a pair
-- of accounts whose ids the caller must already hold, and both re-check
-- admission and blocks in their own body.
grant execute on function can_view_profile(uuid, uuid)  to anon, authenticated, service_role;
grant execute on function has_photo_access(uuid, uuid)  to anon, authenticated, service_role;

-- Trigger functions. A trigger fires as the table's owner; calling one
-- directly is not something a client should be able to attempt.
revoke all on function guard_message_body()             from public, anon, authenticated;

-- `open_slots` is genuinely for the client — an applicant picking a
-- meeting time needs it — but it takes a city and a day count, not a user
-- id, so there is nothing in it to widen.
--
-- Everything else a client calls is granted explicitly in its own
-- migration and reads auth.uid() rather than taking a user id: the RPCs in
-- 0005 and 0006, apply_for_membership and my_application in 0009, and the
-- review desk in 0010.
--
-- The check that keeps this true is in test_review_desk.sql, which fails
-- if a definer function without an internal guard becomes reachable by
-- anon again. A test that names the rule beats a comment asking for care.
