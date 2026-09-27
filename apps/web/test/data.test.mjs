// The client, against a stubbed fetch.
//
// What is worth testing here is not that a POST is a POST. It is the
// behaviour that only shows up on someone's phone at an awkward moment:
// an expired token, a revoked refresh token, three screens asking for a
// session at once, and storage that throws.

import test from "node:test";
import assert from "node:assert/strict";
import { createClient, DataError } from "../data.js";

const URL_ = "https://project.supabase.co";
const KEY = "anon-key";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

/** A fetch stub that records calls and replies from a queue of handlers. */
function stubFetch(handlers) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const handler = handlers.shift();
    if (!handler) throw new Error(`unexpected request: ${url}`);
    const { status = 200, body = {} } = handler({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (body === null ? "" : JSON.stringify(body)),
    };
  };
  fn.calls = calls;
  return fn;
}

const soon = () => Math.floor(Date.now() / 1000) + 3600;

const sessionBody = (id = "user-1") => ({
  access_token: "token-" + id,
  refresh_token: "refresh-" + id,
  expires_at: soon(),
  user: { id },
});

test("no config means no client, so the caller falls back to fixtures", () => {
  assert.equal(createClient({ url: "", key: "" }), null);
  assert.equal(createClient({ url: URL_, key: "" }), null);
});

test("signs in anonymously and sends the token on the next call", async () => {
  const doFetch = stubFetch([
    () => ({ body: sessionBody() }),
    () => ({ body: { status: "applying" } }),
  ]);
  const client = createClient({ url: URL_, key: KEY, fetch: doFetch, storage: memoryStorage() });

  const result = await client.myApplication();

  assert.equal(result.status, "applying");
  assert.match(doFetch.calls[0].url, /\/auth\/v1\/signup$/);
  assert.deepEqual(doFetch.calls[0].body, {});
  assert.match(doFetch.calls[1].url, /\/rest\/v1\/rpc\/my_application$/);
  assert.equal(doFetch.calls[1].init.headers.authorization, "Bearer token-user-1");
  assert.equal(doFetch.calls[1].init.headers.apikey, KEY);
});

test("a stored session is reused rather than creating a second anonymous user", async () => {
  const storage = memoryStorage();
  storage.setItem("nasib.session", JSON.stringify({
    access_token: "kept", refresh_token: "r", expires_at: soon(), user_id: "u",
  }));
  const doFetch = stubFetch([() => ({ body: { status: "applying" } })]);
  const client = createClient({ url: URL_, key: KEY, fetch: doFetch, storage });

  await client.myApplication();

  assert.equal(doFetch.calls.length, 1, "no sign-up request was made");
  assert.equal(doFetch.calls[0].init.headers.authorization, "Bearer kept");
});

test("an expired session refreshes instead of starting over", async () => {
  const storage = memoryStorage();
  storage.setItem("nasib.session", JSON.stringify({
    access_token: "old", refresh_token: "r-old",
    expires_at: Math.floor(Date.now() / 1000) - 10, user_id: "u",
  }));
  const doFetch = stubFetch([
    () => ({ body: sessionBody("u") }),
    () => ({ body: { status: "applying" } }),
  ]);
  const client = createClient({ url: URL_, key: KEY, fetch: doFetch, storage });

  await client.myApplication();

  assert.match(doFetch.calls[0].url, /grant_type=refresh_token/);
  assert.deepEqual(doFetch.calls[0].body, { refresh_token: "r-old" });
  assert.equal(doFetch.calls[1].init.headers.authorization, "Bearer token-u");
});

test("a revoked refresh token falls back to a new anonymous user", async () => {
  const storage = memoryStorage();
  storage.setItem("nasib.session", JSON.stringify({
    access_token: "old", refresh_token: "revoked",
    expires_at: Math.floor(Date.now() / 1000) - 10, user_id: "u",
  }));
  const doFetch = stubFetch([
    () => ({ status: 400, body: { error: "invalid_grant" } }),
    () => ({ body: sessionBody("fresh") }),
    () => ({ body: { status: "applying" } }),
  ]);
  const client = createClient({ url: URL_, key: KEY, fetch: doFetch, storage });

  await client.myApplication();

  assert.match(doFetch.calls[1].url, /\/auth\/v1\/signup$/);
  assert.equal(doFetch.calls[2].init.headers.authorization, "Bearer token-fresh");
});

test("a 401 on an RPC is retried once, and only once", async () => {
  const doFetch = stubFetch([
    () => ({ body: sessionBody("a") }),
    () => ({ status: 401, body: { message: "JWT expired" } }),
    () => ({ body: sessionBody("b") }),
    () => ({ status: 401, body: { message: "JWT expired" } }),
  ]);
  const client = createClient({ url: URL_, key: KEY, fetch: doFetch, storage: memoryStorage() });

  await assert.rejects(() => client.myApplication(), (err) => {
    assert.ok(err instanceof DataError);
    assert.equal(err.status, 401);
    return true;
  });
  assert.equal(doFetch.calls.length, 4, "it did not keep retrying");
});

