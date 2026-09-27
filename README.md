# Nasib (نصيب)

A gated-entry marriage platform for Arabic-speaking users. Arabic only — one
language, no English fallback. No profile becomes visible until an AI agent
and, where it matters, a human reviewer have established that the person is
real, single and serious.

Three things define the product:

- **No profile is visible until it has been verified.** Sign-up is an
  application, and rejection is a normal outcome. Admission is earned at the
  camera: the applicant looks into the lens and follows a short sequence the
  server picks at random, and that live face is compared against both the ID
  portrait and the uploaded photos. Uploading a still selfie is no longer
  enough to be admitted automatically.
- **No face is browsable.** Every photo is served blurred. Seeing someone's
  photos takes a request, a reviewer's screening, and the owner's consent —
  time-limited, watermarked, revocable without a reason. Screen capture is
  blocked on Android and detected-and-punished on iOS; a second screenshot
  revokes that viewer's access automatically.
- **The first meeting happens at our office**, in a booked room with a staff
  member present and family welcome.

Verification is not a badge bolted onto a dating app here. It is the product,
and the review desk is the moat.

> `nasib` is a working name. Pick the real one before the App Store listing —
> it is one of the open decisions at the end of the blueprint.

---

## What is in this repository

```
supabase/          Postgres schema, RLS policies, matching, grants, seed, SQL tests
services/verification/   The verification agent (FastAPI + Python)
apps/mobile/       Flutter app (Arabic-first, RTL)
apps/admin/        Review console
```

### Verified in this build

| Component | How it was checked | Result |
| --- | --- | --- |
| Migrations | Applied to PostgreSQL 16 with pgvector | 8 migrations, clean |
| Matching, photos, capture, meetings, chat redaction, RLS | 123 SQL assertions across three suites, run as `authenticated` so RLS is genuinely exercised | all pass |
| Verification agent | 34 pytest cases across 16 personas | all pass |
| Review console | Arabic RTL, rendered at 1280px and 400px, no console errors, no horizontal scroll | pass |
| Android scaffolding patcher | run against a synthetic `flutter create` output, twice, to check it is idempotent | pass |
| Flutter app | two independent read-throughs for compile errors and for camera-lifecycle bugs; **never compiled** | see below |

### Not built or run here

- **The Flutter app has not been compiled.** The sandbox this was built in
  cannot reach `dl.google.com`, `storage.googleapis.com` or `pub.dev`, so
  there is no Flutter SDK, no Android SDK and no Gradle here — an APK could
  not be produced whatever the code said. The Dart has been read line by
  line for compile errors and several were fixed, but reading is not
  compiling: expect a first build to surface something, and run it through
  the CI workflow or `tool/build_android.sh` to find out what.
- **Live vendors.** Liveness, document and reverse-image checks run against
  deterministic mocks. `_real_vendors()` in `services/verification/app/main.py`
  is where the winner of the bake-off gets wired in.
- **Video calling, payments, push.** Dependencies are declared; the
  integrations are V1 work, per the roadmap.
- **The platform channels have not been compiled.** `MainActivity.kt` and
  `ScreenGuard.swift` are written against the standard Flutter paths and drop
  in after `flutter create .`, but neither has been built here.

---

## Running it

### The verification agent

```bash
cd services/verification
pip install -e ".[dev]"

pytest                 # 34 tests, mock vendors, no accounts needed
python3 demo.py        # every persona through the pipeline, with costs
uvicorn app.main:app --reload
```

`demo.py` prints the table that explains the whole design:

```
persona                      band      id  int    cost
genuine_woman                ADMIT     93   91 $ 0.330
genuine_man_gold             ADMIT    100   91 $ 1.930
screen_replay_spoof          REJECT     0    0 $ 0.280
stolen_photos                REJECT     0    0 $ 0.330   live_not_photos
impostor_holding_id          REJECT     0    0 $ 1.930   live_not_id
face_swapped_mid_capture     REJECT     0    0 $ 0.030
printed_photo_at_camera      REVIEW    62   91 $ 0.330   unnaturally_consistent
injected_frames              REJECT     0    0 $ 0.030   impossible_timing
skipped_camera_step          REVIEW    82   91 $ 0.330
romance_scammer              REJECT     0    0 $ 0.030
married_man_contradiction    REVIEW    93   52 $ 0.330
disposable_number            REJECT     0    0 $ 0.030
```

