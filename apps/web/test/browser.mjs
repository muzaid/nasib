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

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
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
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ user_id: 'u1', is_admin: false, has_row: !!stored,
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
    if (url.includes('/rpc/browse_members')) {
      const rows = Object.entries(people)
        .filter(([, p]) => p.status === 'admitted')
        .map(([id, p]) => ({ id, display_name: p.display_name, city: p.city, age: p.age,
                             bio: 'نبذة قصيرة.', timeline: 'within_1_year',
                             marital_status: 'never_married', practice_level: 'practicing',
                             willing_to_relocate: false, family_aware: true,
                             photo_count: 2, photos_unlocked: false }));
      return json({ gated: false, status: 'admitted', rows });
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
  check(todayText.includes('ليلى'), 'the directory shows the admitted member, not the fixture');
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
  check((counts.browse_members || 0) === 1,
        `browse_members fetched once too (was ${counts.browse_members || 0})`);

  // Going back and forth must not refetch what is already held.
  await page.locator('[data-tab="profile"]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-tab="today"]').click();
  await page.waitForTimeout(400);
  check((counts.my_profile || 0) === 1 && (counts.browse_members || 0) === 1,
        'and revisiting a screen reuses what was fetched');

  await page.close();
  fs.unlinkSync(path.join(ROOT, 'config.js'));
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

  await page.goto(`${base}/#/login`);
  await page.waitForTimeout(600);
  check(errors.length === 0, `no page errors on the login screen ${errors.join('; ')}`);
  check((await page.locator('#app').innerText()).includes('لماذا لا يوجد دخول للأعضاء'),
        'the login screen explains why members do not sign in');

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

await browser.close();
server.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall smoke checks passed');
process.exit(fails.length ? 1 : 0);
