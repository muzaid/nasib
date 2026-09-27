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
    if (url.includes('/rpc/whoami'))  return json({ user_id: 'u-boss', is_admin: true, has_row: false });
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

  // Admit one, reject the other.
  await page.locator('[data-decide-user="admit"][data-id="u-laila"]').click();
  await page.waitForTimeout(400);
  check(decisions.some((d) => d.target === 'u-laila' && d.action === 'admit'),
        'admitting sends the decision to the server');

  await page.locator('[data-decide-user="reject"][data-id="u-omar"]').click();
  await page.waitForTimeout(400);
  check(decisions.some((d) => d.target === 'u-omar' && d.action === 'reject'), 'so does rejecting');
  check((await page.locator('#app').innerText()).includes('لا أحد هنا'),
        'the waiting queue empties as decisions are made');

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

await browser.close();
server.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall smoke checks passed');
process.exit(fails.length ? 1 : 0);