The last three camera rows are the ones to read together. A man who really is
in front of the lens and follows every instruction is still rejected when the
ID he holds is not his (`live_not_id`), which is a different failure from
photos that belong to someone else (`live_not_photos`) and gets a different
sentence — they have different fixes, and telling someone the wrong one wastes
a day on both sides. `skipped_camera_step` is the deliberate consequence of
the rebalance: a clean still selfie now lands in review rather than admission.

The fraudulent applicants cost the least. Checks run cheap-to-expensive and
stop the moment no later check could change the answer — phone screening costs
two cents and removes a large share of bad signups before a single liveness
check is paid for.

### The database

Against Supabase, `supabase db push`. Locally, one command rebuilds a
throwaway database from the migrations, seeds it, and runs the SQL suite:

```bash
./supabase/tests/run.sh
```

The suite is not idempotent on purpose — it draws a slate and creates a match,
which is the behaviour under test — so it always builds a fresh database.

Requires the `vector` extension (`apt install postgresql-16-pgvector`).

### The review console

`apps/admin/console_demo.html` is self-contained — open it in a browser.
Rebuild it after changing the personas:

```bash
cd services/verification && python3 export_queue.py > ../../apps/admin/queue.json
cd ../../apps/admin && python3 build_console.py
```

### The app, on a phone

The `android/` directory is **not** in this repository. It is generated at
build time from the Flutter SDK you are building with, then patched by
`apps/mobile/tool/patch_android.py` — the camera permission, the Arabic
label, our `MainActivity` (where `FLAG_SECURE` lives) and a minSdk floor of
21 for ML Kit. A checked-in Gradle file is a file that is wrong one SDK
release later, in a way that costs an afternoon.

With a Flutter SDK and an Android SDK installed:

```bash
cd apps/mobile
./tool/build_android.sh          # debug APK, ready to install
adb install -r build/app/outputs/flutter-apk/app-debug.apk
```

On Windows, the same three steps:

```powershell
cd apps\mobile
powershell -ExecutionPolicy Bypass -File tool\build_android.ps1
```

With neither, push the repository to GitHub: `.github/workflows/android.yml`
does the same thing on every push and attaches the APK to the run. Download
it from the run's **Artifacts**, allow installs from unknown sources on the
phone once, and open the file.

The app installs in **demo mode**: fixed data, no Supabase project, no
verification service, and a home screen that lists every screen so you can
reach them in any order instead of signing up seven times. The camera step
is real in demo mode — the sequence, the face tracking and the step
detection all run on the device. What demo mode cannot do is compare that
face to an ID, because matching is server work; the demo strip on the
camera screen picks which of the five outcomes to show instead.

Point it at a running verification service with:

```bash
flutter run --dart-define=NASIB_DEMO=false \
            --dart-define=NASIB_VERIFY_URL=http://10.0.2.2:8000 \
            --dart-define=NASIB_VERIFY_TOKEN=dev-token
```

---

## The parts worth reading first

**`services/verification/app/pipeline.py`** — the agent. An orchestrator, not a
model: a fixed sequence of checks, a short circuit on hard failure, and an
evidence packet at the end. It never silently bans anyone.

**`services/verification/app/scoring.py`** — two numbers, never blended.
Identity confidence drives the badge a user sees; intent confidence drives
ranking and review priority and is never shown. The bands, and the conditions
under which a good score still is not enough to auto-admit, are all here.

**`services/verification/app/checks/live_capture.py`** — the camera step. The
challenge is issued by the server, randomised per session and dead after
ninety seconds, because a pre-recorded video cannot satisfy an order it was
filmed before. Two things in here are worth understanding before you retune
them. The first is `ThreeWayMatchCheck`: live↔ID, live↔photos and ID↔photos
are three separate comparisons, and which pair failed is the whole message to
the user. The second is `TOO_COHERENT` — frames that are *too* alike across
the sequence mean a printed photo held to the lens, since a real face varies
between frames and a photograph does not. That one flags for review rather
than rejecting, because an unusually still person is a plausible false
positive and a woman rejected by a still camera does not come back.

**`apps/mobile/lib/features/verification/capture_engine.dart`** — the camera
step on the device. Each instruction is completed by the face actually doing
the thing: ML Kit gives a head pose, an eye-open probability and a smile
probability per frame, and a pose has to be *held* for about four hundred
milliseconds, so a face swinging past the target does not count. The
thresholds are deliberately generous. A challenge a genuine person fails
twice is not a security control, it is an abandoned signup — strictness
belongs on the server, which sees the whole sequence at once. Note also
what the device never does: it computes no face embedding. Recognising who
this is happens server-side, because an app that can answer that question
locally is an app whose answer can be patched out.

