// The site, in a real browser, twice: once with no backend configured and
// once with Supabase stubbed at the network layer.
//
// The unit tests cover the rules; this covers the wiring between them,
// which is where this kind of app actually breaks — a chip that sends its
// label instead of its enum, a form that posts before the session exists,
// a returning visitor dropped back on the welcome screen. None of that
// shows up in a test that imports a module.
//
//   npx playwright install chromium     # once
//   node apps/web/test/browser.mjs
//
// Needs playwright and a chromium, which is why it is not part of
// `npm test`: the unit tests must stay runnable with nothing installed.
// CHROMIUM_PATH overrides the browser, for environments that already
// have one.
// Playwright is usually installed globally rather than here, and ESM does
// not look in the global root the way `require` does. Try the normal
// import first, then the global root, then say so plainly.
const { chromium } = await (async () => {
  try { return await import('playwright'); } catch { /* not local */ }
  try {
    const { createRequire } = await import('node:module');
    const { execSync } = await import('node:child_process');
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return createRequire(`${root}/`)('playwright');
  } catch {
    console.error('This test needs playwright:  npm i -g playwright && npx playwright install chromium');
    process.exit(2);
  }
})();
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.ttf':'font/ttf' };

// The same headers Vercel will send, read from vercel.json rather than
// copied. Serving the site here without them is how a Content-Security-
// Policy mistake reaches production green: `img-src` was missing the
// Supabase host, so every photo was blocked in the browser while fetch()
// — governed by connect-src, which did allow it — kept working, and
// every test passed.
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, '..', '..', 'vercel.json'), 'utf8'));
const PROD_HEADERS = Object.fromEntries(
  (vercel.headers.find((h) => h.source === '/(.*)')?.headers || [])
    .filter((h) => h.key !== 'Strict-Transport-Security')   // would force https on localhost
    .map((h) => [h.key, h.value]),
);

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, {
    ...PROD_HEADERS,
    'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
  });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const fails = [];
const check = (ok, label) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`); if (!ok) fails.push(label); };

// ---------- 1. no config: the fixtures stand ----------
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/`);
  await page.waitForTimeout(400);
  check(errors.length === 0, `no page errors without config ${errors.join('; ')}`);
  check(await page.locator('text=البيانات ثابتة ولا يوجد خادم').count() === 1, 'welcome says there is no server');
  await page.locator('[data-go="apply"]').click();
  await page.waitForTimeout(200);
  check(await page.locator('input[name="display_name"]').count() === 1, 'apply form renders');
  await page.locator('#apply-submit').click();
  await page.waitForTimeout(150);
  check((await page.locator('#apply-error').innerText()).includes('اكتب الاسم'), 'empty name is refused locally');
  await page.locator('input[name="display_name"]').fill('سارة');
  await page.locator('input[name="date_of_birth"]').fill('2010-01-01');
  await page.locator('#apply-submit').click();
  await page.waitForTimeout(150);
  check((await page.locator('#apply-error').innerText()).includes('الثامنة عشرة'), 'a 16-year-old is refused before any round trip');
  await page.close();
}

// ---------- 2. with a stubbed Supabase ----------
{
  fs.writeFileSync(path.join(ROOT, 'config.js'),
    'export const SUPABASE_URL = "https://stub.supabase.co";\nexport const SUPABASE_ANON_KEY = "anon";\n');

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  let stored = null;
  const seen = [];
  await page.route('https://stub.supabase.co/**', async (route) => {
    const url = route.request().url();
    const body = route.request().postDataJSON() || {};
    seen.push(url);
    if (url.includes('/auth/v1/signup')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        access_token: 't', refresh_token: 'r',
        expires_at: Math.floor(Date.now()/1000)+3600, user: { id: 'u1' } }) });
    }
    if (url.includes('apply_for_membership')) {
      stored = body.application;
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'pending_review', display_name: stored.display_name }) });
    }
    if (url.includes('my_application')) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(stored ? { status: 'pending_review', display_name: stored.display_name } : null) });
    }
    if (url.includes('/rpc/whoami')) {
      // Already signed in: this section is about what the form sends,
      // not about onboarding. The account step has its own section.
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ user_id: 'u1', is_admin: false, has_row: !!stored,
                               email: 'existing@example.com', has_credential: true,
                               is_anonymous: false,
                               status: stored ? 'pending_review' : null }) });
    }
    if (url.includes('/rpc/my_profile')) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(stored ? { user_id: 'u1', status: 'pending_review', photos: [],
                                        ...stored } : { user_id: '' }) });
    }
    return route.fulfill({ status: 404, body: '{}' });
  });

  await page.goto(`${base}/`);
  await page.waitForTimeout(500);
  check(errors.length === 0, `no page errors with config ${errors.join('; ')}`);
  check(await page.locator('text=يُحفظ فعلياً').count() > 0, 'welcome says the application is saved');

  await page.locator('[data-go="apply"]').click();
  await page.waitForTimeout(200);
  await page.locator('input[name="display_name"]').fill('سارة');
  await page.locator('input[name="date_of_birth"]').fill('1996-04-11');
  await page.locator('input[name="city"]').fill('رام الله');
  await page.locator('input[name="phone"]').fill('+970 59 911 1222');
  await page.locator('[data-field="timeline"] .chip[data-value="within_6_months"]').click();
  await page.locator('[data-field="family_aware"] .chip[data-value="false"]').click();
  await page.locator('#apply-submit').click();
  await page.waitForTimeout(400);

  check(!!stored, 'the application reached the server');
  check(stored?.display_name === 'سارة', 'name sent');
  check(stored?.city === 'رام الله', 'Arabic city sent intact');
  check(stored?.gender === 'female', 'chip value, not chip label, is sent');
  check(stored?.timeline === 'within_6_months', 'the chosen timeline enum is sent');
  check(stored?.family_aware === false, 'a boolean chip becomes a boolean');
  check(stored?.phone === '+970599111222', 'the phone is normalised');
  check(stored?.marital_status === 'never_married' && stored?.practice_level === 'practicing',
        'defaults carry the enum values');
  check(page.url().includes('camera'), 'it moves on to the camera step');

  // A returning visitor lands on their status.
  await page.goto(`${base}/`);
  await page.waitForTimeout(600);
  check(page.url().includes('review'), 'a returning applicant lands on their status');
  check((await page.locator('#app').innerText()).includes('قيد المراجعة'), 'the real status is shown');
  check((await page.locator('#app').innerText()).includes('سارة'), 'their name comes back from the server');
  await page.close();
  fs.unlinkSync(path.join(ROOT, 'config.js'));
}

