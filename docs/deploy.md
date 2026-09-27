# Putting the website online

Three steps: a Supabase project, a GitHub repository, a Vercel import.
Twenty minutes if nothing surprises you, and everything except the first
step is reversible.

The site works with none of this — open `apps/web/index.html` and it runs
on fixtures. What this adds is that an application someone submits is a
real row that survives a reload.

---

## 1. Supabase

Create a project at supabase.com. Any region; the nearest one to your
users, which for this product is Frankfurt or London rather than a US
region — the difference is felt on a phone on 3G.

**Run the migrations.** One paste, not fourteen:

```bash
node tool/bundle-migrations.mjs > setup.sql
```

Paste that into the SQL editor and run it. It is wrapped in a
transaction, so a failure applies nothing and names the statement, rather
than leaving half a schema behind that fails later as what looks like an
application bug. Running the eleven files individually, in order, works
too.

Do *not* run `supabase/local/00_supabase_stubs.sql` against a hosted
project — it fakes the `auth` schema for local testing and would
overwrite the real one.

### "cannot insert multiple commands into a prepared statement"

That error is not about the SQL. Some query consoles — Vercel's database
tab among them — send whatever you paste as a *prepared statement*, and
PostgreSQL will not prepare more than one command at a time. Every
migration is many commands, so nothing you paste there will ever run.

Two ways past it:

**Use Supabase's own SQL editor.** Not Vercel's database tab — the
Supabase dashboard for the project, left sidebar, SQL Editor. It has no
such limit. This is the short answer.

**Or apply them over a connection**, which is repeatable and prints which
migration failed if one does:

```bash
npm i pg
node tool/apply-migrations.mjs "$POSTGRES_URL_NON_POOLING"
```

Use the **non-pooling** URL — port 5432, not 6543. The pooled one runs
pgbouncer in transaction mode, which hands each statement a different
backend connection, and a migration is a transaction spanning many
statements. The script refuses a pooled URL rather than half-applying
against one.

If it stops partway, resume rather than starting again — these migrations
are not written to be re-runnable, and `create table` fails on a second
pass:

```bash
node tool/apply-migrations.mjs "$POSTGRES_URL_NON_POOLING" --from 0009_web_signup.sql
```

On a work machine, port 5432 outbound is often blocked. Then it is the
browser SQL editor, and that is fine — it is the same SQL.

0010 creates the private `photos` storage bucket and its policies on its
way past. Check Storage afterwards: if the bucket is not there, the
migration ran before the storage extension was ready — create a bucket
named `photos`, leave **Public** off, and run 0010 again.

**Turn off email confirmation** (Authentication → Sign In / Providers →
Email → "Confirm email"). A new project's built-in mail service is
heavily rate-limited and its messages routinely never arrive, so leaving
confirmation on means accounts that can be created and never used. Turn
it back on once you have configured your own SMTP.

**Turn on anonymous sign-ins.** Authentication → Sign In / Providers →
Anonymous sign-ins. Without it, nobody gets a session, `auth.uid()` is
null, and every row-level security policy correctly refuses everything.

This is the setting worth understanding rather than just flipping. An
anonymous user is a real row in `auth.users` with a real token — it is how
a visitor owns their own application before they have anything to sign in
*with*. It is not a way in: the policies still apply, and
`apply_for_membership` still refuses to read a status out of the request.

**Copy two values** from Project Settings → API. The build accepts
either name in each row, so if you used Vercel's Supabase integration the
variables it already created will work as they are:

| Value | Any of these names |
|---|---|
| Project URL | `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` |
| the client key | `SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY` |

Supabase issues two key formats and the dashboard shows them side by
side. `eyJ…` with `"role":"anon"`, and `sb_publishable_…`, are both
client keys and both safe here. `sb_secret_…` and the `service_role` JWT
are *server* keys: they bypass every policy in `supabase/migrations`, and
`config.js` is served to every visitor. `tool/build-web.mjs` refuses both
formats, but the real protection is not putting one in the environment.

### If a server key has already been shared

Pasted into a chat, committed, screenshotted — treat it as public and
rotate. In Project Settings → API:

* **Reset the database password** (Settings → Database). That invalidates
  every `postgres://…` connection string.
* **Rotate the JWT secret.** This re-signs and therefore invalidates both
  the `anon` and `service_role` JWTs — so update `SUPABASE_ANON_KEY` in
  Vercel afterwards and redeploy, or the site will start refusing every
  request with a 401.
* **Revoke the `sb_secret_…` key** and issue a new one.

On a project with nothing in it yet, deleting it and creating another is
faster than all three and leaves nothing behind.

---

## 1b. Make yourself a reviewer

**With an email and password (what a real reviewer uses).** In Supabase,
Authentication → Users → **Add user**, with "Auto Confirm User" ticked so
no confirmation mail is needed. Then, in the SQL editor:

```sql
select grant_admin_by_email('you@example.com');
```

Sign in at `/#/login` on the deployed site. That identity is a real
account: it survives a cleared browser, works on a second device, and can
be stood down later with `select revoke_admin('you@example.com');` — which
deactivates the reviewer without deleting the row, because
`admin_decisions` references it and an audit trail missing the reviewer
has a hole in the place that matters.