**`services/verification/app/prompts.py`** — the language model returns
*quotable contradictions* against a fixed taxonomy, never a seriousness score.
A number a model invents is a number nobody can defend to a rejected user. The
prompts handle Levantine and Gulf dialect, MSA and Arabizi explicitly.

**`supabase/migrations/0002_rls.sql`** — the Flutter client talks to Postgres
directly, so row-level security *is* the authorisation layer. Tables a user has
a reason to query are granted and policy-filtered; biometric data and raw
vendor payloads are not granted at all, so an attempt errors at the door rather
than depending on a policy being right.

**`supabase/migrations/0003_matching.sql`** — hard filters applied in SQL and
never relaxed by the ranker, reciprocity in both directions, and a materialised
daily slate so the limit is honest.

**`supabase/migrations/0005_photo_access.sql`** — the photo-consent flow, and
the most important file here. Three independent defences: the clear original
is granted to no client role at any time, a granted viewer receives a
watermarked copy carrying their own token, and grants expire on their own as
well as being revocable. The old `photo_visibility` setting is dropped in this
migration on purpose — a setting that *could* unblur a photo is a code path,
and a code path is a thing that can be wrong.

**`supabase/migrations/0008_message_redaction.sql`** — no personal detail
reaches the other side of a chat before the video call: phone numbers in any
script, addresses, landmarks, emails, links, handles, and ID or account
numbers at any stage. It is a trigger, not a client function, so a patched
client posting straight to PostgREST gets the same treatment — and the
original text is never stored, in the row or anywhere else, because a
redaction you can undo by reading another column leaks the first time
somebody exports the database. `flags` records which *categories* were
found and never a sample of what was removed.

Three of its rules exist because a test caught the obvious version being
wrong: matching on a normalised copy and substituting on the original
silently misses everything the normaliser changed; folding letters into
digits everywhere turns `example.com` into `examp1e.c0m`; and `\b` in a
PostgreSQL regex is a backspace, not a word boundary.

**`supabase/migrations/0006_office_meetings.sql`** — offices, staffed slots
with capacity held under concurrent booking, and the propose → accept →
schedule → attend state machine.

**`apps/mobile/lib/l10n/strings_ar.dart`** — every string in the app. There is
no second locale file, and `main.dart` declares no fallback locale.

**`apps/mobile/lib/core/screen_guard.dart`** and the two platform files it
talks to — screenshot protection, and the file to read before promising
anything about it to a user. Android blocks capture outright with
`FLAG_SECURE`; iOS cannot block a screenshot at all, so it detects one and
makes it cost something. The Dart doc comment explains why we do not use the
`isSecureTextEntry` trick that most libraries rely on.

**`apps/mobile/lib/core/guarded_text.dart`** — contact details are stripped
until the in-app video call has happened, and the composer warns *before*
sending rather than mangling the message afterwards.

---

## Decisions already made in the code

These are choices, not defaults. Change them deliberately.

- **Screenshot protection is described honestly, per platform.** The app says
  "blocked" on Android and "detected, and here is what happens" on iOS,
  because saying "blocked" on iOS is a promise the product breaks the first
  time someone takes one.
- **Two detected screenshots revoke a grant automatically.** One is usually a
  mistake and gets a warning; two is a decision. The owner does not have to
  act, and does not have to find out weeks later.
- **Screen-capture events are only writable through `record_screen_event`.**
  The table itself is revoked, so a client cannot run up another viewer's
  count and get their access revoked for them.
- **A phone number and an ID number are told apart, and treated
  differently.** Before the video call both are removed. After it, the
  phone number is the couple's business and the ID number still is not —
  the reason to send one in a chat is almost always someone else's idea.
- **The chat warning names what it found.** "Your message contains an
  address" is something the sender can act on; "blocked" reads as a fault
  in the app rather than a rule with a reason.
- **Photos have no visibility setting at all.** Not "hidden by default" — no
  setting. The only route to a clear photo is a request the owner approves.
- **A blocked photo request is invisible to the owner and indistinguishable
  from a pending one to the requester.** She is not troubled by a request from
  a man with reports against him; he cannot work out what to change and try
  again around it.