// ---------- 3. the review desk and the profile, with a stubbed Supabase ----------
{
  fs.writeFileSync(path.join(ROOT, 'config.js'),
    'export const SUPABASE_URL = "https://stub.supabase.co";\nexport const SUPABASE_ANON_KEY = "anon";\n');

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // A tiny world: the reviewer, and two people waiting.
  const people = {
    'u-laila': { status: 'applying', display_name: 'ليلى', gender: 'female', age: 29, city: 'رام الله' },
    'u-omar':  { status: 'applying', display_name: 'عمر',  gender: 'male',   age: 33, city: 'نابلس' },
    // The reviewer's own application, which is in the queue like anyone's.
    'u-boss':  { status: 'applying', display_name: 'المالك', gender: 'male', age: 40, city: 'رام الله' },
  };
  const decisions = [];
  let photos = [];
  const uploads = [];

  await page.route('https://stub.supabase.co/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.includes('/auth/v1/signup')) {
      return json({ access_token: 't', refresh_token: 'r',
                    expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u-boss' } });
    }
    if (url.includes('/rpc/whoami'))  return json({ user_id: 'u-boss', is_admin: true, has_row: true });
    if (url.includes('/rpc/my_application')) return json(null);
    if (url.includes('/rpc/my_profile')) {
      return json({ user_id: 'u-boss', status: 'admitted', display_name: 'المالك',
                    city: 'رام الله', marital_status: 'never_married',
                    practice_level: 'practicing', timeline: 'within_1_year',
                    willing_to_relocate: false, family_aware: true, photos });
    }
    if (url.includes('/rpc/admin_queue')) {
      const filter = route.request().postDataJSON()?.filter || 'waiting';
      const rows = Object.entries(people)
        .filter(([, p]) => filter === 'all'
          || (filter === 'waiting' ? ['applying', 'pending_review'].includes(p.status)
                                   : p.status === filter))
        .map(([id, p]) => ({ id, ...p, photo_count: 0 }));
      return json({ filter, counts: { applying: 2 }, rows });
    }
    if (url.includes('/rpc/admin_decide')) {
      const { target, action } = route.request().postDataJSON();
      decisions.push({ target, action });
      people[target].status = action === 'admit' ? 'admitted' : 'rejected';
      return json({ user_id: target, status: people[target].status });
    }
    if (url.includes('/rpc/my_slate')) {
      const cards = Object.entries(people)
        .filter(([, p]) => p.status === 'admitted')
        .map(([id, p], i) => ({ id, rank: i, decision: 'pending',
                                display_name: p.display_name, city: p.city, age: p.age,
                                bio: 'نبذة قصيرة.', timeline: 'within_1_year',
                                marital_status: 'never_married', practice_level: 'practicing',
                                willing_to_relocate: false, family_aware: true,
                                photo_count: 2, photos_unlocked: false }));
      return json({ gated: false, membership: 'basic', size: 5, cards });
    }
    if (url.includes('/rpc/my_benefits')) {
      return json({ membership: 'basic', daily_candidates: 5, can_see_interest: false,
                    can_search: false, release_discount: 0 });
    }
    if (url.includes('/storage/v1/object/sign/')) {
      return json({ signedURL: '/object/signed/photos/x?token=abc' });
    }
    if (url.includes('/storage/v1/object/photos/') && method === 'POST') {
      uploads.push(url);
      return json({ Key: 'photos/u-boss/1-a.png' });
    }
    if (url.includes('/rpc/add_photo')) {
      const { path: p } = route.request().postDataJSON();
      photos = [{ id: 'ph-1', storage_path: p, ordinal: 0, is_primary: true, approved: false }];
      return json({ id: 'ph-1', storage_path: p });
    }
    if (url.includes('/rpc/delete_photo')) {
      const gone = photos[0];
      photos = [];
      return json({ deleted: gone.id, storage_path: gone.storage_path });
    }
    return json({}, 404);
  });

  await page.goto(`${base}/`);
  await page.waitForTimeout(700);

  check(errors.length === 0, `no page errors on the desk ${errors.join('; ')}`);
  check(page.url().includes('admin'), 'a reviewer lands on the review desk, not the welcome screen');

  const deskText = await page.locator('#app').innerText();
  check(deskText.includes('ليلى') && deskText.includes('عمر'), 'both applicants are listed');
  check(await page.locator('[data-decide-user][data-id="u-boss"]').count() === 0,
        'the reviewer is offered no decision on their own row');
  check(deskText.includes('هذا طلبك أنت'),
        'it says why, instead of letting the server refuse in English');

  // Admit one, reject the other.
  await page.locator('[data-decide-user="admit"][data-id="u-laila"]').click();
  await page.waitForTimeout(400);
  check(decisions.some((d) => d.target === 'u-laila' && d.action === 'admit'),
        'admitting sends the decision to the server');

  await page.locator('[data-decide-user="reject"][data-id="u-omar"]').click();
  await page.waitForTimeout(400);
  check(decisions.some((d) => d.target === 'u-omar' && d.action === 'reject'), 'so does rejecting');
  const remaining = await page.locator('#app').innerText();
  check(!remaining.includes('ليلى') && !remaining.includes('عمر'),
        'decided applicants leave the waiting queue');
  check(remaining.includes('المالك'),
        "and the reviewer's own undecidable application is what is left");

  await page.locator('[data-queue="admitted"]').click();
  await page.waitForTimeout(400);
  check((await page.locator('#app').innerText()).includes('ليلى'),
        'the admitted filter shows the person just admitted');

  // The directory now has a real member in it.
  await page.locator('[data-tab="today"]').click();
  await page.waitForTimeout(500);
  const todayText = await page.locator('#app').innerText();
  check(todayText.includes('ليلى'), 'the deck shows the admitted member, not the fixture');
  check(!todayText.includes('يوسف'), 'and the fixture candidate is gone');

  // Photos.
  await page.locator('[data-tab="profile"]').click();
  await page.waitForTimeout(500);
  check((await page.locator('#app').innerText()).includes('select grant_admin'),
        'the profile shows the SQL line for granting admin, with a real id');

  await page.locator('#photo-input').setInputFiles({
    name: 'me.png', mimeType: 'image/png',
    buffer: Buffer.from('89504e470d0a1a0a', 'hex'),
  });
  await page.waitForTimeout(600);
  check(uploads.length === 1, 'the file is uploaded to storage');
  check(uploads[0].includes('/photos/u-boss/'),
        'under a path that starts with the user id — the storage policy checks that segment');
  check(await page.locator('.photo-cell[data-path]').count() === 1, 'and the photo appears');

  await page.locator('[data-del-photo]').click();
  await page.waitForTimeout(500);
  check(await page.locator('.photo-cell[data-path]').count() === 0, 'deleting removes it');

  await page.close();
  fs.unlinkSync(path.join(ROOT, 'config.js'));
}

// ---------- 4. the review desk seen by someone who is not a reviewer ----------
{
  fs.writeFileSync(path.join(ROOT, 'config.js'),
    'export const SUPABASE_URL = "https://stub.supabase.co";\nexport const SUPABASE_ANON_KEY = "anon";\n');

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.route('https://stub.supabase.co/**', async (route) => {
    const url = route.request().url();
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/signup')) {
      return json({ access_token: 't', refresh_token: 'r',
                    expires_at: Math.floor(Date.now() / 1000) + 3600,
                    user: { id: '106bdd2d-c487-4c16-8d79-3c66808722ef' } });
    }
    if (url.includes('/rpc/whoami')) {
      return json({ user_id: '106bdd2d-c487-4c16-8d79-3c66808722ef',
                    is_admin: false, has_row: false });
    }
    if (url.includes('/rpc/my_application')) return json(null);
    // What the live server actually answers for a non-reviewer.
    if (url.includes('/rpc/admin_queue')) {
      return json({ code: 'P0001', message: 'not an admin' }, 400);
    }
    return json({}, 404);
  });

  await page.goto(`${base}/#/admin`);
  await page.waitForTimeout(800);

  const text = await page.locator('#app').innerText();
  check(errors.length === 0, `no page errors on the closed desk ${errors.join('; ')}`);
  check(text.includes('لست مراجعاً'), 'a non-reviewer gets an explanation, in Arabic');
  check(!text.includes('not an admin'), 'and not the raw English error');
  check(!text.includes('لا أحد هنا'), 'the desk itself is not rendered behind it');
  check(text.includes("select grant_admin('106bdd2d-c487-4c16-8d79-3c66808722ef');"),
        'with the real account id in the statement that grants it');

  // The tap-to-copy path. Clipboard permission is granted so writeText resolves.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'],
                                        { origin: base });
  await page.locator('[data-copy]').click();
  await page.waitForTimeout(300);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  check(copied === "select grant_admin('106bdd2d-c487-4c16-8d79-3c66808722ef');",
        'tapping the line copies the whole statement');

  await page.close();
  fs.unlinkSync(path.join(ROOT, 'config.js'));
}

// ---------- 5. a falsy answer must not become an infinite fetch loop ----------
//
// The live bug: my_profile() answers null for a visitor who has not
// applied, the router guarded on `!state.profile`, and the guard never
// closed — render, fetch, render, about five requests a second at the
// database for as long as the screen was open. Counting requests is the
// only way to see it; the screen just says "loading…" either way.
{
  fs.writeFileSync(path.join(ROOT, 'config.js'),
    'export const SUPABASE_URL = "https://stub.supabase.co";\nexport const SUPABASE_ANON_KEY = "anon";\n');

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const counts = {};
  const bump = (url) => {
    const name = (url.match(/\/rpc\/(\w+)/) || [])[1];
    if (name) counts[name] = (counts[name] || 0) + 1;
  };

  await page.route('https://stub.supabase.co/**', async (route) => {
    const url = route.request().url();
    bump(url);
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/signup')) {
      return json({ access_token: 't', refresh_token: 'r',
                    expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u-new' } });
    }
    if (url.includes('/rpc/whoami')) return json({ user_id: 'u-new', is_admin: false, has_row: false });
    if (url.includes('/rpc/my_application')) return json(null);
    if (url.includes('/rpc/my_profile')) return json(null);      // ← the trigger
    if (url.includes('/rpc/browse_members')) return json({ gated: true, status: 'none', rows: [] });
    return json({}, 404);
  });

  await page.goto(`${base}/#/profile`);
  await page.waitForTimeout(2500);

  check((counts.my_profile || 0) === 1,
        `my_profile fetched exactly once, not in a loop (was ${counts.my_profile || 0})`);
  const profileText = await page.locator('#app').innerText();
  check(!profileText.includes('جارٍ التحميل'), 'and the screen leaves the loading state');
  check(profileText.includes('لم تُرسل طلب انضمام'), 'showing the apply prompt instead');

  // Same shape on the directory, whose gate is also a falsy-ish answer.
  await page.locator('[data-tab="today"]').click();
  await page.waitForTimeout(1500);
  check((counts.my_slate || 0) === 1,
        `my_slate fetched once too (was ${counts.my_slate || 0})`);

  // Going back and forth must not refetch what is already held.
  await page.locator('[data-tab="profile"]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-tab="today"]').click();
  await page.waitForTimeout(400);
  check((counts.my_profile || 0) === 1 && (counts.my_slate || 0) === 1,
        'and revisiting a screen reuses what was fetched');

  await page.close();
  fs.unlinkSync(path.join(ROOT, 'config.js'));
}

// ---------- 5b. an unknown route must not be a white page ----------
//
// How it happened: a link to #/login opened against a deployment that
// predated that screen. The router returned early, #app was never
// written to, and the site showed nothing at all.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${base}/#/screen-that-does-not-exist`);
  await page.waitForTimeout(500);

  const text = await page.locator('#app').innerText();
  check(text.trim().length > 0, 'an unknown route renders something, not a white page');
  check(text.includes('لا توجد هذه الصفحة'), 'and says the screen does not exist');
  check(text.includes('screen-that-does-not-exist'), 'naming the route that was asked for');

  await page.locator('[data-go="welcome"]').click();
  await page.waitForTimeout(400);
  check((await page.locator('#app').innerText()).includes('نصيب'),
        'with a way back to the start');
  await page.close();
}

