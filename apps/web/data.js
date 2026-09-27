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
      throw new DataError(authMessage(res.status, payload), {
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

    /** The whole profile, for the edit screen to prefill from. */
    myProfile: () => rpc("my_profile", {}),

    /** Other admitted members, or `{gated: true}` with a reason. */
    browse: (limit = 30) => rpc("browse_members", { limit_to: limit }),

    // ── The review desk. Every one of these refuses unless the caller is
    // a row in admin_users, which nothing reachable from here can create.
    adminQueue: (filter = "waiting") => rpc("admin_queue", { filter }),
    adminDecide: (userId, action, reason = "reviewed", notes = null) =>
      rpc("admin_decide", { target: userId, action, reason_code: reason, notes }),

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
function authMessage(status, payload) {
  const code = payload?.error_code || payload?.error || "";
  if (status === 422 && /anonymous/i.test(JSON.stringify(payload || {}))) {
    return "الدخول المجهول غير مفعّل في هذا المشروع.";
  }
  if (status === 429) return "محاولات كثيرة. انتظر دقيقة وحاول مرة أخرى.";
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
