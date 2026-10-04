-- ---------------------------------------------------------------------
-- Personal details never reach the other side of a chat.
--
-- Phone numbers, addresses, emails, links, handles and ID-shaped numbers
-- are stripped from every message before it is stored, until the pair
-- have had their in-app video call and contact has been unlocked.
--
-- Three decisions, and each one is the reason this file exists rather
-- than a Dart function alone:
--
--   * It runs in a trigger, so the *client cannot opt out*. The Flutter
--     app redacts too, but that is a courtesy that shows the user what
--     will happen. A patched client posting straight to PostgREST hits
--     this and gets the same treatment.
--   * The original text is never stored. Not in the row, not in a
--     shadow column, not in an audit table. A redaction you can undo by
--     reading another column is a redaction that leaks the first time
--     someone exports the database.
--   * What was caught is recorded by *category* in `flags` — phone,
--     address, email — with no sample of the matched text. That is
--     enough for the reviewer queue and for telling the sender what
--     happened, and it stores nothing that was meant to be removed.
--
-- The patterns are duplicated in apps/mobile/lib/core/guarded_text.dart.
-- They must stay in step; this file is the authority, and the tests in
-- supabase/tests/test_message_redaction.sql are what check it.
-- ---------------------------------------------------------------------

-- Arabic-Indic and Persian digits are digits. A number written
-- "٠٥٩٩ ١٢٣ ٤٥٦" is a phone number, and a filter that only knows 0-9
-- is a filter that stops nobody in this market.
create or replace function to_western_digits(t text) returns text
  language sql immutable strict as $$
  select translate(t,
    '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
    '01234567890123456789')
$$;

comment on function to_western_digits is
  'Normalises Arabic-Indic and Persian numerals so one pattern covers all three scripts.';


-- Letters used as digits, which is the first thing anyone tries when a
-- digit filter blocks them: O for zero, l or | for one, and so on.
create or replace function unmask_digit_lookalikes(t text) returns text
  language sql immutable strict as $$
  select translate(t, 'OoIl|', '00111')
$$;



-- What counts as an identifier, as opposed to a phone number.
--
-- They look alike and the distinction matters, because after the video
-- call a phone number is the couple's business and an ID number never
-- is. Locally: a national ID is nine digits and does not start with a
-- zero; a mobile number is ten and does — 05xx. So an identifier is a
-- nine-digit run that does not begin with zero, an IBAN, or a run long
-- enough (twelve plus) that no phone number is that shape.
--
-- Bank cards are deliberately not matched by length alone. They are
-- caught by the twelve-plus rule, and anything shorter that looks like
-- one is caught by the phone rule before contact is unlocked.
create or replace function identifier_pattern() returns text
  language sql immutable as $$
  select '([A-Z]{2}[0-9]{2}[A-Z0-9]{10,}|\y[1-9][0-9]{8}\y|[0-9]{12,})'
$$;


-- Masking by position, not by substitution.
--
-- Matching happens on a normalised copy of the message: Arabic-Indic
-- numerals folded to Latin, letters that stand in for digits folded back.
-- Substituting on that copy would hand the user back a message in a
-- script they did not write, and substituting the *pattern* on the
-- original misses everything the normaliser changed — "O599I23456"
-- matches the copy and not the original, so it was found and then left
-- in place. That was a real bug, caught by a test.
--
-- Every normalisation here is one character for one character, so the two
-- strings line up index for index. Find the range in the copy, blank the
-- same range in the original.
create or replace function mask_by_position(
  body text, probe text, pat text, min_digits int default 0
) returns text language plpgsql immutable as $$
declare
  res  text := '';
  cut  int := 1;   -- where the next kept slice starts, in body
  from_ int := 1;  -- where the next search starts, in probe
  s    int;
  e    int;
  span text;
begin
  loop
    s := regexp_instr(probe, pat, from_, 1, 0, 'i');
    exit when s is null or s = 0;
    e := regexp_instr(probe, pat, from_, 1, 1, 'i');
    exit when e is null or e <= s;

    span := substr(body, s, e - s);

    -- A guard for the patterns that fold letters into digits. Without it
    -- "looooool" folds to "1000000l" and is redacted as a phone number.
    -- A real number has real digits in it.
    if min_digits = 0
       or (select count(*) from regexp_matches(span, '[0-9٠-٩۰-۹]', 'g')) >= min_digits
    then
      res := res || substr(body, cut, s - cut) || '⋯';
      cut := e;
    end if;

    from_ := e;
  end loop;
  return res || substr(body, cut);
end;
$$;