// ---------- 6. reviewer sign-in ----------
{
  fs.writeFileSync(path.join(ROOT, 'config.js'),
    'export const SUPABASE_URL = "https://stub.supabase.co";\nexport const SUPABASE_ANON_KEY = "anon";\n');

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Two accounts with correct passwords: one granted, one not. The
  // difference between them is the whole point — signing in proves who
  // you are and grants nothing.
  const accounts = {
    'boss@nasib.app':   { password: 'right-one', id: 'u-boss',   admin: true },
    'nobody@nasib.app': { password: 'right-one', id: 'u-nobody', admin: false },
  };
  let signedIn = null;
  let loggedOut = false;

  await page.route('https://stub.supabase.co/**', async (route) => {
    const url = route.request().url();
    const body = route.request().postDataJSON() || {};
    const json = (b, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });

    if (url.includes('grant_type=password')) {
      const account = accounts[body.email];
      if (!account || account.password !== body.password) {
        return json({ error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
      }
      signedIn = body.email;
      return json({ access_token: 't-' + account.id, refresh_token: 'r',
                    expires_at: Math.floor(Date.now() / 1000) + 3600,
                    user: { id: account.id, email: body.email } });
    }
    if (url.includes('/auth/v1/logout')) {
      // The real GoTrue revokes the token, so whoami stops recognising
      // the account. Forgetting that here made the stub claim the
      // reviewer was still signed in after signing out.
      loggedOut = true;
      signedIn = null;
      return json({});
    }
    if (url.includes('/auth/v1/signup')) {
      return json({ access_token: 't-anon', refresh_token: 'r',
                    expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u-anon' } });
    }
    if (url.includes('/rpc/whoami')) {
      const account = signedIn ? accounts[signedIn] : null;
      return json(account
        ? { user_id: account.id, email: signedIn, is_anonymous: false,
            is_admin: account.admin, has_row: false }
        : { user_id: 'u-anon', email: null, is_anonymous: true, is_admin: false, has_row: false });
    }
    if (url.includes('/rpc/my_application')) return json(null);
    if (url.includes('/rpc/my_profile')) return json(null);
    if (url.includes('/rpc/admin_queue')) {
      const account = signedIn ? accounts[signedIn] : null;
      return account?.admin
        ? json({ filter: 'waiting', counts: {}, rows: [] })
        : json({ code: 'P0001', message: 'not an admin' }, 400);
    }
    if (url.includes('/rpc/browse_members')) return json({ gated: true, status: 'none', rows: [] });
    return json({}, 404);
  });

  await page.goto(`${base}/#/staff`);
  await page.waitForTimeout(600);
  check(errors.length === 0, `no page errors on the reviewer login ${errors.join('; ')}`);
  check((await page.locator('#app').innerText()).includes('هذه الشاشة لمن يراجع الطلبات'),
        'the reviewer screen says who it is for');

  // Wrong password.
  await page.locator('[name="email"]').fill('boss@nasib.app');
  await page.locator('[name="password"]').fill('wrong');
  await page.locator('#login-submit').click();
  await page.waitForTimeout(400);
  check((await page.locator('#login-error').innerText()).includes('غير صحيحة'),
        'a wrong password is refused, in Arabic');
  check(!page.url().includes('admin'), 'and goes nowhere');

  // Right password, but the account was never granted.
  await page.locator('[name="password"]').fill('right-one');
  await page.locator('[name="email"]').fill('nobody@nasib.app');
  await page.locator('#login-submit').click();
  await page.waitForTimeout(500);
  const notGranted = await page.locator('#login-error').innerText();
  check(notGranted.includes('ليس مراجعاً'),
        'a correct password on an ungranted account signs in but reviews nothing');
  check(notGranted.includes('grant_admin_by_email'),
        'and names the command that would grant it');
  check(!page.url().includes('admin'), 'it does not drop them on a desk that refuses them');

  // Right password on the granted account.
  await page.locator('[name="email"]').fill('boss@nasib.app');
  await page.locator('[name="password"]').fill('right-one');
  await page.locator('#login-submit').click();
  await page.waitForTimeout(700);
  check(page.url().includes('admin'), 'a granted reviewer lands on the desk');
  const desk = await page.locator('#app').innerText();
  check(desk.includes('boss@nasib.app'), 'which shows the account doing the reviewing');

  // Signing out.
  await page.locator('[data-signout]').click();
  await page.waitForTimeout(700);
  check(loggedOut, 'signing out revokes the token server-side too');
  await page.goto(`${base}/#/admin`);
  await page.waitForTimeout(800);
  const after = await page.locator('#app').innerText();
  check(after.includes('لست مراجعاً'), 'and the desk is closed again afterwards');
  check(!after.includes('boss@nasib.app'), 'with no trace of the account that left');

  await page.close();
  fs.unlinkSync(path.join(ROOT, 'config.js'));
}

// ---------- 7. members sign in, and keep what they started ----------
{
  fs.writeFileSync(path.join(ROOT, 'config.js'),
    'export const SUPABASE_URL = "https://stub.supabase.co";\nexport const SUPABASE_ANON_KEY = "anon";\n');

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // One anonymous account that has already applied. Linking an email to
  // it must keep the application — that is the whole point.
  let account = { id: 'u-anon', email: null };
  const applications = { 'u-anon': { status: 'pending_review', display_name: 'سارة' } };
  let linkedTo = null;

  await page.route('https://stub.supabase.co/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    const body = route.request().postDataJSON() || {};
    const json = (b, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });

    if (url.includes('/auth/v1/signup')) {
      return json({ access_token: 't', refresh_token: 'r',
                    expires_at: Math.floor(Date.now() / 1000) + 3600, user: account });
    }
    if (url.includes('/auth/v1/user') && method === 'PUT') {
      // The same account gains a credential. Its id does not change.
      account = { ...account, email: body.email };
      linkedTo = body.email;
      return json(account);
    }
    if (url.includes('grant_type=refresh_token')) {
      return json({ access_token: 't2', refresh_token: 'r',
                    expires_at: Math.floor(Date.now() / 1000) + 3600, user: account });
    }
    if (url.includes('/rpc/whoami')) {
      return json({ user_id: account.id, email: account.email,
                    has_credential: !!account.email, is_anonymous: !account.email,
                    is_admin: false, has_row: !!applications[account.id] });
    }
    if (url.includes('/rpc/my_application')) return json(applications[account.id] || null);
    if (url.includes('/rpc/my_profile')) {
      const app = applications[account.id];
      return json(app ? { user_id: account.id, status: app.status,
                          display_name: app.display_name, photos: [] } : null);
    }
    if (url.includes('/rpc/browse_members')) return json({ gated: true, status: 'none', rows: [] });
    return json({}, 404);
  });

  await page.goto(`${base}/#/profile`);
  await page.waitForTimeout(900);
  check(errors.length === 0, `no page errors on the profile ${errors.join('; ')}`);

  const before = await page.locator('#app').innerText();
  check(before.includes('حسابك مرتبط بهذا المتصفح وحده'),
        'an anonymous member is told their account is stuck to this browser');
  check(before.includes('سارة'), 'while still showing the application they started');

  await page.locator('[name="link-email"]').fill('sara@example.com');
  await page.locator('[name="link-password"]').fill('a-good-password');
  await page.locator('#link-submit').click();
  await page.waitForTimeout(900);

  check(linkedTo === 'sara@example.com', 'linking sends the email to the same account');
  const after = await page.locator('#app').innerText();
  check(after.includes('sara@example.com'), 'the profile now shows the signed-in address');
  check(after.includes('سارة'),
        'and the application survived — linking is not starting over');

  // The member login screen exists and is not the reviewer one.
  await page.goto(`${base}/#/login`);
  await page.waitForTimeout(500);
  const login = await page.locator('#app').innerText();
  check(!login.includes('دخول المراجعين'), '/#/login is the member screen, not the reviewer one');
  check(login.includes('ليس لديّ حساب'), 'and offers to create an account');

  await page.locator('[data-login-mode="signup"]').click();
  await page.waitForTimeout(300);
  check((await page.locator('#app').innerText()).includes('أنشئ حسابك'),
        'which switches the screen to creating one');

  await page.goto(`${base}/#/staff`);
  await page.waitForTimeout(500);
  const staff = await page.locator('#app').innerText();
  check(staff.includes('دخول المراجعين'), '/#/staff is the reviewer screen');
  check(!staff.includes('ليس لديّ حساب'), 'and does not offer to create an account');

  await page.close();
  fs.unlinkSync(path.join(ROOT, 'config.js'));
}

// ---------- 8. the account step comes last, not first ----------
//
// A new member should be able to fill the whole application before being
// asked to commit to anything. The credential is required to submit —
// the database enforces that — but requiring it to *start* asks someone
// to sign up for a product they have not seen.
{
  fs.writeFileSync(path.join(ROOT, 'config.js'),
    'export const SUPABASE_URL = "https://stub.supabase.co";\nexport const SUPABASE_ANON_KEY = "anon";\n');

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  let account = { id: 'u-fresh', email: null };
  let linked = null;
  let submitted = null;

  await page.route('https://stub.supabase.co/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    const body = route.request().postDataJSON() || {};
    const json = (b, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });

    if (url.includes('/auth/v1/signup')) {
      return json({ access_token: 't', refresh_token: 'r',
                    expires_at: Math.floor(Date.now() / 1000) + 3600, user: account });
    }
    if (url.includes('/auth/v1/user') && method === 'PUT') {
      account = { ...account, email: body.email };
      linked = body.email;
      return json(account);
    }
    if (url.includes('grant_type=refresh_token')) {
      return json({ access_token: 't2', refresh_token: 'r',
                    expires_at: Math.floor(Date.now() / 1000) + 3600, user: account });
    }
    if (url.includes('/rpc/whoami')) {
      return json({ user_id: account.id, email: account.email,
                    has_credential: !!account.email, is_anonymous: !account.email,
                    is_admin: false, has_row: false });
    }
    if (url.includes('/rpc/my_application')) return json(null);
    if (url.includes('/rpc/apply_for_membership')) {
      // What the live database does for a session with no credential.
      if (!account.email) {
        return json({ code: 'P0001', message: 'أنشئ حساباً ببريد وكلمة مرور قبل إرسال الطلب' }, 400);
      }
      submitted = body.application;
      return json({ status: 'applying', display_name: submitted.display_name });
    }
    return json({}, 404);
  });

  await page.goto(`${base}/#/apply`);
  await page.waitForTimeout(700);

  const form = await page.locator('#app').innerText();
  check(errors.length === 0, `no page errors on the form ${errors.join('; ')}`);
  check(!form.includes('البريد الإلكتروني'),
        'a new member is not asked for an email before filling anything in');
  check(await page.locator('input[name="display_name"]').count() === 1,
        'the form itself is what they see first');

  // Fill it in, then submit.
  await page.locator('input[name="display_name"]').fill('نور');
  await page.locator('input[name="date_of_birth"]').fill('1995-06-15');
  await page.locator('input[name="city"]').fill('غزة');
  await page.locator('#apply-submit').click();
  await page.waitForTimeout(500);

  check(await page.locator('#apply-account').count() === 1,
        'the account step appears at the end, after the form is filled');
  check(submitted === null, 'and nothing was sent before the account existed');

  // A short password is caught before any request.
  await page.locator('[name="apply-email"]').fill('noor@example.com');
  await page.locator('[name="apply-password"]').fill('123');
  await page.locator('#apply-account-submit').click();
  await page.waitForTimeout(300);
  check((await page.locator('#apply-account-error').innerText()).includes('٦ أحرف'),
        'a short password is refused without a round trip');
  check(linked === null, 'nothing was linked');

  await page.locator('[name="apply-password"]').fill('a-good-password');
  await page.locator('#apply-account-submit').click();
  await page.waitForTimeout(900);

  check(linked === 'noor@example.com', 'the account is created on submit');
  check(submitted?.display_name === 'نور',
        'and the application the person filled in is what gets sent');
  check(submitted?.city === 'غزة', 'with every field they typed, not a blank form');
  check(page.url().includes('camera'), 'then it carries on to the camera step');

  await page.close();
  fs.unlinkSync(path.join(ROOT, 'config.js'));
}

