// Talking to Supabase without the Supabase library.
//
// The site has no build step and no node_modules, and the part of the
// client it actually needs is three HTTP calls: sign in anonymously,
// call a function, refresh the token when it expires. The official
// library is 80kb to wrap those, plus a bundler to deliver it.
//
// Two things worth knowing before reading further:
//
// The anon key in config.js is meant to be public. It identifies the
// project, it is not a password, and every row it can reach is reachable
// only through the row-level security policies in supabase/migrations.
// That is why those policies are written the way they are. The
// *service-role* key is the opposite — it bypasses all of them — and it
// must never appear in this folder, in config.js, or in the repository.
//
// Nothing here trusts the client with anything that matters. The
// application is submitted through apply_for_membership, which sets the
// user id from the token and refuses to read a status out of the
// payload. A patched copy of this file gets you a differently-worded
// request and the same answer.

const SESSION_KEY = "nasib.session";

/** Thrown for anything the caller might reasonably show a human. */
export class DataError extends Error {
  constructor(message, { status = 0, code = "" } = {}) {
    super(message);
    this.name = "DataError";
    this.status = status;
    this.code = code;
  }
}

/**
 * @param {object} options
 * @param {string} options.url        the project URL
 * @param {string} options.key        the anon key
 * @param {Function} [options.fetch]  injected in tests
 * @param {Storage} [options.storage] injected in tests
 */