create or replace function redact_personal_details(
  body_in text,
  out body_out text,
  out categories text[]
) language plpgsql immutable as $$
declare
  probe text;
  pat   text;

  -- Written once, against the normalised copy, so each pattern can be
  -- plain Latin-digit and still catch every script.
  pat_phone constant text :=
    '(\d[\s\.\-\(\)]{0,3}){6,}';

  pat_spelled constant text :=
    '((zero|one|two|three|four|five|six|seven|eight|nine|'
    || 'صفر|واحد|اثنين|إثنين|تنين|ثلاثة|تلاتة|اربعة|أربعة|خمسة|'
    || 'ستة|سبعة|ثمانية|تمانية|تسعة)(\s+\S+){0,2}\s*){2,}';

  pat_address constant text :=
    '(شارع|شارغ|حارة|حي |منطقة|عمارة|بناية|مبنى|طابق|الطابق|شقة|'
    || 'بيت رقم|ص\.ب|صندوق بريد|قرب |بجانب |مقابل |خلف |'
    || 'street|st\.|avenue|ave\.|building|bldg|floor|apt|apartment|'
    || 'p\.o\. ?box|near |next to |opposite )[^،,.\n]{0,40}';

  pat_email constant text :=
    '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[a-z]{2,}';

  pat_link constant text :=
    '(https?://\S+|www\.\S+|[[:alnum:]-]+\.(com|net|org|me|ly|io|co)\y'
    || '|\S+\s(dot|نقطة)\s\S+)';

  pat_handle constant text := '@[[:alnum:]_.]{3,}';

  pat_offplatform constant text :=
    '(whatsapp|whats ?app|telegram|signal app|snapchat|instagram|insta|'
    || 'tiktok|viber|imo|botim|واتساب|واتس|الواتس|تلغرام|تيليجرام|تلجرام|'
    || 'انستقرام|إنستقرام|انستا|سناب|سنابشات|فايبر)';

  pat_identifier constant text := identifier_pattern();

  -- label, pattern, fold-letters-into-digits, minimum real digits.
  --
  -- The folding column is the lesson from a bug: applying it everywhere
  -- turned "example.com" into "examp1e.c0m" and the email pattern stopped
  -- matching its own test. Letters only stand in for digits where digits
  -- are what we are looking for.
  --
  -- Order matters: identifiers before phone numbers, so a nine-digit ID
  -- is filed as an ID rather than swallowed by the phone pattern.
  checks constant text[][] := array[
    array['identifier',    pat_identifier,  'fold',  '6'],
    array['email',         pat_email,       'plain', '0'],
    array['link',          pat_link,        'plain', '0'],
    array['handle',        pat_handle,      'plain', '0'],
    array['phone',         pat_phone,       'fold',  '4'],
    array['phone_spelled', pat_spelled,     'plain', '0'],
    array['address',       pat_address,     'plain', '0'],
    array['off_platform',  pat_offplatform, 'plain', '0']
  ];

  label  text;
  before text;
  found  text[] := '{}';
begin
  body_out := body_in;

  for i in 1 .. array_length(checks, 1) loop
    label := checks[i][1];
    pat   := checks[i][2];

    -- Recomputed each pass: after a substitution the copy and the
    -- original are different lengths, and the next pattern would blank
    -- the wrong characters.
    probe := to_western_digits(body_out);
    if checks[i][3] = 'fold' then
      probe := unmask_digit_lookalikes(probe);
    end if;

    before := body_out;
    body_out := mask_by_position(body_out, probe, pat, checks[i][4]::int);

    -- Recorded only when something was actually removed. A pattern that
    -- matched and was then refused by the digit guard did not catch
    -- anything, and saying otherwise would mislead the reviewer.
    if body_out is distinct from before then
      found := array_append(found, label);
    end if;
  end loop;

  categories := found;
end;
$$;

comment on function redact_personal_details is
  'Strips phone numbers, addresses, emails, links, handles and ID numbers. Returns the cleaned body and the categories found, never a sample of what was removed.';


-- Identifiers are removed whether or not contact has been unlocked: an
-- ID or IBAN in a chat is a fraud signal at every stage, and the video
-- call does not make one safe to send.
create or replace function redact_identifiers_only(t text) returns text
  language plpgsql immutable strict as $$
declare
  probe text := unmask_digit_lookalikes(to_western_digits(t));
begin
  if probe !~ identifier_pattern() then return t; end if;
  return mask_by_position(t, probe, identifier_pattern(), 6);
end;
$$;


create or replace function guard_message_body() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  unlocked boolean;
  cleaned  text;
  cats     text[];
begin
  select m.contact_unlocked into unlocked
    from matches m where m.id = new.match_id;

  if coalesce(unlocked, false) then
    -- Contact is unlocked: they have had the video call, so a phone
    -- number or an address is theirs to share. An ID number or an IBAN
    -- never is, at any stage, because the reason to send one in a chat
    -- is almost always someone else's idea.
    declare
      cleaned_id text := redact_identifiers_only(new.body);
    begin
      new.redacted := cleaned_id is distinct from new.body;
      new.body := cleaned_id;
      if new.redacted then
        new.flags := coalesce(new.flags, '{}'::jsonb)
                     || jsonb_build_object('redacted_categories', to_jsonb(array['identifier']));
      end if;
    end;
    return new;
  end if;

  select r.body_out, r.categories
    into cleaned, cats
    from redact_personal_details(new.body) r;

  new.body := cleaned;
  new.redacted := array_length(cats, 1) is not null;

  -- Categories only. The flags column is read by the review console and
  -- by the classifier; putting a sample of the removed text here would
  -- undo the redaction one join away.
  if new.redacted then
    new.flags := coalesce(new.flags, '{}'::jsonb)
                 || jsonb_build_object('redacted_categories', to_jsonb(cats));
  end if;

  return new;
end;
$$;

drop trigger if exists messages_guard_body on messages;
create or replace trigger messages_guard_body
  before insert or update of body on messages
  for each row execute function guard_message_body();

comment on function guard_message_body is
  'Redacts personal details before a message row is stored. The original text is never written anywhere.';

revoke execute on function guard_message_body() from authenticated, anon;

-- The redaction function itself is granted: the client calls it to warn
-- the user *before* sending, which is kinder than mangling the message
-- afterwards. It is pure and reveals nothing the caller did not supply.
grant execute on function redact_personal_details(text) to authenticated;
grant execute on function to_western_digits(text) to authenticated;