// ---------- 9. the rest of the desk, and the member screens ----------
{
  fs.writeFileSync(path.join(ROOT, 'config.js'),
    'export const SUPABASE_URL = "https://stub.supabase.co";\nexport const SUPABASE_ANON_KEY = "anon";\n');

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  let photos = [
    { id: 'ph-1', storage_path: 'u-x/1.jpg', is_primary: true, user_id: 'u-x',
      display_name: 'ليلى', city: 'رام الله', age: 29, status: 'admitted' },
    { id: 'ph-2', storage_path: 'u-y/2.jpg', is_primary: false, user_id: 'u-y',
      display_name: 'عمر', city: 'نابلس', age: 33, status: 'admitted' },
  ];
  let reports = [{ id: 'r-1', reason: 'asked_for_money', detail: 'طلب مالاً للسفر',
                   status: 'open', created_at: new Date().toISOString(),
                   reported_id: 'u-y', reported_name: 'عمر', reported_status: 'admitted',
                   reporter_id: 'u-x', reporter_name: 'ليلى',
                   reports_against_total: 2, reports_by_reporter: 1 }];
  let requests = [{ id: 'q-1', note: 'أودّ التعرّف', created_at: new Date().toISOString(),
                    requester_id: 'u-y', requester_name: 'عمر', requester_status: 'admitted',
                    requester_age: 33, owner_id: 'u-x', owner_name: 'ليلى',
                    requests_by_requester: 1 }];
  let memberTier = 'basic';
  const acted = [];

  await page.route('https://stub.supabase.co/**', async (route) => {
    const url = route.request().url();
    const body = route.request().postDataJSON() || {};
    const json = (b, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });

    if (url.includes('/auth/v1/signup')) {
      return json({ access_token: 't', refresh_token: 'r',
                    expires_at: Math.floor(Date.now() / 1000) + 3600,
                    user: { id: 'u-boss', email: 'boss@nasib.app' } });
    }
    if (url.includes('/rpc/whoami')) {
      return json({ user_id: 'u-boss', email: 'boss@nasib.app', is_admin: true,
                    has_credential: true, is_anonymous: false, has_row: false });
    }
    if (url.includes('/rpc/my_application')) return json(null);
    if (url.includes('/rpc/admin_stats')) {
      return json({ waiting: 3, admitted: 2, photos_pending: photos.length,
                    requests_pending: requests.length,
                    reports_open: reports.filter((r) => r.status === 'open').length,
                    matches_active: 1, applied_7d: 4, decided_7d: 2,
                    longest_wait_hours: 50, median_decision_hours: 6 });
    }
    if (url.includes('/rpc/admin_photo_queue')) {
      const f = body.filter || 'pending';
      return json({ filter: f,
        counts: { pending: photos.filter((p) => !p.approved).length,
                  approved: photos.filter((p) => p.approved).length },
        rows: photos.filter((p) => f === 'all' ? true
                                 : f === 'approved' ? p.approved : !p.approved) });
    }
    if (url.includes('/rpc/admin_photo_action')) {
      acted.push({ what: 'photo', id: body.photo_id, action: body.action });
      const one = photos.find((p) => p.id === body.photo_id);
      if (body.action === 'delete') photos = photos.filter((p) => p.id !== body.photo_id);
      else one.approved = body.action === 'approve';
      return json({ id: body.photo_id, action: body.action, storage_path: one.storage_path });
    }
    if (url.includes('/rpc/admin_search')) {
      const q = (body.q || '').trim();
      return json(q.length < 2 ? []
        : [{ id: 'u-y', display_name: 'عمر', city: 'نابلس', age: 33,
             status: 'admitted', photo_count: 1 }]);
    }
    if (url.includes('/rpc/admin_meetings')) {
      return json({ filter: 'pending', counts: { pending: 1, scheduled: 0 },
        rows: [{ id: 'mt-1', state: 'pending_scheduling', party_a: 'ليلى', party_b: 'عمر',
                 city: 'رام الله', proposed_at: new Date().toISOString(),
                 proposer_brings_family: true, invitee_brings_family: true }] });
    }
    if (url.includes('/rpc/open_slots')) {
      return json([{ slot_id: 's-1', starts_at: new Date(Date.now() + 864e5).toISOString(),
                     room: 'غرفة 1', staff_name: 'أم محمد' }]);
    }
    if (url.includes('/rpc/schedule_meeting')) {
      acted.push({ what: 'schedule', meeting: body.p_meeting_id, slot: body.p_slot_id });
      return json(null);
    }
    if (url.includes('/rpc/admin_audit')) {
      return json([
        { at: new Date().toISOString(), kind: 'decision', who: 'Owner',
          what: 'admit', detail: 'looks_genuine', subject: 'ليلى' },
        { at: new Date().toISOString(), kind: 'access', who: 'Owner',
          what: 'member', detail: null, subject: 'عمر' }]);
    }
    if (url.includes('/rpc/admin_banned_emails')) {
      return json([{ email: 'scammer@example.com', reason: 'asked_for_money',
                     banned_by: 'Owner', created_at: new Date().toISOString() }]);
    }
    if (url.includes('/rpc/admin_reviewers')) {
      return json([{ email: 'owner@nasib.app', full_name: 'Owner', role: 'admin',
                     active: true, is_me: true, decisions: 12,
                     last_decision: new Date().toISOString() }]);
    }
    if (url.includes('/rpc/admin_reports')) {
      return json({ filter: 'open', counts: { open: reports.length },
                    rows: reports.filter((r) => r.status === 'open') });
    }
    if (url.includes('/rpc/admin_resolve_report')) {
      acted.push({ what: 'report', id: body.report_id, action: body.action });
      reports = reports.map((r) => r.id === body.report_id ? { ...r, status: body.action } : r);
      return json({ id: body.report_id, status: body.action });
    }
    if (url.includes('/rpc/admin_photo_requests')) return json(requests);
    if (url.includes('/rpc/admin_screen_photo_request')) {
      acted.push({ what: 'screen', id: body.request_id, allow: body.allow });
      requests = requests.filter((r) => r.id !== body.request_id);
      return json(null);
    }
    if (url.includes('/rpc/admin_set_membership')) {
      acted.push({ what: 'membership', id: body.target, level: body.level,
                   months: body.months });
      memberTier = body.level;
      return json({ user_id: body.target, membership: body.level,
                    membership_until: body.level === 'basic' ? null
                      : '2027-04-01T00:00:00Z' });
    }
    if (url.includes('/rpc/admin_member')) {
      return json({ user_id: body.target, display_name: 'عمر', age: 33, city: 'نابلس',
                    membership: memberTier, membership_until: memberTier === 'basic'
                      ? null : '2027-01-01T00:00:00Z',
                    status: 'admitted', marital_status: 'never_married',
                    practice_level: 'practicing', timeline: 'within_1_year',
                    bio: 'مهندس مدني.', occupation: 'مهندس', children_count: 0,
                    willing_to_relocate: true, family_aware: true, wali_required: false,
                    reports_against: 2, matches: 1,
                    photos: [{ id: 'ph-2', storage_path: 'u-y/2.jpg', ordinal: 0,
                               is_primary: true, approved: false }],
                    decisions: [{ action: 'admit', reason_code: 'looks_genuine',
                                  created_at: new Date().toISOString(), by: 'Owner' }] });
    }
    if (url.includes('/rpc/admin_queue')) {
      return json({ filter: 'waiting', counts: { applying: 3 }, rows: [] });
    }
    if (url.includes('/storage/v1/object/sign/')) return json({ signedURL: '/object/x?token=a' });
    if (url.includes('/rpc/browse_members')) return json({ gated: true, status: 'none', rows: [] });
    return json({}, 404);
  });

  // ── stats ──
  await page.goto(`${base}/#/admin-stats`);
  await page.waitForTimeout(900);
  const stats = await page.locator('#app').innerText();
  check(errors.length === 0, `no page errors across the desk ${errors.join('; ')}`);
  check(stats.includes('50 ساعة'), 'the longest wait is shown, not an average');
  check(stats.includes('في الانتظار'), 'with the queue sizes');

  // ── photo approval ──
  await page.goto(`${base}/#/admin-photos`);
  await page.waitForTimeout(900);
  check((await page.locator('#app').innerText()).includes('ليلى'),
        'the photo queue lists who each photo belongs to');
  check(await page.locator('.photo-cell img.unveiled').count() >= 1,
        'and shows the photo unveiled — a reviewer cannot judge a blur');

  await page.locator('[data-photo-action="approve"]').first().click();
  await page.waitForTimeout(700);
  check(acted.some((a) => a.what === 'photo' && a.action === 'approve'),
        'approving sends the decision');

  // The reported bug: once everything is approved, the screen was empty
  // and looked broken, with no way to see or undo what had been done.
  await page.locator('[data-photo-action="approve"]').first().click();
  await page.waitForTimeout(700);
  check((await page.locator('#app').innerText()).includes('أُنجز كل شيء'),
        'an empty pending queue says the work is done, not nothing');

  await page.locator('[data-photo-filter="approved"]').click();
  await page.waitForTimeout(700);
  const approvedList = await page.locator('#app').innerText();
  check(approvedList.includes('ليلى') && approvedList.includes('عمر'),
        'the approved filter shows what was approved');
  check(approvedList.includes('سحب الاعتماد'),
        'and offers to take an approval back');

  await page.locator('[data-photo-action="unapprove"]').first().click();
  await page.waitForTimeout(700);
  check(acted.some((a) => a.action === 'unapprove'), 'un-approving sends that action');
  check(photos.length === 2, 'and does not delete the photo');

  // Deleting asks twice.
  await page.locator('[data-photo-filter="all"]').click();
  await page.waitForTimeout(600);
  const del = page.locator('[data-photo-action="delete"]').first();
  await del.click();
  await page.waitForTimeout(250);
  check(!acted.some((a) => a.action === 'delete'), 'one tap on delete does not delete');
  check((await del.innerText()).includes('تأكيد'), 'it asks for confirmation first');
  await del.click();
  await page.waitForTimeout(700);
  check(acted.some((a) => a.action === 'delete'), 'and the second tap deletes');

  // ── reports ──
  await page.goto(`${base}/#/admin-reports`);
  await page.waitForTimeout(900);
  const rep = await page.locator('#app').innerText();
  check(rep.includes('طلب مالاً'), 'a report is shown by its reason, in Arabic');
  check(rep.includes('2 بلاغات عليه'), 'with how many reports that person has against them');

  await page.locator('[data-report="actioned"]').click();
  await page.waitForTimeout(700);
  check(acted.some((a) => a.what === 'report' && a.action === 'actioned'), 'resolving a report is sent');

  // ── photo access screening ──
  await page.goto(`${base}/#/admin-requests`);
  await page.waitForTimeout(900);
  check((await page.locator('#app').innerText()).includes('أودّ التعرّف'),
        "the requester's note is shown to the screener");
  await page.locator('[data-screen-request="no"]').click();
  await page.waitForTimeout(700);
  check(acted.some((a) => a.what === 'screen' && a.allow === false),
        'blocking a request is sent, and she is never troubled with it');

  // ── member record ──
  await page.goto(`${base}/#/admin-reports`);
  await page.waitForTimeout(800);
  await page.goto(`${base}/#/admin-photos`);
  await page.waitForTimeout(600);
  await page.goto(`${base}/#/admin`);
  await page.waitForTimeout(800);
  // The desk reaches a member record through a row's "open" button. The
  // stubbed application queue is empty here, so the same delegated
  // handler is exercised through an injected trigger — pinned above the
  // fixed tab bar, which otherwise swallows the click.
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend',
      '<button id="probe" data-member="u-y" style="position:fixed;top:0;inset-inline-start:0;z-index:9999">open</button>');
  });
  await page.locator('#probe').click();
  await page.waitForTimeout(900);
  const member = await page.locator('#app').innerText();
  check(member.includes('عمر'), "a member's record opens");
  check(member.includes('مهندس'), 'with what they submitted');
  check(member.includes('سجلّ القرارات'), 'and the decisions made about them');
  check(member.includes('2 بلاغ'), 'and the reports against them');
  check(!member.includes('phone'), 'and no phone number');
  check(member.includes('الأساسية'), "and the membership they are on");

  // The membership is set from the record, not from a table query: the
  // reviewer who is about to change a tier is looking at the person.
  await page.locator('#membership-months').selectOption('6');
  await page.locator('[data-membership="golden"]').click();
  await page.waitForTimeout(900);
  check(acted.some((a) => a.what === 'membership' && a.level === 'golden'
                          && a.months === 6),
        'and a reviewer can grant a paid tier for a number of months');
  const afterTier = await page.locator('#app').innerText();
  check(afterTier.includes('الذهبية'), 'the record repaints on the new tier');
  check(await page.locator('[data-membership="golden"][aria-pressed="true"]')
              .count() === 1,
        'with the granted tier marked as the current one');

  // ---------- 11. search, meetings and the audit trail ----------
  // Same page and stubs as above: these screens are part of the same
  // desk and the same session.
  await page.goto(`${base}/#/admin-search`);
  await page.waitForTimeout(700);
  await page.locator('#search-q').fill('عم');
  await page.waitForTimeout(800);
  const found = await page.locator('#app').innerText();
  check(found.includes('عمر'), 'typing two letters searches members');
  check(await page.evaluate(() => document.activeElement?.id) === 'search-q',
        'and the field keeps focus while results arrive');

  await page.goto(`${base}/#/admin-meetings`);
  await page.waitForTimeout(900);
  const meet = await page.locator('#app').innerText();
  check(meet.includes('ليلى') && meet.includes('عمر'), 'meetings list both parties');
  check(meet.includes('الطرفان يحضران مع أهلهما'),
        'and flag when families attend, which changes the room');
  await page.locator('[data-schedule]').first().click();
  await page.waitForTimeout(700);
  check(acted.some((a) => a.what === 'schedule' && a.slot === 's-1'),
        'picking a slot schedules the meeting');

  await page.goto(`${base}/#/admin-audit`);
  await page.waitForTimeout(900);
  const audit = await page.locator('#app').innerText();
  check(audit.includes('owner@nasib.app'), 'the audit screen lists the reviewers');
  check(audit.includes('فتح ملف عمر'),
        'and shows profiles opened, not only decisions made');
  check(audit.includes('محرّر SQL'),
        'saying plainly that access is granted only from the SQL editor');
  check(audit.includes('scammer@example.com'), 'and lists the banned addresses');
  check(audit.includes('حظر الحساب وحده لا يكفي'),
        'with why an address is banned rather than only an account');

  await page.close();
  fs.unlinkSync(path.join(ROOT, 'config.js'));
}


