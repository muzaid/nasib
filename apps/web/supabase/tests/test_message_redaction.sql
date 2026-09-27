-- =====================================================================
-- Personal details in chat.
--
-- Written adversarially, because the interesting cases are all evasions.
-- Anyone can block "0599123456"; the question is what happens to
-- "٠٥٩٩ ١٢٣ ٤٥٦", to "صفر خمسة تسعة تسعة", and to a street address —
-- and whether a client that skips the Dart guard entirely gets away with
-- it. The last one is the point of testing at this layer at all.
--
--   psql -d nasib -v ON_ERROR_STOP=1 -f supabase/tests/test_message_redaction.sql
-- =====================================================================

\set AMIRA  '11111111-1111-1111-1111-111111111111'
\set YOUSEF '22222222-2222-2222-2222-222222222222'

-- A small helper so each assertion reads as one line: did this text come
-- out changed, and was it filed under the category we expect?
create or replace function caught(input text, category text) returns boolean
language sql stable as $$
  select r.body_out is distinct from input
     and category = any(r.categories)
    from redact_personal_details(input) r
$$;

create or replace function survives(input text) returns boolean
language sql stable as $$
  select r.body_out = input from redact_personal_details(input) r
$$;

\echo ''
\echo '== phone numbers, in every script people actually use =='

select assert(caught('رقمي 0599123456 اتصل فيني', 'phone'),
  'a plain Latin-digit number is removed');

select assert(caught('رقمي ٠٥٩٩١٢٣٤٥٦', 'phone'),
  'Arabic-Indic digits are digits — the filter is not Latin-only');

select assert(caught('0599 123 456', 'phone'),
  'spaces between the groups do not hide it');

select assert(caught('0599-123-456', 'phone'),
  'dashes do not hide it');

select assert(caught('0 5 9 9 1 2 3 4 5 6', 'phone'),
  'one digit at a time, spaced out, is still a phone number');

select assert(caught('رقمي O599I23456', 'phone'),
  'letters standing in for digits (O for zero, I for one) do not hide it');

\echo ''
\echo '== numbers written as words =='

select assert(caught('صفر خمسة تسعة تسعة واحد اثنين', 'phone_spelled'),
  'a number spelled out in Arabic is caught');

select assert(caught('zero five nine nine one two three', 'phone_spelled'),
  'and spelled out in English');

select assert(caught('تسعة تسعة خمسة صفر', 'phone_spelled'),
  'Levantine spellings are covered, not only textbook Arabic');

\echo ''
\echo '== addresses =='

select assert(caught('انا ساكن شارع الإرسال عمارة الأمل الطابق الثالث', 'address'),
  'a street address is removed');

select assert(caught('بيتنا قرب مسجد الحرم', 'address'),
  'a landmark is an address: "near the mosque" locates a person');

select assert(caught('I live on Rainey Street building 4', 'address'),
  'English address forms too');

select assert(caught('ص.ب 1234 رام الله', 'address'),
  'a post box is an address');

\echo ''
\echo '== email, links, handles, and moving off the platform =='

select assert(caught('راسلني amira@example.com', 'email'),
  'an email address is removed');

select assert(caught('شوف instagram.com/someone', 'link'),
  'a bare domain is a link even without http');

select assert(caught('حسابي instagram dot com slash amira', 'link'),
  'the domain written in words does not get through');

select assert(caught('انستقرام نقطة كوم', 'link'),
  'and written in Arabic words');

select assert(caught('@amira_2000', 'handle'),
  'an @handle is removed');

select assert(caught('تعالي نحكي على الواتس', 'off_platform'),
  'naming the app is caught on its own — it is what comes before the number');

\echo ''
\echo '== ordinary messages are left alone =='
-- The cost of a false positive is a person retyping a harmless sentence
-- and concluding the app is broken. These are the sentences that must
-- survive untouched.

select assert(survives('أهلاً، تشرفت بملفك. كيف حالك اليوم؟'),
  'an ordinary greeting is untouched');