Signing in proves who someone is. It grants nothing: `is_admin` is a row
only the SQL editor can write, so a correct password on an ungranted
account gets the same closed desk as anyone else.

**Or tie it to this browser (quicker, for a first look).**

Nothing is admitted without a human, and there is no human until you make
one. Until then the member side of the app is correctly empty — every
applicant sits in the queue and the directory has nobody in it.

There is no invite code and no "first user becomes admin" rule, because
both of those are a way into the review desk that exists in the deployed
system. The only way in is someone with database credentials naming a
user id.

1. Open the deployed site and go to **ملفي** (the profile tab), or just
   open `/#/admin`. Either shows your account id in a line ready to copy.
2. Paste it into the Supabase SQL editor:

```sql
select grant_admin('00000000-0000-0000-0000-000000000000', 'you@example.com', 'Your Name');
```

3. Reload the site. It now opens on **مكتب المراجعة** — the queue, with
   everyone who has applied, and admit/reject on each.

Two things about that screen worth knowing. Every decision is written to
`admin_decisions` with your id and a reason, and every time you *open* the
queue is written to `admin_access_log` — a reviewer reading through
profiles is the breach that actually happens, and it is the one an audit
trail catches. And you cannot admit your own account: an admin who can is
an admin whose own profile was never reviewed.

To check it worked before touching the app: `select * from admin_users;`

---

## 1c. The two sign-in screens

| URL | Who | What it does |
|---|---|---|
| `/#/login` | members | Sign in, or create an account. |
| `/#/staff` | reviewers | Sign in only — no account creation. |

Same mechanism underneath: a reviewer is an ordinary account with a row
in `admin_users`. They are separate URLs because a member arriving at a
page headed "reviewers" learns something about the product that is none
of their business, and a reviewer does not want a page offering to make
them an account.

A new member fills in the whole application first and is asked for an
email and password at the end, as the last step of submitting it — not
before they have seen anything. The credential is required to *submit*,
because an application nobody can return to is an orphan; it is not
required to start, because asking someone to sign up for a product they
have not seen is how they leave instead.

Anyone who used the site before signing up has an anonymous account with
their application on it. **ملفي** offers to add an email and password to
*that* account rather than starting a new one — which matters, because
signing up fresh would strand the application on an id nobody can reach.
Applying now requires a credential for exactly that reason, and the
database enforces it.

---

## 2. GitHub

```bash
cd nasib
git init -b main          # already done if you cloned this
git add .
git commit -m "نصيب"
gh repo create nasib --private --source=. --push
```

Without the `gh` CLI: create an empty private repository on github.com,
then

```bash
git remote add origin git@github.com:<you>/nasib.git
git push -u origin main
```

Private is the right default. The repository holds the schema, the
verification thresholds and the redaction patterns; the last of those is a
list of what the filter looks for, which is a useful document for someone
trying to get past it.

---

## 3. Vercel

Import the repository at vercel.com/new. `vercel.json` already sets the
build, so leave the framework preset on **Other** and change nothing.

Add both environment variables (Settings → Environment Variables), for
Production *and* Preview, then deploy.

That is the whole build: `tool/build-web.mjs` writes `apps/web/config.js`
from those two variables and Vercel serves the folder. No bundler, no
install step, nothing to go out of date. Without the variables it builds
the demo instead of failing, which is what you want on a preview branch.

**Check it worked.** Open the deployment, submit an application, reload.
If your name comes back, the row is in the database — Table Editor →
`users` will show it with `status = applying`.

If it does not, open the browser console. `[nasib] running without a
backend:` is printed with the reason, and the reason is nearly always one
of: anonymous sign-ins still off, migrations not run (the message names a
missing function), or the URL copied with a trailing path.

---

## What is real, and what is not

Worth being exact about, because the site is convincing enough to mislead
someone who is not.

**Real once deployed.** Signing up, and editing what you submitted
afterwards. Reading your own status back. The 18+ refusal, and the fact
that nothing in the request can set your own status or tier. The review
desk: the queue, the decisions, the audit rows. The directory, which shows
people who were actually admitted. Photo upload into a private bucket,
with the blur, the six-photo limit, and signed URLs that expire. The
camera step, which runs its challenge in the browser. The chat rules,
which are enforced by a database trigger and which the composer can ask
the database about directly rather than trusting its own copy.

**Still fixtures.** The photo requests and grants, the message thread, the
office meeting. Each needs two admitted people and a match between them,
which is the matching service's job — the screens for it exist and are
wired to fixtures. Admit two accounts and the directory is real; the
thread between them is not, yet.

**Deliberately not automatic.** Photos are uploaded with `approved =
false` and nothing a client can call sets it true. They are visible to
their owner and to a reviewer and to nobody else, whatever grants exist.
That is the intended state — the approval step is the next piece of the
review desk, not an oversight.

**Not possible in a browser at all.** Screenshot blocking. `FLAG_SECURE`
and its iOS equivalent are operating-system features; the photos screen
says this instead of implying protection it does not have.

---

## Cost

Both free tiers carry this comfortably. Supabase pauses a free project
after a week with no requests — it resumes on the next one, after a delay
long enough that the first visitor after a quiet week sees a stall. If you
are showing it to someone, open it yourself first.