// ---------- 10. an approved photo actually appears, and says so ----------
//
// Reported from the live site: photos "not loading" and still marked
// under review after a reviewer approved them. The server was right on
// both counts — the photo was approved and the signed URL served 342KB
// of JPEG — so the failure was here.
{
  fs.writeFileSync(path.join(ROOT, 'config.js'),
    'export const SUPABASE_URL = "https://stub.supabase.co";\nexport const SUPABASE_ANON_KEY = "anon";\n');

  // A real 1x1 PNG, so naturalWidth is a genuine decode rather than a
  // src attribute that happens to be set.
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const blocked = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to load/i.test(m.text())) blocked.push(m.text());
  });

  let approved = false;
  let signCalls = 0;

  await page.route('https://stub.supabase.co/**', async (route) => {
    const url = route.request().url();
    const json = (b, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });

    if (url.includes('/auth/v1/signup')) {
      return json({ access_token: 't', refresh_token: 'r',
                    expires_at: Math.floor(Date.now() / 1000) + 3600,
                    user: { id: 'u-m', email: 'm@example.com' } });
    }
    if (url.includes('/rpc/whoami')) {
      return json({ user_id: 'u-m', email: 'm@example.com', is_admin: false,
                    has_credential: true, is_anonymous: false, has_row: true });
    }
    if (url.includes('/rpc/my_application')) return json({ status: 'admitted' });
    if (url.includes('/rpc/my_profile')) {
      return json({ user_id: 'u-m', status: 'admitted', display_name: 'حموده',
                    city: 'رام الله', marital_status: 'never_married',
                    practice_level: 'practicing', timeline: 'within_1_year',
                    photos: [{ id: 'ph-1', storage_path: 'u-m/a.jpg', ordinal: 0,
                               is_primary: true, approved }] });
    }
    if (url.includes('/storage/v1/object/sign/')) {
      signCalls += 1;
      return json({ signedURL: '/object/sign/photos/u-m/a.jpg?token=abc' });
    }
    if (url.includes('/rpc/browse_members')) return json({ gated: false, status: 'admitted', rows: [] });
    return json({}, 404);
  });
  // The signed URL is fetched by the <img>, from the Supabase host — so
  // this request is governed by img-src, not connect-src. That is the
  // whole point of this case.
  // GET only: the POST that *creates* the signed URL hits the same path
  // prefix, and Playwright matches the most recently registered route
  // first — so without this guard the sign call was answered with a PNG.
  await page.route('**/object/sign/photos/**', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  });

  await page.goto(`${base}/#/profile`);
  await page.waitForTimeout(1200);

  check(errors.length === 0, `no page errors on the profile ${errors.join('; ')}`);
  check(signCalls >= 1, 'a signed URL is requested for the photo');

  const loaded = await page.evaluate(() => {
    const img = document.querySelector('.photo-cell img[data-signed]');
    return img ? { src: !!img.getAttribute('src'), width: img.naturalWidth } : null;
  });
  check(loaded?.src === true, 'the image element gets its src');
  check(loaded?.width > 0, 'and the image actually decodes — not a broken icon');
  check(blocked.length === 0,
        `no Content-Security-Policy refusals ${blocked.join('; ').slice(0, 160)}`);

  check((await page.locator('#app').innerText()).includes('قيد المراجعة'),
        'an unapproved photo says so');

  // Now a reviewer approves it elsewhere. Coming back to the tab is when
  // the member expects to see that.
  approved = true;
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(1000);

  const after = await page.locator('#app').innerText();
  check(!after.includes('قيد المراجعة'),
        'and once approved elsewhere, the member stops being told it is under review');
  check(after.includes('الأساسية'), 'while the rest of the photo card survives the refresh');

  await page.close();
  fs.unlinkSync(path.join(ROOT, 'config.js'));
}