select assert(survives('عمري 32 سنة وأعمل مهندس'),
  'an age and a job are not personal contact details');

select assert(survives('عندي 3 اخوة وأختين'),
  'small numbers in ordinary sentences survive');

select assert(survives('بشتغل من 8 الصبح لل 5 المسا'),
  'working hours survive — two short numbers are not a phone number');

select assert(survives('ان شاء الله نتقابل في المكتب الخميس'),
  'arranging to meet at the office is the behaviour we want, not a leak');

\echo ''
\echo '== the trigger, which is what a modified client meets =='

-- The earlier suites unlock contact on this match, and redaction is
-- deliberately off once that has happened. Lock it again so this tests
-- the state that matters: before the video call.
update matches set contact_unlocked = false
 where :'YOUSEF' in (user_a, user_b) and state = 'active';

select act_as(:'YOUSEF');
set role authenticated;

-- Straight insert, exactly as a patched client posting to PostgREST
-- would do it, bypassing every line of Dart in the app.
insert into messages (match_id, sender_id, body)
select m.id, :'YOUSEF', 'رقمي 0599123456 وساكن شارع الإرسال عمارة الأمل'
  from matches m
 where :'YOUSEF' in (m.user_a, m.user_b)
   and m.state = 'active'
 limit 1;

reset role;

select assert(
  (select body not like '%0599123456%' from messages
    where sender_id = :'YOUSEF' order by created_at desc limit 1),
  'the number is gone from the stored row — the client cannot opt out'
);

select assert(
  (select body not like '%شارع الإرسال%' from messages
    where sender_id = :'YOUSEF' order by created_at desc limit 1),
  'and so is the address'
);

select assert(
  (select redacted from messages
    where sender_id = :'YOUSEF' order by created_at desc limit 1),
  'the row is marked redacted, so the recipient is told something was removed'
);

select assert(
  (select flags -> 'redacted_categories' @> '["phone"]'::jsonb
     from messages where sender_id = :'YOUSEF' order by created_at desc limit 1),
  'the category is recorded for the reviewer'
);

-- The flags column is read by the console and joined into exports. If the
-- removed text were kept here, the redaction would be theatre.
select assert(
  (select flags::text not like '%0599123456%' from messages
    where sender_id = :'YOUSEF' order by created_at desc limit 1),
  'the removed text is NOT kept in flags — there is no undo column'
);

\echo ''
\echo '== after the video call, the rules relax — but not for everything =='

update matches set contact_unlocked = true
 where :'YOUSEF' in (user_a, user_b) and state = 'active';

select act_as(:'YOUSEF');
set role authenticated;

insert into messages (match_id, sender_id, body)
select m.id, :'YOUSEF', 'رقمي 0599123456 وحسابي PS92PALS000000000400123456702'
  from matches m
 where :'YOUSEF' in (m.user_a, m.user_b)
   and m.state = 'active'
 limit 1;

reset role;

select assert(
  (select body like '%0599123456%' from messages
    where sender_id = :'YOUSEF' order by created_at desc limit 1),
  'the phone number survives once contact is unlocked — that is what unlocking is for'
);

select assert(
  (select body not like '%PS92PALS%' from messages
    where sender_id = :'YOUSEF' order by created_at desc limit 1),
  'the IBAN does not — an account number in a chat is a fraud signal at every stage'
);

\echo ''
\echo '== identifiers are never allowed, unlocked or not =='

select assert(caught('هويتي 401234567', 'identifier'),
  'a nine-digit ID number is removed');

select assert(
  redact_identifiers_only('حسابي PS92PALS000000000400123456702') <> 'حسابي PS92PALS000000000400123456702',
  'an IBAN is removed even after contact is unlocked'
);

select assert(
  redact_identifiers_only('رقمي 0599123456') = 'رقمي 0599123456',
  'but an ordinary phone number IS allowed once contact is unlocked — that is what unlocking means'
);

\echo ''
\echo '== message redaction suite complete =='