export function createClient({ url, key, fetch: doFetch, storage } = {}) {
  const base = String(url || "").replace(/\/+$/, "");
  const http = doFetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  const store = storage || safeStorage();

  if (!base || !key) return null;
  if (!http) return null;

  let session = readSession();
  // One in-flight sign-in, shared. Three screens asking for a session at
  // once should produce one anonymous user, not three.
  let pending = null;

  function readSession() {
    try {
      const raw = store?.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.access_token ? parsed : null;
    } catch {
      return null;
    }
  }

  function writeSession(next) {
    session = next;
    try {
      if (next) store?.setItem(SESSION_KEY, JSON.stringify(next));
      else store?.removeItem(SESSION_KEY);
    } catch {
      // Private browsing, or storage disabled. The session still works
      // for this page; it just will not survive a reload. Losing it is a
      // fresh anonymous user, not an error worth interrupting anyone for.
    }
  }

  function expired(s) {
    if (!s?.expires_at) return false;
    // A minute of slack: a token that expires mid-request is a failed
    // request, and the retry costs more than refreshing early.
    return Date.now() > s.expires_at * 1000 - 60_000;
  }

  async function authCall(path, body) {
    const res = await http(`${base}/auth/v1/${path}`, {
      method: "POST",
      headers: { apikey: key, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await readBody(res);
    if (!res.ok) {
      throw new DataError(authMessage(res.status, payload, res), {
        status: res.status,
        code: payload?.error_code || payload?.error || "",
      });
    }
    return payload;
  }

  /** A session, reusing or refreshing the stored one where possible. */
  async function signIn() {
    if (session && !expired(session)) return session;
    if (pending) return pending;

    pending = (async () => {
      if (session?.refresh_token) {
        try {
          writeSession(stamp(await authCall("token?grant_type=refresh_token", {
            refresh_token: session.refresh_token,
          })));
          return session;
        } catch {
          // A refresh token can be revoked, or the project reset. Falling
          // through to a new anonymous user loses nothing: this browser's
          // application was tied to the old one, and there is no way back
          // to it from here anyway.
          writeSession(null);
        }
      }
      writeSession(stamp(await authCall("signup", {})));
      return session;
    })();

    try {
      return await pending;
    } finally {
      pending = null;
    }
  }

  function stamp(payload) {
    if (!payload?.access_token) {
      throw new DataError(
        "المشروع لا يسمح بالدخول المجهول بعد. فعّل Anonymous sign-ins في إعدادات Supabase.",
      );
    }
    return {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token || "",
      expires_at: payload.expires_at
        || Math.floor(Date.now() / 1000) + (payload.expires_in || 3600),
      user_id: payload.user?.id || "",
    };
  }

  /** Call a Postgres function. Retries once on a 401, then gives up. */
  async function rpc(name, args = {}, { retry = true } = {}) {
    const s = await signIn();
    const res = await http(`${base}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: key,
        authorization: `Bearer ${s.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args),
    });

    if (res.status === 401 && retry) {
      // The token was rejected rather than merely old — clearing it and
      // signing in again is the only thing that can help, and doing it
      // twice cannot, so `retry` is false on the way back in.
      writeSession(null);
      return rpc(name, args, { retry: false });
    }

    const payload = await readBody(res);
    if (!res.ok) {
      throw new DataError(rpcMessage(res.status, payload), {
        status: res.status,
        code: payload?.code || "",
      });
    }
    return payload;
  }

  return {
    get userId() { return session?.user_id || ""; },
    signIn,
    rpc,

    /** Submit or edit this browser's application. Returns the status. */
    apply: (application) => rpc("apply_for_membership", { application }),

    /** What this browser applied with, or null if it has not. */
    myApplication: () => rpc("my_application", {}),

    /**
     * What the database would remove from this message. The composer
     * has its own copy of the rules for instant feedback; this is the
     * authority, and a disagreement between the two is a bug in the
     * port rather than a judgement call.
     */
    async wouldRedact(text) {
      const rows = await rpc("redact_personal_details", { body_in: text });
      const row = Array.isArray(rows) ? rows[0] : rows;
      return {
        body: row?.body_out ?? text,
        categories: row?.categories ?? [],
      };
    },

    /** Who this browser is, and whether it is a reviewer. */
    whoami: () => rpc("whoami", {}),

    // ── account security ──────────────────────────────────────────────
    /**
     * Claim this sign-in, end the others, and report anyone else's.
     *
     * The user agent is sent so the owner can tell one sign-in from
     * another. The IP is not: it would read better ("from Ramallah") and
     * it is a location history of a person on a marriage app, kept
     * indefinitely, for a feature that works without it.
     */
    registerSession: () =>
      rpc("register_session", { agent: navigator.userAgent.slice(0, 300) }),
    acknowledgeSessions: () => rpc("acknowledge_sessions", {}),
    signOutOthers:       () => rpc("sign_out_other_sessions", {}),
    mySessions:          () => rpc("my_sessions", {}),

    adminBanEmail:   (email, reason, notes = null) =>
      rpc("admin_ban_email", { target_email: email, reason, notes }),
    adminUnbanEmail: (email) => rpc("admin_unban_email", { target_email: email }),
    adminBannedEmails: () => rpc("admin_banned_emails", {}),

    /** Change the password — after ending the other sessions, not before. */
    async changePassword(password) {
      const s = await signIn();
      const res = await http(`${base}/auth/v1/user`, {
        method: "PUT",
        headers: {
          apikey: key,
          authorization: `Bearer ${s.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ password: String(password || "") }),
      });
      const payload = await readBody(res);
      if (!res.ok) throw new DataError(authMessage(res.status, payload, res));
      return payload;
    },

    /**
     * Sign in as a reviewer, with an email and a password.
     *
     * This replaces whatever session the browser held — which for an
     * ordinary visitor is their anonymous one. That is the intended
     * trade: a reviewer's identity has to survive a cleared browser and
     * work on a second device, and an anonymous session does neither.
     *
     * Signing in proves who you are. It grants nothing: `is_admin` is a
     * row in admin_users that only the SQL editor can write. An account
     * with a perfect password and no row gets the same closed desk as
     * everyone else.
     */
    async signInWithPassword(email, password) {
      const payload = await authCall("token?grant_type=password", {
        email: String(email || "").trim(),
        password: String(password || ""),
      });
      writeSession(stamp(payload));
      return session;
    },

    /**
     * Create an account with an email and a password.
     *
     * Where the project does not require email confirmation, this returns
     * a session and the person is signed in. Where it does, it returns a
     * user and no token — the caller has to say so rather than appearing
     * to have signed them in.
     */
    async signUpWithPassword(email, password) {
      const payload = await authCall("signup", {
        email: String(email || "").trim(),
        password: String(password || ""),
      });
      if (!payload?.access_token) {
        return { needsConfirmation: true, email: payload?.email || email };
      }
      writeSession(stamp(payload));
      return { needsConfirmation: false, session };
    },

    /**
     * Give the current anonymous session an email and a password,
     * keeping the same account.
     *
     * This is the one that matters for anyone who has already used the
     * site: it turns the identity they have been carrying in this
     * browser into one they can sign back into, without abandoning the
     * application, the photos or the status attached to it. Signing up
     * fresh instead would leave all of that behind on an id nobody can
     * reach.
     */
    async linkEmailPassword(email, password) {
      const s = await signIn();
      const res = await http(`${base}/auth/v1/user`, {
        method: "PUT",
        headers: {
          apikey: key,
          authorization: `Bearer ${s.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: String(email || "").trim(),
          password: String(password || ""),
        }),
      });
      const payload = await readBody(res);
      if (!res.ok) {
        throw new DataError(authMessage(res.status, payload), { status: res.status });
      }
      // The token still says `is_anonymous`, and its claims are fixed at
      // issue time. Refreshing gets one that does not — and the database
      // check reads the row rather than the claim, so the person is not
      // blocked either way.
      try {
        if (session?.refresh_token) {
          writeSession(stamp(await authCall("token?grant_type=refresh_token", {
            refresh_token: session.refresh_token,
          })));
        }
      } catch { /* the old token still works; it just looks anonymous */ }

      // The part that has to be checked rather than assumed. When the
      // project requires email confirmation, this request returns 200 and
      // changes nothing: the address is held as pending until a link is
      // clicked, so the account still has no credential and the next
      // thing the person does — submitting their application — is refused
      // for a reason that has nothing to do with what they just did.
      //
      // Better to say it here, where the cause is still on screen.
      const me = await rpc("whoami", {});
      if (me && me.has_credential === false) {
        throw new DataError(
          "أُرسلت رسالة تأكيد إلى بريدك، ولا يُفعّل الحساب قبل فتح الرابط فيها."
          + " إن كنت تدير هذا المشروع: أوقف تأكيد البريد من Authentication ‹"
          + " Sign In / Providers ‹ Email ‹ Confirm email، فالخدمة المدمجة"
          + " للبريد محدودة برسالتين في الساعة ورسائلها كثيراً ما لا تصل.",
          { code: "email_confirmation_pending" },
        );
      }
      return payload;
    },

    /** Sign out, dropping back to a fresh anonymous session on next use. */
    async signOut() {
      const held = session;
      writeSession(null);
      if (held?.access_token) {
        try {
          await http(`${base}/auth/v1/logout`, {
            method: "POST",
            headers: { apikey: key, authorization: `Bearer ${held.access_token}` },
          });
        } catch {
          // The token is already forgotten locally, which is what the
          // person asked for. Revoking it server-side is housekeeping.
        }
      }
    },

    /** The whole profile, for the edit screen to prefill from. */
    myProfile: () => rpc("my_profile", {}),

    /** Other admitted members, or `{gated: true}` with a reason. */
    browse: (limit = 30) => rpc("browse_members", { limit_to: limit }),

    // ── The review desk. Every one of these refuses unless the caller is
    // a row in admin_users, which nothing reachable from here can create.
    adminQueue: (filter = "waiting") => rpc("admin_queue", { filter }),
    adminDecide: (userId, action, reason = "reviewed", notes = null) =>
      rpc("admin_decide", { target: userId, action, reason_code: reason, notes }),

    // ── The review desk, the rest of it ───────────────────────────────
    adminPhotoQueue:   (filter = "pending") => rpc("admin_photo_queue", { filter }),
    adminPhotoAction:  (id, action, reason = null) =>
      rpc("admin_photo_action", { photo_id: id, action, reason }),
    adminSearch:       (q) => rpc("admin_search", { q }),
    adminMeetings:     (filter = "pending") => rpc("admin_meetings", { filter }),
    adminAudit:        () => rpc("admin_audit", {}),
    adminReviewers:    () => rpc("admin_reviewers", {}),
    adminScheduleMeeting: (meetingId, slotId) =>
      rpc("schedule_meeting", { p_meeting_id: meetingId, p_slot_id: slotId }),
    openSlots:         (city = null, days = 21) =>
      rpc("open_slots", { p_city: city, days_ahead: days }),
    adminMember:       (userId) => rpc("admin_member", { target: userId }),
    adminReports:      (filter = "open") => rpc("admin_reports", { filter }),
    adminResolveReport: (id, action, notes = null) =>
      rpc("admin_resolve_report", { report_id: id, action, notes }),
    adminPhotoRequests: () => rpc("admin_photo_requests", {}),
    adminScreenRequest: (id, allow, reason = null) =>
      rpc("admin_screen_photo_request", { request_id: id, allow, reason }),
    adminStats:        () => rpc("admin_stats", {}),

    // ── Memberships, the slate, search ────────────────────────────────
    myBenefits:     () => rpc("my_benefits", {}),
    allMemberships: () => rpc("all_memberships", {}),
    mySlate:        () => rpc("my_slate", {}),
    swipe:          (candidateId, interested, note = null) =>
      rpc("swipe", { candidate: candidateId, interested, note }),
    myAdmirers:     () => rpc("my_admirers", {}),
    searchMembers:  (filters = {}) => rpc("search_members", { filters }),

    // ── The contact release ───────────────────────────────────────────
    pressBingo:   (matchId) => rpc("press_bingo", { p_match_id: matchId }),
    myRelease:    (matchId) => rpc("my_release", { p_match_id: matchId }),
    cancelRelease:(matchId) => rpc("cancel_release", { p_match_id: matchId }),
    setMyPhone:   (phone) => rpc("set_my_phone", { phone }),

    adminReleases:      (filter = "pending") => rpc("admin_releases", { filter }),
    adminDecideRelease: (id, approve, days = 3, reason = null) =>
      rpc("admin_decide_release", { release_id: id, approve, days, reason }),
    adminMarkPaid:      (id, userId, reference = null) =>
      rpc("admin_mark_paid", { release_id: id, which_user: userId, reference }),
    adminMarkRefunded:  (id, reference = null) =>
      rpc("admin_mark_refunded", { release_id: id, reference }),
    adminSetMembership: (userId, level, months = 1, notes = null) =>
      rpc("admin_set_membership", { target: userId, level, months, notes }),

    // ── The member's own screens ──────────────────────────────────────
    myPhotoRequests: () => rpc("my_photo_requests", {}),
    myPhotoGrants:   () => rpc("my_photo_grants", {}),
    myMatches:       () => rpc("my_matches", {}),
    myMeetings:      () => rpc("my_meetings", {}),
    matchThread:     (matchId) => rpc("match_thread", { p_match_id: matchId }),
    sendMessage:     (matchId, body) => rpc("send_message", { p_match_id: matchId, p_body: body }),
    respondToPhotoRequest: (id, approve) =>
      rpc("respond_to_photo_request", { request_id: id, approve }),
    revokePhotoAccess: (grantId, reason = null) =>
      rpc("revoke_photo_access", { owner_or_viewer_grant: grantId, reason }),
    requestPhotoAccess: (ownerId, note = null) =>
      rpc("request_photo_access", { owner: ownerId, note }),

    // ── Photos ────────────────────────────────────────────────────────
    myPhotos: () => rpc("my_photos", {}),

    /**
     * Upload a file to the private bucket, then register the row.
     *
     * Two steps rather than one, and in this order, because the row is
     * what the app reads: an object with no row is invisible and gets
     * cleaned up, while a row pointing at an object that was never
     * uploaded is a broken image in somebody's profile.
     */
    async uploadPhoto(file, { makePrimary = false } = {}) {
      const s = await signIn();
      if (!s.user_id) throw new DataError("لا يمكن تحديد الحساب.");

      // The path has to start with the user id: the storage policy checks
      // the first folder segment, and add_photo checks it again.
      const safe = (file.name || "photo.jpg").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-40);
      const path = `${s.user_id}/${Date.now()}-${safe}`;

      const res = await http(`${base}/storage/v1/object/photos/${path}`, {
        method: "POST",
        headers: {
          apikey: key,
          authorization: `Bearer ${s.access_token}`,
          "x-upsert": "false",
          ...(file.type ? { "content-type": file.type } : {}),
        },
        body: file,
      });

      if (!res.ok) {
        const payload = await readBody(res);
        if (res.status === 404) {
          throw new DataError("لم يُنشَأ مخزن الصور بعد — أنشئ bucket باسم photos في Supabase.");
        }
        throw new DataError(payload?.message || `تعذّر رفع الصورة (${res.status}).`);
      }

      return rpc("add_photo", { path, make_primary: makePrimary });
    },

    /** Remove the row, then the object. See delete_photo for the order. */
    async deletePhoto(id) {
      const result = await rpc("delete_photo", { photo_id: id });
      const s = await signIn();
      try {
        await http(`${base}/storage/v1/object/photos/${result.storage_path}`, {
          method: "DELETE",
          headers: { apikey: key, authorization: `Bearer ${s.access_token}` },
        });
      } catch {
        // The row is already gone, so the photo is gone from the product.
        // A leftover object in a private bucket nobody can list is not
        // worth failing the interaction over.
      }
      return result;
    },

    /**
     * Remove an object from the bucket.
     *
     * Used after a reviewer deletes a photo: the row goes first, so the
     * photo leaves the product immediately, and the file follows. An
     * orphaned object in a private bucket nobody can list is a smaller
     * problem than a row pointing at a file that is gone.
     */
    async deleteStorageObject(path) {
      const s = await signIn();
      try {
        await http(`${base}/storage/v1/object/photos/${path}`, {
          method: "DELETE",
          headers: { apikey: key, authorization: `Bearer ${s.access_token}` },
        });
      } catch { /* see above */ }
    },

    /**
     * A photo, as a `data:` URL the page can put in an <img>.
     *
     * Not the signed URL itself, and that is the point. A signed URL
     * points at the Supabase host, so an <img> using it is governed by
     * the page's `img-src` policy — a different rule from `connect-src`,
     * which governs fetch(). On a deployment whose Content-Security-
     * Policy allows the host for one and not the other, every photo is
     * silently refused by the browser while every request in the console
     * succeeds. That happened here, and it wasted a day.
     *
     * Fetching the bytes and inlining them sidesteps the question: the
     * request is a fetch, and the result is a `data:` URL, which every
     * policy this app has ever had allows. It costs a base64 copy in
     * memory, for images that are a few hundred kilobytes and are
     * released when the screen is replaced.
     */
    async photoDataUrl(path, seconds = 600) {
      const url = await this.signedUrl(path, seconds);
      if (!url) return "";
      try {
        const res = await http(url);
        if (!res.ok) return "";
        const blob = await res.blob();
        return await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => resolve("");
          reader.readAsDataURL(blob);
        });
      } catch {
        return "";
      }
    },

    /**
     * A URL for a private object, valid for `seconds`.
     *
     * The bucket is private, so there is no permanent URL to hold — which
     * is the point. A link that leaks expires; a public bucket URL is
     * forever, and someone will paste one into a group chat.
     */
    async signedUrl(path, seconds = 600) {
      const s = await signIn();
      const res = await http(`${base}/storage/v1/object/sign/photos/${path}`, {
        method: "POST",
        headers: {
          apikey: key,
          authorization: `Bearer ${s.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ expiresIn: seconds }),
      });
      const payload = await readBody(res);
      if (!res.ok || !payload?.signedURL) return "";
      // The API returns a path relative to /storage/v1.
      return `${base}/storage/v1${payload.signedURL.replace(/^\/?/, "/")}`;
    },

    /** For the "not signed in" case in tests and for a manual reset. */
    forget: () => writeSession(null),
  };
}

async function readBody(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

// Error text is Arabic because a person reads it. The status code is
// kept on the error for anyone reading the console.
function authMessage(status, payload, res) {
  const code = payload?.error_code || payload?.error || "";
  const text = JSON.stringify(payload || {});

  // Two different 429s, and telling someone to wait a minute for the one
  // that resets hourly is how they sit there pressing the button.
  //
  // `over_email_send_rate_limit` is the built-in mail service, capped at
  // a couple of messages an hour on a new project. It is reached by
  // creating accounts while "Confirm email" is on — and no amount of
  // waiting fixes the underlying problem, because the confirmation mail
  // is not something this app needs at all.
  if (status === 429 || code === "over_email_send_rate_limit"
      || code === "over_request_rate_limit") {
    const emailLimit = /email/i.test(code) || /email rate limit/i.test(text);
    // GoTrue puts the wait either in a header or inside the sentence.
    const seconds = Number(res?.headers?.get?.("retry-after"))
      || Number((text.match(/after (\d+) seconds?/) || [])[1])
      || 0;

    if (emailLimit) {
      return "بلغ المشروع حدّ إرسال رسائل التفعيل (رسالتان في الساعة على الخدمة"
        + " المدمجة). الحل ليس الانتظار: أوقف تأكيد البريد من إعدادات Supabase"
        + " — Authentication ‹ Sign In / Providers ‹ Email ‹ Confirm email.";
    }
    return seconds
      ? `محاولات كثيرة. حاول بعد ${seconds} ثانية.`
      : "محاولات كثيرة. الحدّ في Supabase يُحسب بالساعة، لا بالدقيقة — انتظر قبل"
        + " المحاولة، أو ارفع الحدّ من Authentication ‹ Rate Limits.";
  }

  if (code === "user_already_exists" || code === "email_exists"
      || /already registered|already been registered/i.test(JSON.stringify(payload || {}))) {
    return "هذا البريد مستخدم بالفعل. سجّل الدخول به بدلاً من إنشاء حساب.";
  }
  if (code === "weak_password" || /password should be at least/i.test(JSON.stringify(payload || {}))) {
    return "كلمة المرور قصيرة. استخدم ٦ أحرف أو أكثر.";
  }
  if (code === "email_not_confirmed") {
    return "لم يُفعّل هذا البريد بعد. أكّده من لوحة Supabase أو من رسالة التفعيل.";
  }
  if (status === 422 && /anonymous/i.test(JSON.stringify(payload || {}))) {
    return "الدخول المجهول غير مفعّل في هذا المشروع.";
  }
  if (code === "invalid_credentials") return "البريد أو كلمة المرور غير صحيحة.";
  return payload?.msg || payload?.message || `تعذّر الاتصال بالخادم (${status}${code ? " " + code : ""}).`;
}

function rpcMessage(status, payload) {
  // PostgREST hands back the `raise exception` message in `message`,
  // which for our own functions is already a sentence written for the
  // applicant — the 18+ refusal, for instance.
  const message = payload?.message || payload?.msg || "";
  if (message) return message;
  if (status === 404) return "الدالة غير موجودة على الخادم — شغّل الترحيلات أولًا.";
  return `تعذّر حفظ البيانات (${status}).`;
}

function safeStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    // Touching it is the test: it exists and throws in a few browsers.
    localStorage.setItem("nasib.probe", "1");
    localStorage.removeItem("nasib.probe");
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * The client this page uses, or null when the site is running without a
 * backend — which is the normal state for the published demo and for
 * anyone who opened index.html directly. Every caller has to handle the
 * null, and that is deliberate: the fixtures are the fallback, so the
 * site works with no configuration at all.
 */
export async function connect() {
  let config;
  try {
    config = await import("./config.js");
  } catch {
    // config.js is generated by the build and is gitignored, so it is
    // absent for every local copy and for the published demo — both
    // correct, both silent until now. Silence is wrong when someone has
    // set the variables and is looking at fixtures wondering why, so say
    // what is missing and what to do about it.
    console.info(
      "%c[nasib] no config.js — running on fixtures.",
      "font-weight:bold",
      "\n\nThis is expected locally and for the demo. On a deployment it means"
      + "\nthe build found no Supabase settings. Set BOTH of these in Vercel"
      + "\n(Settings → Environment Variables, Production and Preview), then"
      + "\nredeploy:"
      + "\n\n  SUPABASE_URL       or  NEXT_PUBLIC_SUPABASE_URL"
      + "\n  SUPABASE_ANON_KEY  or  SUPABASE_PUBLISHABLE_KEY"
      + "\n                     or  NEXT_PUBLIC_SUPABASE_ANON_KEY"
      + "\n\nThe spelling must match one of those exactly. The build log says"
      + "\nwhich of the two it could not find.",
    );
    return null;
  }
  return createClient({ url: config.SUPABASE_URL, key: config.SUPABASE_ANON_KEY });
}