// ---------- 12. the failures that turned the app into a demo ----------
{
  fs.writeFileSync(path.join(ROOT, 'config.js'),
    'export const SUPABASE_URL = "https://stub.supabase.co";\nexport const SUPABASE_ANON_KEY = "anon";\n');

  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const blocked = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to load/i.test(m.text())) blocked.push(m.text());
  });

  await page.route('https://stub.supabase.co/**', async (route) => {
    const url = route.request().url();
    const json = (b, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });

    if (url.includes('/auth/v1/signup')) {
      return json({ access_token: 't', refresh_token: 'r',
                    expires_at: Math.floor(Date.now() / 1000) + 3600,
                    user: { id: 'u-m', email: 'm@example.com' } });
    }
    if (url.includes('/rpc/whoami')) {
      return json({ user_id: 'u-m', email: 'm@example.com', is_admin: false,
                    has_credential: true, is_anonymous: false, has_row: true });
    }
    // The single failing read that used to disable everything.
    if (url.includes('/rpc/my_application')) {
      return json({ code: 'PGRST202', message: 'function does not exist' }, 404);
    }
    if (url.includes('/rpc/my_photo_requests')) return json([]);
    if (url.includes('/rpc/my_photo_grants')) return json([]);
    if (url.includes('/rpc/my_matches')) return json([]);
    if (url.includes('/rpc/my_meetings')) return json([]);
    if (url.includes('/rpc/my_profile')) {
      return json({ user_id: 'u-m', status: 'admitted', display_name: 'حموده',
                    photos: [{ id: 'p1', storage_path: 'u-m/a.jpg', ordinal: 0,
                               is_primary: true, approved: false }] });
    }
    if (url.includes('/storage/v1/object/sign/')) {
      return json({ signedURL: '/object/sign/photos/u-m/a.jpg?token=abc' });
    }
    if (url.includes('/rpc/my_slate')) return json({ gated: false, size: 5, cards: [] });
    if (url.includes('/rpc/my_benefits')) return json({ membership: 'basic', daily_candidates: 5 });
    return json({}, 404);
  });
  await page.route('**/object/sign/photos/**', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  });

  await page.goto(`${base}/#/photos`);
  await page.waitForTimeout(1200);

  const state = await page.evaluate(() => window.nasib?.state);
  check(state?.db === 'connected',
        'one failed read does not turn the whole app into a demo');
  check(!!state?.startupError, 'but it is recorded, so the cause is findable');

  const photos = await page.locator('#app').innerText();
  check(!photos.includes('يوسف'), 'the photos screen shows real data, not the fixture');
  check(photos.includes('لا توجد طلبات الآن'), 'an empty list says it is empty');

  await page.goto(`${base}/#/chat`);
  await page.waitForTimeout(900);
  const chat = await page.locator('#app').innerText();
  check(!chat.includes('الوليّ يطّلع على المحادثة') || chat.includes('لا محادثات بعد'),
        'the chat screen shows the real (empty) match list, not the fixture thread');

  await page.goto(`${base}/#/meeting`);
  await page.waitForTimeout(900);
  const meeting = await page.locator('#app').innerText();
  check(!meeting.includes('مكتب رام الله'), 'the meeting screen is not the fixture either');
  check(meeting.includes('لا لقاء مقترحاً'), 'it says there is no meeting');

  await page.close();
  fs.unlinkSync(path.join(ROOT, 'config.js'));
}

