# نصيب — the mobile website

The same product as the Flutter app, as a website you can open on a phone
right now. No toolchain, no build step, no SDK: seven files and a folder
of fonts.

```bash
python3 apps/web/serve.py
```

It prints two addresses. Open the second one on your phone — both devices
need to be on the same network.

## Why this exists

The native build needs Flutter, an Android SDK, a working proxy and about
three gigabytes of downloads before it produces anything you can hold.
This needs a browser. It is how you show someone the product this
afternoon, and how you test the flow and the Arabic while the APK is still
arguing with Gradle.

It is not a replacement for the app. Screenshot blocking, `FLAG_SECURE`
and background verification are operating-system features; a browser tab
has none of them, and the photos screen says so rather than implying
otherwise.

## Why HTTPS, and the certificate warning

Browsers hand out a camera only on a secure origin. `localhost` counts;
`http://192.168.1.x` — the address your phone needs — does not. So
`serve.py` generates a self-signed certificate and serves over HTTPS.

Your phone will warn that the certificate is not trusted. It is right:
nobody signed it. Accept it for this address and the camera works. If you
would rather not, plain HTTP serves everything except the camera step:

```bash
python3 -m http.server 8000 --directory apps/web
```

## What the camera step actually does

Be precise about this, because it is easy to oversell and the difference
matters:

**It does.** Opens the real front camera. Runs a real challenge — a
randomised sequence, generated per session, that expires after ninety
seconds, so a video recorded beforehand cannot satisfy an order issued
afterwards. Measures inter-frame variation on a fixed 100ms cadence and
ends the attempt when the feed is motionless. Where the browser offers the
Shape Detection API it also reads the face box, so "come closer" and
"you're out of frame" are measured rather than guessed — most browsers do
not offer it, and the screen says which case you are in.

**It does not.** Decide whether this is the same person as the ID or as
the profile photos. That is a face-embedding comparison and it belongs on
the server, where the answer cannot be patched out by whoever is holding
the phone. The native app has exactly the same split.

The thresholds were measured, not invented: Chrome's animated test pattern
measures about 0.93 on this statistic, a frozen frame measures 0. Anything
under 0.35 across a session is sent for review rather than rejected — an
unusually still person is a plausible false positive, and a woman refused
by a still camera does not come back.

What the motion floor catches is a *frozen or injected feed*. A printed
photo held in a shaking hand produces plenty of variation and will pass
it. That is what the server-side checks are for.

## The chat rules

`redact.js` is a port of the database trigger in
`supabase/migrations/0008_message_redaction.sql` — phone numbers in any
script, spelled-out digits, addresses and landmarks, emails, links,
handles and ID or account numbers. The database is the authority; this
copy exists so the composer can warn *before* sending and name what it
found.

They are tested against the same cases:

```bash
node --test apps/web/test/redact.test.mjs     # 32 cases
./supabase/tests/run.sh                        # the same cases, in SQL
```

Change a rule in one and the other's tests fail. That is the point: a
drift shows up as a failing test rather than as a message the app said was
fine and the server then altered.

## Layout

```
index.html    the shell — everything else is rendered by app.js
app.js        screens, routing, fixtures
capture.js    the camera step
redact.js     the chat rules
data.js       Supabase, without the Supabase library — three HTTP calls
config.js     generated at deploy time, gitignored, absent by default
styles.css    the design system: navy ink on white, teal for anything you press
fonts/        Cairo, four weights, shipped rather than fetched (OFL)
serve.py      HTTPS dev server for testing on a phone
test/         node --test, plus a browser pass over the wiring
```

## What is stored, and what is not

Both states are normal, and the site tells you which one it is in.

**With no `config.js`** — a fresh clone, the published demo, or
`index.html` opened directly — everything is fixtures mirroring
`supabase/seed/`. Nothing is stored; reload and it starts again.

**With a Supabase project configured** (`docs/deploy.md`), most of the
product is real: signing up and editing it afterwards, your own profile,
photo upload into a private bucket, the review desk where an admin admits
or rejects, and a directory of people who were actually admitted. Coming
back lands you where you belong — the desk if you are a reviewer, the
directory if you are admitted, your status if you are waiting.

The photo requests, the thread and the office meeting are still fixtures:
each needs two admitted people and a match between them, which is the
matching service's job.

One setup step has no UI on purpose. An admin is a row in `admin_users`,
and nothing reachable from a browser can create one — you run
`select grant_admin('<your id>')` in the SQL editor, and the profile
screen prints the line with your id in it. An invite code or a
first-user-wins rule would be a path into the review desk that exists in
the deployed system.

The part worth reading is `data.js`. Two things it explains at length,
because getting either wrong is expensive: why the anon key belongs in the
client and the service-role key never does, and why anonymous sign-in is
what makes row-level security mean anything on the web — without a session
every visitor is the same nobody, and a policy about `auth.uid()` has
nothing to decide on.

## Tests

```bash
npm test                          # 44 cases: the chat rules, and the client
node apps/web/test/browser.mjs    # 33 checks: the wiring, in a real browser
./supabase/tests/run.sh           # 183 assertions, including the same chat cases
```

The browser pass is the one that catches what unit tests cannot: a chip
that sends its Arabic label instead of its enum value, a form that posts
before the session exists, a returning visitor dropped back on the welcome
screen. It stubs Supabase at the network layer and asserts what actually
went over the wire.