test("three screens asking at once produce one anonymous user", async () => {
  let signups = 0;
  const doFetch = stubFetch([
    () => { signups += 1; return { body: sessionBody() }; },
    () => ({ body: { a: 1 } }),
    () => ({ body: { b: 2 } }),
    () => ({ body: { c: 3 } }),
  ]);
  const client = createClient({ url: URL_, key: KEY, fetch: doFetch, storage: memoryStorage() });

  await Promise.all([client.myApplication(), client.myApplication(), client.myApplication()]);

  assert.equal(signups, 1);
});

test("the database's refusal reaches the applicant in its own words", async () => {
  const doFetch = stubFetch([
    () => ({ body: sessionBody() }),
    () => ({ status: 400, body: { message: "هذا التطبيق لمن أتمّ الثامنة عشرة" } }),
  ]);
  const client = createClient({ url: URL_, key: KEY, fetch: doFetch, storage: memoryStorage() });

  await assert.rejects(
    () => client.apply({ date_of_birth: "2015-01-01" }),
    /الثامنة عشرة/,
  );
});

test("a project without anonymous sign-ins says so, in Arabic", async () => {
  const doFetch = stubFetch([() => ({ body: { msg: "no session" } })]);
  const client = createClient({ url: URL_, key: KEY, fetch: doFetch, storage: memoryStorage() });

  await assert.rejects(() => client.myApplication(), /Anonymous sign-ins/);
});

test("storage that throws does not break the page", async () => {
  const hostile = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("denied"); },
    removeItem() { throw new Error("denied"); },
  };
  const doFetch = stubFetch([
    () => ({ body: sessionBody() }),
    () => ({ body: { status: "applying" } }),
  ]);
  const client = createClient({ url: URL_, key: KEY, fetch: doFetch, storage: hostile });

  const result = await client.myApplication();
  assert.equal(result.status, "applying");
});

test("wouldRedact unwraps PostgREST's single-row array", async () => {
  const doFetch = stubFetch([
    () => ({ body: sessionBody() }),
    () => ({ body: [{ body_out: "رقمي ▮▮▮", categories: ["phone"] }] }),
  ]);
  const client = createClient({ url: URL_, key: KEY, fetch: doFetch, storage: memoryStorage() });

  const verdict = await client.wouldRedact("رقمي 0599123456");
  assert.equal(verdict.body, "رقمي ▮▮▮");
  assert.deepEqual(verdict.categories, ["phone"]);
});

test("the application is sent under one key, so the function signature matches", async () => {
  const doFetch = stubFetch([
    () => ({ body: sessionBody() }),
    () => ({ body: { status: "applying" } }),
  ]);
  const client = createClient({ url: URL_, key: KEY, fetch: doFetch, storage: memoryStorage() });

  await client.apply({ display_name: "سارة", gender: "female" });

  assert.deepEqual(doFetch.calls[1].body, {
    application: { display_name: "سارة", gender: "female" },
  });
});

test("linking an email says so when the project holds it pending confirmation", async () => {
  // GoTrue answers 200 and changes nothing when "Confirm email" is on:
  // the address is pending until a link is clicked. Reporting success
  // there leaves the person to be refused by the next thing they do.
  const doFetch = stubFetch([
    () => ({ body: sessionBody() }),                       // signup (anonymous)
    () => ({ body: { id: "user-1", new_email: "a@b.com" } }), // PUT /user
    () => ({ body: sessionBody() }),                       // refresh
    () => ({ body: { user_id: "user-1", has_credential: false } }), // whoami
  ]);
  const client = createClient({ url: URL_, key: KEY, fetch: doFetch, storage: memoryStorage() });

  await assert.rejects(
    () => client.linkEmailPassword("a@b.com", "a-good-password"),
    (err) => {
      assert.equal(err.code, "email_confirmation_pending");
      assert.match(err.message, /Confirm email/);
      return true;
    },
  );
});

test("linking succeeds quietly when the account really did gain a credential", async () => {
  const doFetch = stubFetch([
    () => ({ body: sessionBody() }),
    () => ({ body: { id: "user-1", email: "a@b.com" } }),
    () => ({ body: sessionBody() }),
    () => ({ body: { user_id: "user-1", has_credential: true, email: "a@b.com" } }),
  ]);
  const client = createClient({ url: URL_, key: KEY, fetch: doFetch, storage: memoryStorage() });

  const result = await client.linkEmailPassword("a@b.com", "a-good-password");
  assert.equal(result.email, "a@b.com");
});

test("the email rate limit is not described as a one-minute wait", async () => {
  // It resets hourly and the real fix is a project setting, so "try again
  // in a minute" is advice that leaves someone pressing a button.
  const doFetch = stubFetch([
    () => ({ status: 429, body: { error_code: "over_email_send_rate_limit",
                                  msg: "email rate limit exceeded" } }),
  ]);
  const client = createClient({ url: URL_, key: KEY, fetch: doFetch, storage: memoryStorage() });

  await assert.rejects(() => client.signUpWithPassword("a@b.com", "a-good-password"), (err) => {
    assert.match(err.message, /Confirm email/);
    assert.doesNotMatch(err.message, /دقيقة/);
    return true;
  });
});