// ---------- 13. your own photos, enlarging them, and staying current ----------
{
  fs.writeFileSync(path.join(ROOT, 'config.js'),
    'export const SUPABASE_URL = "https://stub.supabase.co";\nexport const SUPABASE_ANON_KEY = "anon";\n');

  // 2x2 red PNG, so a blur is measurable rather than a matter of opinion.
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC',
    'base64');

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let approved = false;
  let profileReads = 0;

  await page.route('https://stub.supabase.co/**', async (route) => {
    const url = route.request().url();
    const json = (b, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('/auth/v1/signup')) {
      return json({ access_token: 't', refresh_token: 'r',
                    expires_at: Math.floor(Date.now() / 1000) + 3600,
                    user: { id: 'u-m', email: 'm@example.com' } });
    }
    if (url.includes('/rpc/whoami')) {
      return json({ user_id: 'u-m', email: 'm@example.com', is_admin: false,
                    has_credential: true, is_anonymous: false, has_row: true });
    }
    if (url.includes('/rpc/my_application')) return json({ status: 'admitted' });
    if (url.includes('/rpc/my_profile')) {
      profileReads += 1;
      return json({ user_id: 'u-m', status: 'admitted', display_name: 'حموده',
                    photos: [{ id: 'p1', storage_path: 'u-m/a.jpg', ordinal: 0,
                               is_primary: true, approved }] });
    }
    if (url.includes('/storage/v1/object/sign/')) {
      return json({ signedURL: '/object/sign/photos/u-m/a.jpg?token=abc' });
    }
    return json({}, 404);
  });
  await page.route('**/object/sign/photos/**', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  });

  await page.goto(`${base}/#/profile`);
  await page.waitForTimeout(1200);

  // Your own photo is not blurred.
  const filter = await page.evaluate(() => {
    const img = document.querySelector('.photo-cell img[data-signed]');
    return img ? getComputedStyle(img).filter : null;
  });
  check(filter === 'none',
        `your own photos are shown clearly, not blurred (filter: ${filter})`);

  // Tapping enlarges.
  check(await page.locator('.lightbox').count() === 0, 'no viewer is open to begin with');
  await page.locator('.photo-cell img[data-zoom]').first().click();
  await page.waitForTimeout(400);
  check(await page.locator('.lightbox').count() === 1, 'tapping a photo opens it full-screen');
  const big = await page.evaluate(() => {
    const img = document.querySelector('.lightbox img');
    return img ? { w: img.naturalWidth, src: img.src.slice(0, 5) } : null;
  });
  check(big?.w > 0, 'and the enlarged image is really there');
  check(big?.src === 'data:', 'reusing the image already loaded — no second request');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check(await page.locator('.lightbox').count() === 0, 'Escape closes it');

  await page.locator('.photo-cell img[data-zoom]').first().click();
  await page.waitForTimeout(300);
  await page.locator('.lightbox').click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(300);
  check(await page.locator('.lightbox').count() === 0, 'and so does tapping the backdrop');

  // A change made elsewhere reaches the screen without a reload.
  //
  // This exercises the visibility path, not the twenty-second timer —
  // waiting out a real interval would put twenty seconds into every run.
  // Both end in the same two lines (expire the current screen's keys,
  // render), so what is left untested is the timer firing, not what
  // happens when it does.
  const before = profileReads;
  approved = true;
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(1500);
  check(profileReads > before, 'returning to the tab re-reads, without a reload');
  check(!(await page.locator('#app').innerText()).includes('قيد المراجعة'),
        'so an approval made elsewhere appears');

  // The guard that matters most for the timer: it must not repaint while
  // someone is typing. Asserted on the condition rather than the clock.
  const wouldSkip = await page.evaluate(() => {
    const input = document.createElement('textarea');
    document.body.appendChild(input);
    input.focus();
    const skipped = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    input.remove();
    return skipped;
  });
  check(wouldSkip, 'and a refresh while typing is skipped by the same condition the timer uses');

  await page.close();
  fs.unlinkSync(path.join(ROOT, 'config.js'));
}

// ---------- 14. banned accounts and one sign-in at a time ----------
{
  fs.writeFileSync(path.join(ROOT, 'config.js'),
    'export const SUPABASE_URL = "https://stub.supabase.co";\nexport const SUPABASE_ANON_KEY = "anon";\n');

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let banned = false;
  let current = true;
  let others = [];
  const acted = [];

  await page.route('https://stub.supabase.co/**', async (route) => {
    const url = route.request().url();
    const json = (b, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });

    if (url.includes('/auth/v1/signup')) {
      return json({ access_token: 't', refresh_token: 'r',
                    expires_at: Math.floor(Date.now() / 1000) + 3600,
                    user: { id: 'u-m', email: 'm@example.com' } });
    }
    if (url.includes('/auth/v1/logout')) { acted.push('logout'); return json({}); }
    if (url.includes('/rpc/whoami')) {
      return json({ user_id: 'u-m', email: 'm@example.com', is_admin: false,
                    has_credential: true, is_anonymous: false, has_row: true, banned });
    }
    if (url.includes('/rpc/register_session')) {
      return json({ tracked: true, current, others,
                    ...(current ? {} : { reason: 'superseded' }) });
    }
    if (url.includes('/rpc/acknowledge_sessions')) { acted.push('ack'); return json({ acknowledged: true }); }
    if (url.includes('/rpc/sign_out_other_sessions')) { acted.push('secure'); return json({ ended: 2 }); }
    if (url.includes('/rpc/my_sessions')) {
      return json([{ session_id: 's1', user_agent: 'Mozilla/5.0 (iPhone) Safari/605',
                     started_at: new Date().toISOString(), is_this_one: true }]);
    }
    if (url.includes('/rpc/my_application')) return json({ status: 'admitted' });
    if (url.includes('/rpc/my_profile')) {
      return json({ user_id: 'u-m', status: 'admitted', display_name: 'حموده', photos: [] });
    }
    if (url.includes('/rpc/browse_members')) return json({ gated: false, status: 'admitted', rows: [] });
    return json({}, 404);
  });

  // ── someone else signed in ──
  others = [{ session_id: 's-other', user_agent: 'Mozilla/5.0 (Windows NT) Chrome/120',
              started_at: new Date().toISOString() }];
  await page.goto(`${base}/#/today`);
  await page.waitForTimeout(1200);

  check(await page.locator('#session-warning').count() === 1,
        'a sign-in from somewhere else raises a warning');
  const warn = await page.locator('#session-warning').innerText();
  check(warn.includes('من جهاز آخر'), 'saying what happened');

  await page.locator('[data-session-secure]').click();
  await page.waitForTimeout(900);
  check(acted.includes('secure'), '"that was not me" ends the other sessions');
  check(page.url().includes('password'),
        'and goes straight to changing the password — sessions ended first, then the password');

  // ── "it was me" just dismisses ──
  others = [{ session_id: 's-2', user_agent: 'x', started_at: new Date().toISOString() }];
  await page.goto(`${base}/#/today`);
  await page.waitForTimeout(1000);
  await page.locator('[data-session-ack]').click();
  await page.waitForTimeout(500);
  check(acted.includes('ack'), '"it was me" marks them seen');
  check(await page.locator('#session-warning').count() === 0, 'and the warning goes');

  // ── displaced by a newer sign-in ──
  // reload(), not goto(): navigating to the URL the page is already on
  // changes nothing and the bootstrap never runs again, so the new stub
  // state is never seen.
  others = [];
  current = false;
  await page.reload();
  await page.waitForTimeout(1400);
  check(acted.includes('logout'), 'a displaced session signs itself out');
  check(page.url().includes('login'), 'and is sent to sign in again');

  // ── a banned account sees one screen ──
  current = true;
  banned = true;
  await page.goto(`${base}/#/today`);
  await page.reload();
  await page.waitForTimeout(1200);
  const closed = await page.locator('#app').innerText();
  check(page.url().includes('closed'), 'a banned account is taken out of the app');
  check(closed.includes('هذا الحساب مغلق'), 'and told so plainly');
  check(!closed.includes('محظور') || !closed.includes('البريد'),
        'without naming which detail is blocked — that is the thing they would change');

  await page.close();
  fs.unlinkSync(path.join(ROOT, 'config.js'));
}