- **Reviewers never see the photos under request.** Nothing in that decision
  requires it, and a console that shows them is an insider breach waiting to
  happen.
- **Users never pick their own meeting slot.** A visible office calendar would
  tell people who is meeting whom.
- **Document verification is optional at the free tier.** A hard ID requirement
  at signup costs a large share of legitimate women users who are, correctly,
  cautious about handing an ID to a new app. The paid tier is visibly more
  trusted instead, and demand pulls people up.
- **The camera step, not the selfie, is what earns admission.** Identity
  weight moved onto the live capture and the three-way match, which together
  carry more than a third of it. A still photo that matches an ID is the
  oldest trick in the file; a face that follows an instruction issued four
  seconds ago is not.
- **The device never picks its own challenge.** A client that chooses the
  sequence has not been challenged. The session is issued by the server, used
  once, and discarded on submission.
- **A failed capture is never called a failure.** Bad light, a smudged lens
  and a phone held too close are the common causes, and the copy names those.
  The word belongs at the review desk, not on a first-time user's screen.
- **Two trust numbers, never one.** A single blended score cannot be explained
  to the person it rejected.
- **The agent's recommendation renders last** in the review console, behind a
  disclosure. A reviewer who reads the score first stops reading the evidence.
- **`admin_decisions` is append-only**, at the database level. It is the audit
  trail, the dispute defence, and the labelled dataset used to retune
  thresholds — the first months of human rulings *are* the training set.
- **Retention is a column the system acts on**, not a policy in a document. ID
  images are deleted seven days after the decision; liveness frames after
  thirty.
- **A vendor outage degrades to review, never to a rejection.** There is a test
  for this.
- **No boosts, no super-likes, no "who liked you".** They monetise anxiety,
  which is the wrong business here.
- **Face-embedding bans**, because otherwise a removed account returns with a
  new phone number tomorrow. This is also the most sensitive thing stored,
  which is why it lives in its own schema with its own key and no readable
  foreign keys.

## Before any of this goes near a store

- Offices, staff rota and a booking desk in each launch city — the office
  meeting is a real operation, not a software feature
- Storage buckets and policies created as `0005_photo_access.sql` documents
  them, and the blur worker running before any photo is accepted
- 18+ enforced in the database, the client and the verification pipeline
- Privacy policy, terms and separate biometric consent, in Arabic and English
- Account deletion working from inside the app
- A reviewer test account with a verified profile and populated matches —
  app review cannot pass a gated-entry app without one
- Privacy labels matching what is actually collected, biometrics included
- An external penetration test

The full reasoning behind all of this is in the product and technical
blueprint that accompanies this repository.

---

## The design system

`apps/mobile/lib/core/theme.dart` is the whole visual language, and
`apps/mobile/design/prototype.html` is a clickable Arabic prototype of eight
screens — open it in a browser to see the system applied.

**Legibility first, character second.** Arabic loses more to low contrast and
tight leading than Latin does, so the palette is built on white with a deep
navy ink at roughly 14:1.

| Role | Value |
| --- | --- |
| Page | `#F6F9FB` |
| Panel | `#FFFFFF` |
| Hairline | `#DDE5EB` |
| Ink | `#0F2033` deep navy |
| Action | `#0E7C7B` teal |
| Marks | `#14527A` navy |

Three rules hold it together:

- **Two colours only.** Navy is ink and structure; teal is anything you can
  press. If it is teal, it is pressable. A third accent would mean nothing and
  add noise.
- **White panels on a faintly tinted page**, separated by a hairline. No heavy
  borders, no stacked shadows.
- **One ornament.** The eight-point star (نجمة ثمانية), drawn in code as two
  overlaid squares — which is how the motif is actually constructed in
  Levantine tile — and used three times in the whole app: the welcome hero, the
  section divider, and a confirmed office appointment. Any more and Islamic
  geometry becomes wallpaper.

**One typeface: Cairo,** at four weights. It is the most widely used Arabic UI
face for a reason — open counters, even stroke weight, and it holds its shape
at 13px, which is where a form label and a caption live. Cairo also carries
more ink per glyph than a Latin sans at the same size, so the whole scale runs
a point larger with *more* leading, not less: body is 16.5px at 1.95. Setting
Arabic tight is the fastest way to make a screen look dumped rather than
designed.

**The veiled photo is the signature element.** A cool blue-grey gradient with
the star at low opacity, not an empty box: it should read as a decision to
cover the photo rather than as an image that failed to load.
