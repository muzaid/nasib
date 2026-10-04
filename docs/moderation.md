# Reading members' conversations

The review desk can read any two members' messages. This document is
about why that is built the way it is, and what you have to do before you
use it.

## Before you turn it on: tell the members

Monitoring an arranged-introduction platform is ordinary and expected.
Scams, people who are already married, and men who will not take no for
an answer are the reasons this product has a review desk at all, and you
cannot find them without reading what people write.

Doing it without saying so is a different thing. Before the monitor is
used on real members, the terms and the privacy notice have to say, in
Arabic, in plain words:

* that staff can read messages exchanged inside the app,
* why — safety and fraud,
* that every read is logged and the member can ask who read theirs.

This is not legal advice, and the Palestinian Authority, Israel, Jordan
and the EU (if you ever take an EU user) each have their own rules about
this. Get the wording checked by someone who does that for a living. The
engineering below assumes you have.

## What a reviewer can and cannot see

**Can see:** the text of every message, both members' names and profiles,
when each message was sent and read, and how many times the filter fired
on each side.

**Cannot see:** the contact details themselves. Redaction happens in a
`BEFORE INSERT` trigger (migration 0008), so what reaches the `messages`
table is already cleaned. A reviewer sees `رقمي [حُجب]` and a badge saying
a phone number was removed. The number was never written down, so there
is no switch to flip, no column to decrypt and no backup to subpoena.

That is a deliberate limit on your own power, and it is worth keeping. It
means a breach of the reviewer account does not hand anyone a list of
phone numbers.

## How the queue is ordered, and why it matters

The default filter is **flagged** — conversations where the redaction
filter fired — ordered by how many times it fired, not by recency.

This is the difference between moderation and browsing. A reviewer who
works from the top of this list is reading the pairs most likely to be
moving the conversation off-platform, which is where the scams are. A
reviewer who opens `all` and scrolls is reading strangers' courtships.
Both are possible; only one is the job.

Each side's count is kept separate. One person pushing their number at
someone who never reciprocates is a different situation from two people
impatient with the rules, and the list says which it is.

## The log

Opening a thread writes two rows to `admin_access_log` — one naming each
member — with the reviewer and the time. Opening the *list* writes one
row with no subject, because browsing a queue and reading one pair's
messages are different acts and conflating them would make the per-member
log useless.

`admin_conversation_reads()` reads it back, naming the reviewer by email.
It is a function rather than a table so that a reviewer who inherits this
system finds it.

The screen tells the reviewer their read was logged, every time, before
and after they open a thread. That is not a formality: a safeguard nobody
is reminded of stops being one.

If a member ever asks who has read their messages, the answer is a query:

```sql
select l.created_at, a.email
  from admin_access_log l
  join admin_users a on a.id = l.admin_id
 where l.route = 'conversation'
   and l.subject_user_id = '<the member>'
 order by l.created_at desc;
```

## What is deliberately not built

* **No export.** There is no button that produces a file of conversations.
  A reviewer reads on screen, one pair at a time.
* **No search inside message bodies.** Searching everyone's messages for a
  word is a different power from reading a flagged pair, and it is the
  one that gets abused. If you ever need it, make it its own function
  with its own log route so it can be audited separately — do not widen
  `admin_search`.
* **No un-redaction.** See above. There is nothing to un-redact.