// ---------- 15. swiping, matching, and the contact release ----------
{
  fs.writeFileSync(path.join(ROOT, 'config.js'),
    'export const SUPABASE_URL = "https://stub.supabase.co";\nexport const SUPABASE_ANON_KEY = "anon";\n');

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  let cards = [
    { id: 'c-1', rank: 0, decision: 'pending', display_name: 'ليلى', age: 29,
      city: 'رام الله', bio: 'أدرس التمريض.', timeline: 'within_1_year',
      marital_status: 'never_married', practice_level: 'practicing',
      willing_to_relocate: true, family_aware: true, photo_count: 2 },
    { id: 'c-2', rank: 1, decision: 'pending', display_name: 'هدى', age: 27,
      city: 'نابلس', timeline: 'within_6_months', marital_status: 'never_married',
      practice_level: 'practicing', willing_to_relocate: false, family_aware: true,
      photo_count: 0 },
  ];
  let membership = 'basic';
  let release = { exists: false };
  const sent = [];

  await page.route('https://stub.supabase.co/**', async (route) => {
    const url = route.request().url();
    const body = route.request().postDataJSON() || {};
    const json = (b, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });

    if (url.includes('/auth/v1/signup')) {
      return json({ access_token: 't', refresh_token: 'r',
                    expires_at: Math.floor(Date.now() / 1000) + 3600,
                    user: { id: 'u-m', email: 'm@example.com' } });
    }
    if (url.includes('/rpc/whoami')) {
      return json({ user_id: 'u-m', email: 'm@example.com', is_admin: false,
                    has_credential: true, is_anonymous: false, has_row: true, banned: false });
    }
    if (url.includes('/rpc/register_session')) return json({ tracked: true, current: true, others: [] });
    if (url.includes('/rpc/my_application')) return json({ status: 'admitted' });
    if (url.includes('/rpc/my_benefits')) {
      const b = { basic: { daily_candidates: 5, can_search: false, can_see_interest: false, release_discount: 0 },
                  golden: { daily_candidates: 20, can_search: true, can_see_interest: true, release_discount: 100 } }[membership];
      return json({ membership, ...b });
    }
    if (url.includes('/rpc/all_memberships')) {
      return json([
        { membership: 'basic', daily_candidates: 5, can_search: false,
          can_see_interest: false, release_discount: 0, monthly_price: null, currency: 'ILS' },
        { membership: 'premium', daily_candidates: 10, can_search: true,
          can_see_interest: true, release_discount: 50, monthly_price: 40, currency: 'ILS' },
        { membership: 'golden', daily_candidates: 20, can_search: true,
          can_see_interest: true, release_discount: 100, monthly_price: 90, currency: 'ILS' }]);
    }
    if (url.includes('/rpc/my_slate')) {
      return json({ gated: false, membership, size: 5, cards });
    }
    if (url.includes('/rpc/swipe')) {
      sent.push({ id: body.candidate, interested: body.interested });
      const card = cards.find((c) => c.id === body.candidate);
      if (card) card.decision = body.interested ? 'interested' : 'declined';
      // The second card's interest is mutual.
      const matched = body.interested && body.candidate === 'c-2';
      return json({ matched, match_id: matched ? 'match-1' : null });
    }
    if (url.includes('/rpc/search_members')) {
      return json(membership === 'basic'
        ? { allowed: false, gated: false, rows: [] }
        : { allowed: true, gated: false,
            rows: [{ id: 'c-9', display_name: 'سلمى', age: 30, city: 'الخليل',
                     timeline: 'within_1_year', marital_status: 'never_married' }] });
    }
    if (url.includes('/rpc/my_admirers')) {
      return json(membership === 'basic'
        ? { allowed: false, count: 3, rows: [] }
        : { allowed: true, count: 1,
            rows: [{ id: 'c-7', display_name: 'ريم', age: 28, city: 'بيت لحم',
                     timeline: 'within_1_year' }] });
    }
    if (url.includes('/rpc/my_matches')) {
      return json([{ id: 'match-1', state: 'active', contact_unlocked: false,
                     display_name: 'هدى', city: 'نابلس', age: 27, unread: 0 }]);
    }
    if (url.includes('/rpc/match_thread')) {
      return json({ match_id: 'match-1', contact_unlocked: false, state: 'active', messages: [] });
    }
    if (url.includes('/rpc/my_release')) return json(release);
    if (url.includes('/rpc/press_bingo')) {
      release = { exists: true, state: 'pending_other', i_pressed: true,
                  both_pressed: false, currency: 'ILS' };
      return json({ state: 'pending_other', changed: true });
    }
    if (url.includes('/rpc/my_profile')) {
      return json({ user_id: 'u-m', status: 'admitted', display_name: 'حموده', photos: [] });
    }
    if (url.includes('/rpc/my_sessions')) return json([]);
    return json({}, 404);
  });

  // ── the deck ──
  await page.goto(`${base}/#/today`);
  await page.waitForTimeout(1200);
  check(errors.length === 0, `no page errors on the deck ${errors.join('; ')}`);
  const deck = await page.locator('#app').innerText();
  check(deck.includes('ليلى'), 'the first card is shown');
  check(!deck.includes('هدى'), 'one at a time, not a list');
  check(await page.locator('[data-swipe="yes"]').count() === 1, 'with a yes and a no');

  await page.locator('[data-swipe="no"]').click();
  await page.waitForTimeout(700);
  check(sent.some((x) => x.id === 'c-1' && x.interested === false), 'a left swipe is sent');
  check((await page.locator('#app').innerText()).includes('هدى'),
        'and the next card comes up');

  // ── the match ──
  await page.locator('[data-swipe="yes"]').click();
  await page.waitForTimeout(800);
  check(sent.some((x) => x.id === 'c-2' && x.interested === true), 'a right swipe is sent');
  check(await page.locator('.match-overlay').count() === 1,
        'mutual interest is shown, not toasted past');
  check((await page.locator('.match-overlay').innerText()).includes('اهتمام متبادل'),
        'saying what happened');

  // ── Bingo ──
  await page.locator('.match-overlay [data-open-match]').click();
  await page.waitForTimeout(900);
  const chat = await page.locator('#app').innerText();
  check(chat.includes('بِنغو'), 'the open thread offers Bingo');
  check(chat.includes('البيانات الشخصية محجوبة'),
        'and says personal details are blocked until both agree');

  const bingo = page.locator('[data-bingo]');
  await bingo.click();
  await page.waitForTimeout(250);
  check(!release.exists, 'one tap on Bingo does not send it');
  check((await bingo.innerText()).includes('تأكيد'), 'it asks for confirmation');
  await bingo.click();
  await page.waitForTimeout(800);
  check(release.exists && release.state === 'pending_other', 'the second tap sends it');
  const after = await page.locator('#app').innerText();
  check(after.includes('طلبت تبادل الأرقام'), 'and the thread says it is waiting');
  check(!after.includes('الطرف الآخر ضغط'),
        'without saying anything about whether the other side pressed');

  // ── the gates on a basic membership ──
  await page.goto(`${base}/#/search`);
  await page.waitForTimeout(900);
  const search = await page.locator('#app').innerText();
  check(search.includes('للعضويات المدفوعة'), 'search is gated for a basic member');
  check(await page.locator('[name="city"]').count() === 0,
        'and the form is not shown at all, rather than shown and refused');

  await page.goto(`${base}/#/admirers`);
  await page.waitForTimeout(900);
  const adm = await page.locator('#app').innerText();
  check(adm.includes('٣') || adm.includes('3'), 'a basic member is told how many are interested');
  check(!adm.includes('ريم'), 'but not who');

  // ── upgraded ──
  // Reload: the cached answers are a minute fresh, and an upgrade in real
  // life arrives with a new page load rather than inside one second.
  membership = 'golden';
  await page.goto(`${base}/#/membership`);
  await page.reload();
  await page.waitForTimeout(900);
  const tiers = await page.locator('#app').innerText();
  check(tiers.includes('الذهبية') && tiers.includes('المميّزة'), 'the tiers are listed');
  check(tiers.includes('تبادل الأرقام بلا رسوم'), 'with what each one unlocks');
  check(tiers.includes('لا تشتري قبولاً'),
        'and that membership does not buy admission');

  await page.goto(`${base}/#/admirers`);
  await page.reload();
  await page.waitForTimeout(1100);
  check((await page.locator('#app').innerText()).includes('ريم'),
        'a paying member sees who is interested');

  await page.goto(`${base}/#/search`);
  await page.reload();
  await page.waitForTimeout(1100);
  check(await page.locator('[name="city"]').count() === 1, 'and gets the search form');
  await page.locator('#search-run').click();
  await page.waitForTimeout(800);
  check((await page.locator('#app').innerText()).includes('سلمى'), 'which returns results');

  await page.close();
  fs.unlinkSync(path.join(ROOT, 'config.js'));
}

await browser.close();
server.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall smoke checks passed');
process.exit(fails.length ? 1 : 0);
