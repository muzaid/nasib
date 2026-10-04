// نصيب — the mobile website.
//
// Same product as the Flutter app, same screens, same rules, no toolchain.
// Open it on a phone and it behaves like the app: Arabic throughout, right
// to left, photos veiled by default, the camera step real, the chat
// refusing to carry personal details.
//
// Two things are deliberately honest about what a browser can do:
//
//   * The camera step runs the real challenge and measures real
//     inter-frame variation (see capture.js), but it cannot compare a face
//     to an ID. That is server work in every version of this product.
//   * The backend is optional, and what it covers is narrow. With a
//     Supabase project configured (see data.js), the application you
//     submit is a real row and your status survives a reload. Everything
//     past admission — today's candidate, the photo requests, the thread —
//     is still fixtures, because those need a second real person and a
//     match between you, and a freshly deployed site has neither. The
//     screens say which of the two they are showing.

import { redact, KINDS } from './redact.js';
import { Capture, issueChallenge, stepLabel, arabicDigits } from './capture.js';
import { connect } from './data.js';

// --------------------------------------------------------------------- //
// Fixtures. They mirror supabase/seed/, so what you see here is what the
// database would serve.
// --------------------------------------------------------------------- //

const DEMO = {
  me: { name: 'أميرة', age: 27, city: 'رام الله' },
  candidates: [
    {
      id: 'yousef',
      name: 'يوسف', age: 32, city: 'عمّان', work: 'مهندس مدني',
      verified: true, photos: 3,
      bio: 'مهندس مدني في عمّان من خمس سنين، وأصل عيلتي من الخليل. عيلتي عارفة إني بدوّر، وبفكّر بالزواج خلال السنة الجاية. بحب التاريخ وبلعب كرة كل جمعة.',
      facts: ['يريد الزواج خلال سنة', 'أعزب', 'العائلة على علم', 'مستعد للانتقال'],
      agree: ['السكن بعد الزواج: بيت مستقل', 'الإنجاب: خلال سنتين'],
      differ: ['المدينة: هو في عمّان وأنتِ في رام الله'],
    },
    {
      id: 'samer',
      name: 'سامر', age: 34, city: 'نابلس', work: 'صيدلاني',
      verified: false, photos: 2,
      bio: 'صيدلاني في نابلس، ولي ابنة عمرها ست سنين تعيش معي. أبحث عن شريكة تقدّر هذا وتكون جزءاً من حياتنا.',
      facts: ['يريد الزواج خلال سنتين', 'مطلّق', 'لديه ابنة', 'العائلة على علم'],
      agree: ['المدينة: كلاكما في الضفة', 'العائلة على علم'],
      differ: ['لديه ابنة من زواج سابق', 'الإطار الزمني: خلال سنتين'],
    },
  ],
  requests: [
    { id: 'req-1', name: 'يوسف', age: 32, city: 'عمّان', verified: true,
      note: 'أهلاً، أنا وعيلتي من الخليل وحابب أتعرف عليكم.' },
  ],
  grants: [
    { id: 'g1', name: 'يوسف', days: 11, views: 3, shots: 0 },
    { id: 'g2', name: 'سامر', days: 6, views: 0, shots: 0 },
    { id: 'g3', name: 'خالد', days: 9, views: 2, shots: 1 },
  ],
  messages: [
    { from: 'them', body: 'أهلاً، تشرفت بملفك. عيلتي عارفة إني بدوّر، وإذا حابة نحكي بجدية أنا جاهز.' },
    { from: 'me', body: 'أهلاً وسهلاً. بابا هو الولي وهو مطّلع. بحب أعرف أكثر عن عيلتك.' },
    { from: 'them', body: 'أكيد. أبوي من الخليل وأمي من نابلس، وإخوتي ثلاثة. رقمي 0599123456 إذا بتحبي نكمل هناك.' },
  ],
  meeting: {
    office: 'مكتب رام الله',
    address: 'شارع الإرسال، عمارة الأمل، الطابق الثالث',
    when: 'الخميس 2 تشرين الأول · 5:00 مساءً',
    room: 'غرفة 1', staff: 'أم محمد', family: 'الطرفان يحضران مع أهلهما',
  },
};

// Mutable session state.
//
// `db` is the Supabase client, or null when the site is running without
// one — which is the normal state for the published demo and for anyone
// who opened index.html directly. `application` is the row this browser
// owns, once it has one.
const state = {
  admitted: false,
  candidate: 0,
  grants: [...DEMO.grants],
  requests: [...DEMO.requests],
  messages: DEMO.messages.map((m) => ({ ...m })),
  contactUnlocked: false,
  capture: null,
  db: null,
  application: null,
  saving: false,

  // Read from the server, null until then. `null` means "not fetched" and
  // an empty array means "fetched, nothing there" — the two need different
  // screens, and a single falsy check would show "nobody yet" while the
  // request was still in flight.
  profile: null,
  members: null,
  slate: null,
  benefits: null,
  admirers: null,
  searchFilters: {},
  searchRows: null,
  memberships: null,
  overview: null,      // the dashboard, in one read
  chats: null,         // the conversation list
  chat: null,          // the open thread
  openChat: null,
  chatFilter: 'flagged',
  queueView: 'stack',
  release: null,
  queue: null,
  queueFilter: 'waiting',
  photoQueue: null,
  photoFilter: 'pending',
  searchQ: '',
  searchResults: null,
  adminMeetings: null,
  slots: [],
  audit: null,
  reviewers: null,
  bannedEmails: null,
  myRequests: null,
  myGrants: null,
  matches: null,
  thread: null,
  openMatch: '',
  meetings: null,
  photoRequests: null,
  reports: null,
  releases: null,
  releaseFilter: 'pending',
  stats: null,
  member: null,
  memberId: '',
  gate: '',
  missingRoute: '',
  startupError: '',
  sessions: null,
  banned: false,
  loginMode: 'signin',
  isAdmin: false,
  userId: '',
  email: '',
};

// --------------------------------------------------------------------- //
// Tiny helpers
// --------------------------------------------------------------------- //

const app = document.getElementById('app');
const tabbar = document.getElementById('tabbar');
const toastEl = document.getElementById('toast');

const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

/* Values go back into `value="…"` attributes, and a name with a quote in
   it would otherwise end the attribute and start injecting markup. The
   five characters below are the whole job for an attribute context. */
const escapeAttr = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/* The `max` on the birth-date input. The database enforces 18+ and will
   refuse regardless; this only spares someone the round trip. */
function eighteenYearsAgo() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d.toISOString().slice(0, 10);
}

/**
 * The moment interest turns out to be mutual.
 *
 * Shown rather than toasted because it is the only thing in this product
 * that is unambiguously good news, and because the next step — a
 * conversation — should be one tap from it.
 */
function showMatch(matchId) {
  const overlay = h(`
    <div class="lightbox match-overlay" role="dialog" aria-modal="true">
      <div style="text-align:center;max-width:320px">
        ${star(54, 'var(--accent)')}
        <h2 style="color:#fff;margin:18px 0 6px;font-size:26px">اهتمام متبادل</h2>
        <p style="color:rgba(255,255,255,.82);font-size:15px;line-height:1.9;margin:0">
          كلاكما أبدى اهتمامه بالآخر. فُتحت المحادثة — وتبقى البيانات الشخصية
          محجوبة فيها حتى تتفقا على ذلك.
        </p>
        <button class="btn" style="margin-top:20px" data-open-match="${escapeAttr(matchId)}">
          ابدأ المحادثة
        </button>
        <button class="btn quiet" style="margin-top:8px;color:#fff" data-close-overlay>
          لاحقاً
        </button>
      </div>
    </div>`);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target.hasAttribute('data-close-overlay')) {
      overlay.remove();
      render('today');
    }
  });
  document.body.appendChild(overlay);
}

/**
 * Full-screen photo, closed by tapping anywhere or pressing Escape.
 *
 * Built and destroyed per use rather than left in the DOM: an element
 * holding a multi-megabyte data: URL is worth releasing, and a viewer
 * that is always present is a viewer that can be opened by a stray
 * click on a screen that has no photo on it.
 */
function openLightbox(src, alt = '') {
  const overlay = h(`
    <div class="lightbox" role="dialog" aria-modal="true" aria-label="${escapeAttr(alt || 'صورة')}">
      <img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}">
      <button class="lightbox-close" aria-label="إغلاق">✕</button>
    </div>`);

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event) => { if (event.key === 'Escape') close(); };

  overlay.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
}

/**
 * A user agent, as something a person can recognise.
 *
 * Deliberately coarse. The aim is "was that me?", which needs "an iPhone"
 * or "a Windows computer" — not a version string, and not a fingerprint
 * precise enough to be worth keeping.
 */
function deviceName(agent = '') {
  const ua = String(agent || '');
  const os = /iPhone|iPad/.test(ua) ? 'iPhone'
    : /Android/.test(ua) ? 'هاتف أندرويد'
    : /Mac OS X/.test(ua) ? 'جهاز Mac'
    : /Windows/.test(ua) ? 'جهاز Windows'
    : /Linux/.test(ua) ? 'جهاز Linux'
    : 'جهاز غير معروف';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari' : '';
  return browser ? `${os} · ${browser}` : os;
}

let toastTimer;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2600);
}

/* The eight-point star: two overlaid squares, which is how the motif is
   actually built in Levantine tile. Used three times in the whole app —
   any more and it is wallpaper. */
function star(size, colour = 'var(--teal)', opacity = 1) {
  const r = size / 2;
  const pts = [];
  for (let i = 0; i < 16; i++) {
    const rad = i % 2 === 0 ? r : r * 0.54;
    const a = (Math.PI / 8) * i - Math.PI / 2;
    pts.push(`${(r + Math.cos(a) * rad).toFixed(2)},${(r + Math.sin(a) * rad).toFixed(2)}`);
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"
    style="opacity:${opacity}"><polygon points="${pts.join(' ')}" fill="none" stroke="${colour}"
    stroke-width="${(size * 0.055).toFixed(2)}" stroke-linejoin="round"/></svg>`;
}

const ico = {
  back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  face: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/></svg>',
  check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  blur: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="1.6"><circle cx="12" cy="12" r="9" stroke-dasharray="2 3"/><circle cx="12" cy="12" r="3.5"/></svg>',
  room: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V5a1 1 0 0 1 .8-1l8-1.6A1 1 0 0 1 14 3.4V21M14 21h6V9h-6M4 21h16"/></svg>',
  family: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="2.6"/><circle cx="17" cy="9" r="2.1"/><path d="M3 19c0-2.8 2.2-5 5-5s5 2.2 5 5M15 19c0-2.2 1.3-4 3-4s3 1.8 3 4"/></svg>',
  eye: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.8"/></svg>',
  shield: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.4-2.9 8.3-7 10-4.1-1.7-7-5.6-7-10V6l7-3Z"/></svg>',
  send: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12 4 5l2.5 7L4 19l16-7Z"/></svg>',
  done: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--verified)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
  pending: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.6"><circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/></svg>',
  warn: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/></svg>',
  tabToday: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.3 2.9-6 6.5-6s6.5 2.7 6.5 6M17 5.5a3 3 0 0 1 0 5.6M18.5 20c0-2.3-.9-4.3-2.3-5.6"/></svg>',
  tabPhotos: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="12" cy="12" r="3.4" stroke-dasharray="2 2.5"/></svg>',
  tabChat: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5Z"/></svg>',
  tabMeet: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V5a1 1 0 0 1 .8-1l8-1.6A1 1 0 0 1 14 3.4V21M14 21h6V9h-6M4 21h16"/></svg>',
  tabProfile: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c0-3.6 3.4-6.2 7.5-6.2s7.5 2.6 7.5 6.2"/></svg>',
  desk: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h10M4 18h7"/><circle cx="18.5" cy="16.5" r="3"/><path d="M20.8 18.8 23 21"/></svg>',
  plus: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
};

const appbar = (title, { back = true, side = '' } = {}) => `
  <div class="appbar">
    ${back ? `<button class="iconbtn" data-back aria-label="رجوع">${ico.back}</button>` : '<span></span>'}
    <h2>${title}</h2>
    <span class="side">${side}</span>
  </div>`;

const ornament = () =>
  `<div class="ornament"><span class="bar"></span>${star(13)}<span class="bar"></span></div>`;

const veil = () => `<div class="veil">${star(34, 'var(--accent)', 0.42)}</div>`;

// --------------------------------------------------------------------- //
// Screens
// --------------------------------------------------------------------- //

const screens = {};

screens.welcome = () => `
  <div class="screen pad on aurora" style="padding-top:44px">
    <div class="brandmark">${star(26, '#fff')}</div>
    <h1 class="hero" style="margin-top:20px">نصيب</h1>
    <p style="text-align:center;margin:6px 0 0;font-size:18px;font-weight:600">
      <span class="grad-text">للزواج، لا لغيره.</span>
    </p>
    <p class="body" style="text-align:center;margin-top:16px;max-width:30ch;margin-inline:auto">
      كل من تقابله هنا مرّ بتحقق من هويته ومراجعة بشرية. التسجيل طلب انضمام، ولا نقبل الجميع.
    </p>

    <div class="panel tight" style="margin-top:22px">
      <div class="line-item">${ico.face}<span>صورة حيّة تثبت أن الشخص حقيقي</span></div>
      <div class="line-item">${ico.check}<span>مراجعة بشرية لكل ملف</span></div>
      <div class="line-item">${ico.blur}<span>صورك مموّهة دائماً، ولا تُكشف إلا بموافقتك</span></div>
      <div class="line-item">${ico.room}<span>اللقاء الأول في مكتبنا، بحضور موظّف</span></div>
      <div class="line-item">${ico.family}<span>وضع الوليّ، إن أردت</span></div>
    </div>

    <button class="btn" style="margin-top:22px" data-go="apply">ابدأ طلب الانضمام</button>
    <p class="note" style="text-align:center">يستغرق من 8 إلى 12 دقيقة</p>

    <div class="panel tinted accent" style="margin-top:22px">
      <p class="eyebrow">نسخة الويب</p>
      <p style="margin:0;font-size:14px;line-height:1.85">
        ${state.db
          ? 'طلب الانضمام يُحفظ فعلياً ويبقى إن أغلقت الصفحة. أمّا ما بعد القبول — '
            + 'المرشّح والصور والمحادثة — فبيانات ثابتة للعرض، لأنها تحتاج طرفاً ثانياً حقيقياً.'
          : 'هذه نسخة للتجربة على الهاتف: البيانات ثابتة ولا يوجد خادم.'}
        خطوة الكاميرا تعمل فعلياً، أمّا مطابقة الوجه مع الهوية فتتم على الخادم.
      </p>
      <button class="btn quiet" style="margin-top:6px" data-go="today">تخطَّ إلى داخل التطبيق</button>
    </div>
  </div>`;

// The chip groups carry the value the database wants in `data-value`, so
// the enum lives next to the label it belongs to. A label rewritten in the
// markup without touching the value keeps saving the same thing, which is
// the failure a translator would otherwise introduce silently.
const chipGroup = (name, options, chosen) => `
  <div class="chips" data-group data-field="${name}">
    ${options.map(([value, label]) => `
      <button class="chip" type="button" data-value="${value}"
              aria-pressed="${value === chosen}">${label}</button>`).join('')}
  </div>`;

screens.apply = () => {
  const saved = state.application || {};
  return `
  <div class="screen desk-shell">
    ${deskTop('طلب الانضمام')}
    <div class="progress"><i style="width:43%"></i></div>
    <div class="pad" id="apply-form">
      <h3 class="hd">عن نفسك</h3>
      <p class="sub">${state.db
        ? 'هذه الحقول تُحفظ فعلياً، ويمكنك العودة إليها لاحقاً.'
        : 'نسخة تجريبية بلا خادم — لن يُحفظ ما تكتبه.'}</p>


      <label class="field">
        <span>الاسم كما تحبّ أن يظهر</span>
        <input type="text" name="display_name" autocomplete="name"
               value="${escapeAttr(saved.display_name || '')}" placeholder="سارة">
      </label>

      <p class="eyebrow">أنت</p>
      ${chipGroup('gender', [['female', 'أنثى'], ['male', 'ذكر']], saved.gender || 'female')}

      <div class="spacer"></div>
      <label class="field">
        <span>تاريخ الميلاد</span>
        <input type="date" name="date_of_birth" value="${escapeAttr(saved.date_of_birth || '')}"
               max="${eighteenYearsAgo()}">
      </label>

      <label class="field">
        <span>المدينة</span>
        <input type="text" name="city" autocomplete="address-level2"
               value="${escapeAttr(saved.city || '')}" placeholder="رام الله">
      </label>

      <label class="field">
        <span>رقم الهاتف <small class="muted">(اختياري الآن، ويُتحقق منه لاحقاً)</small></span>
        <input type="tel" name="phone" inputmode="tel" dir="ltr"
               value="${escapeAttr(saved.phone || '')}" placeholder="+970 59 000 0000">
      </label>

      <p class="eyebrow">الحالة الاجتماعية</p>
      ${chipGroup('marital_status', [
        ['never_married', 'لم يسبق لي الزواج'],
        ['divorced', 'مطلّق/ة'],
        ['widowed', 'أرمل/ة'],
      ], saved.marital_status || 'never_married')}

      <div class="spacer"></div>
      <p class="eyebrow">الالتزام الديني</p>
      ${chipGroup('practice_level', [
        ['practicing', 'ملتزم/ة'],
        ['moderately_practicing', 'ملتزم/ة إلى حدٍّ ما'],
        ['cultural', 'بحكم النشأة'],
        ['prefer_not_to_say', 'أفضّل عدم الإجابة'],
      ], saved.practice_level || 'practicing')}

      <div class="spacer"></div>
      <h3 class="hd" style="margin-top:6px">جاهزيتك للزواج</h3>
      <p class="eyebrow">متى تودّ الزواج</p>
      ${chipGroup('timeline', [
        ['within_6_months', 'خلال 6 شهور'],
        ['within_1_year', 'خلال سنة'],
        ['within_2_years', 'خلال سنتين'],
        ['when_right_person', 'عند الشخص المناسب'],
      ], saved.timeline || 'within_1_year')}

      <div class="spacer"></div>
      <p class="eyebrow">أين تودّ السكن بعد الزواج</p>
      ${chipGroup('living_after_marriage', [
        ['independent', 'بيت مستقل'],
        ['with_family', 'مع العائلة'],
        ['undecided', 'لم أقرر'],
      ], saved.living_after_marriage || 'independent')}

      <div class="spacer"></div>
      <p class="eyebrow">هل عائلتك على علم</p>
      ${chipGroup('family_aware', [['true', 'نعم'], ['false', 'ليس بعد']],
        saved.family_aware === false ? 'false' : 'true')}

      <div class="spacer"></div>
      <p class="eyebrow">هل تقبل الانتقال لمدينة أخرى</p>
      ${chipGroup('willing_to_relocate', [['true', 'نعم'], ['false', 'لا']],
        saved.willing_to_relocate ? 'true' : 'false')}

      <div class="panel tinted accent" style="margin-top:22px">
        <p style="margin:0;font-size:14px;line-height:1.8">
          هذه الحقول هي ما يسأل عنه الأهل أولاً، ونطابق عليها مطابقة صارمة —
          لا نعرض عليك من لا يتّفق معك فيها.
        </p>
      </div>

      <div id="apply-error"></div>
      <button class="btn" style="margin-top:20px" id="apply-submit">
        ${state.db ? 'حفظ ومتابعة إلى التحقق بالكاميرا' : 'متابعة إلى التحقق بالكاميرا'}
      </button>
    </div>
  </div>`;
};

screens.camera = () => `
  <div class="screen">
    ${appbar('التحقق بالكاميرا', { side: '٩٠ ثانية' })}
    <div class="pad" id="camera-body">
      <div class="center">
        <div class="ring" id="ring">
          <svg class="ring-idle" width="64" height="64" viewBox="0 0 24 24" fill="none"
               stroke="var(--muted)" stroke-width="1.2" stroke-linecap="round" aria-hidden="true">
            <path d="M5 9V6.5A1.5 1.5 0 0 1 6.5 5H9M15 5h2.5A1.5 1.5 0 0 1 19 6.5V9M19 15v2.5a1.5 1.5 0 0 1-1.5 1.5H15M9 19H6.5A1.5 1.5 0 0 1 5 17.5V15"/>
            <circle cx="12" cy="11.4" r="4.4"/>
            <path d="M8.4 17c.9-1.1 2.1-1.7 3.6-1.7s2.7.6 3.6 1.7"/>
          </svg>
          <video id="cam" playsinline muted autoplay></video>
          <canvas id="cam-canvas"></canvas>
          <svg class="ring-track" id="ring-track" viewBox="0 0 100 100" aria-hidden="true">
            <circle class="bg" cx="50" cy="50" r="47"/>
            <circle class="fg" cx="50" cy="50" r="47"
                    stroke-dasharray="295.3" stroke-dashoffset="295.3"/>
          </svg>
        </div>
      </div>

      <h3 class="hd" style="text-align:center;margin-top:26px">انظر إلى الكاميرا، ونطلب منك حركات بسيطة</h3>
      <p class="body" style="text-align:center;font-size:15px;color:var(--ink-soft)">
        نطابق وجهك مع صورك ومع هويتك. الترتيب يختلف في كل مرة، ولهذا لا ينفع مقطع مصوّر مسبقاً.
      </p>

      <div class="panel tight">
        <div class="line-item">${ico.face}<span>اختر مكاناً فيه إضاءة جيدة</span></div>
        <div class="line-item">${ico.check}<span>كن وحدك في الصورة</span></div>
        <div class="line-item">${ico.blur}<span>هذه اللقطات لا تُعرض على أحد، وتُحذف بعد ثلاثين يوماً</span></div>
      </div>

      <button class="btn" style="margin-top:20px" id="camera-start">ابدأ</button>
      <p class="note" style="text-align:center">أقل من دقيقة</p>
    </div>
  </div>`;

// What each account status looks like to the person who holds it. A
// rejection is never given a reason: the reason is the review's method,
// and publishing it is publishing the way around it.
const STATUS_TEXT = {
  applying:       ['طلبك قيد الاستكمال', 'أكمل ما تبقّى ليصل طلبك إلى المراجعة.'],
  pending_review: ['طلبك قيد المراجعة', 'شخص من فريقنا يراجع طلبك الآن. عادةً بضع ساعات، ولا تتجاوز 12 ساعة.'],
  admitted:       ['تم قبولك', 'أهلاً بك. يمكنك الدخول إلى التطبيق الآن.'],
  rejected:       ['لم نتمكّن من قبول طلبك', 'شكراً لوقتك. لا نشارك تفاصيل المراجعة.'],
  paused:         ['حسابك موقوف مؤقتاً', 'يمكنك إعادة تفعيله متى شئت.'],
};

screens.review = () => {
  const status = state.application?.status || 'pending_review';
  const [title, note] = STATUS_TEXT[status] || STATUS_TEXT.pending_review;
  const name = state.application?.display_name;

  return `
  <div class="screen pad" style="padding-top:40px">
    <div class="center">${star(28)}</div>
    <h3 class="hd" style="text-align:center;margin-top:18px">${escapeAttr(title)}</h3>
    <p class="body" style="text-align:center;font-size:15px;color:var(--ink-soft)">
      ${escapeAttr(note)}
    </p>

    ${name && state.db ? `
      <div class="panel tinted" style="margin-top:16px;text-align:center">
        <p style="margin:0;font-size:14.5px">
          طلب باسم <b>${escapeAttr(name)}</b> — محفوظ، ويبقى إن أغلقت الصفحة.
        </p>
        <button class="btn quiet" style="margin-top:8px" data-go="apply">تعديل الطلب</button>
      </div>` : ''}

    <div class="panel tight" style="margin-top:20px">
      <div class="line-item">${ico.done}<span>تم استلام طلبك</span></div>
      <div class="line-item">${ico.done}<span>تم التحقق من الصورة الحيّة</span></div>
      <div class="line-item">${status === 'admitted' ? ico.done : ico.pending}<span
        class="${status === 'admitted' ? '' : 'muted'}">مراجعة بشرية</span></div>
    </div>

    <div class="panel accent-alt" style="margin-top:14px">
      <p class="eyebrow">لماذا هذه المراجعة؟</p>
      <p style="margin:0;font-size:14.5px;line-height:1.85">
        لأن كل ملف هنا يمرّ بالمراجعة نفسها. هذا هو السبب الذي يجعل من تقابله حقيقياً.
      </p>
    </div>

    <button class="btn" style="margin-top:22px" data-go="today">تخطَّ الانتظار (للتجربة)</button>
  </div>`;
};

/**
 * Turn a row from browse_members into the shape the card below expects.
 *
 * The fixture rows carry prose the database does not store — "you both
 * want children", "he prays, you sometimes do" — because a real one of
 * those is a comparison against the viewer's own answers, which is the
 * matching service's job and not something a directory row can carry.
 * So a real member's card shows what the database actually knows and
 * leaves the comparison out rather than inventing it.
 */
const asCandidate = (row) => ({
  id: row.id,
  name: row.display_name || 'بلا اسم',
  age: row.age || '',
  city: row.city || '—',
  work: row.occupation || '',
  // Deliberately left undefined rather than false. The directory returns
  // no verification result — 0010 does not select one — and both `true`
  // and `false` would be a statement about this person that nothing here
  // supports. The card shows no badge at all for a real member.
  verified: undefined,
  photos: Math.min(row.photo_count || 0, 4),
  bio: row.bio || 'لم يكتب نبذة بعد.',
  facts: [
    word('timeline', row.timeline),
    word('marital_status', row.marital_status),
    word('practice_level', row.practice_level),
    row.willing_to_relocate ? 'مستعد للانتقال' : 'يفضّل مدينته',
    row.family_aware ? 'عائلته على علم' : '',
  ].filter(Boolean),
  agree: [],
  differ: [],
});

async function loadMembers() {
  if (!state.db) return;
  try {
    const result = await state.db.browse();
    state.gate = result.gated ? result.status : '';
    state.members = (result.rows || []).map(asCandidate);
  } catch (error) {
    console.warn('[nasib] could not read the directory:', error.message);
    state.members = [];
  }
}

/**
 * The deck.
 *
 * Cards you swipe, but a handful a day rather than an endless stack —
 * which is the whole argument of this product, and the reason the
 * membership buys more of them rather than removing the limit.
 *
 * Interest stays one-directional: swiping right tells nobody. A person
 * who was passed over is never told, and a person who was chosen is told
 * only if they chose back.
 */
screens.today = () => {
  const live = !!state.db;

  if (live && state.slate === null) {
    return `<div class="screen">${appbar('اليوم', { back: false })}
      <div class="pad"><div class="panel"><p class="muted" style="margin:0">جارٍ التحميل…</p></div></div></div>`;
  }

  if (live && state.slate?.gated) {
    return `
    <div class="screen">
      ${appbar('اليوم', { back: false })}
      <div class="pad center" style="min-height:60vh;text-align:center">
        <div>
          ${star(30)}
          <h3 class="hd" style="margin-top:18px">لم يُفتح هذا القسم بعد</h3>
          <p class="body" style="color:var(--ink-soft)">
            ${state.slate.status === 'none'
              ? 'لم تُرسل طلب انضمام بعد.'
              : `حالة طلبك: ${word('status', state.slate.status)}.`}
            نعرض عليك أشخاصاً بعد قبول طلبك، لأن الطرف الآخر مرّ بالمراجعة نفسها.
          </p>
          <button class="btn quiet" style="margin-top:10px" data-go="${
            state.slate.status === 'none' ? 'apply' : 'profile'}">
            ${state.slate.status === 'none' ? 'ابدأ طلب الانضمام' : 'ملفي'}
          </button>
        </div>
      </div>
    </div>`;
  }

  const cards = live
    ? (state.slate?.cards || []).filter((c) => c.decision === 'pending')
    : DEMO.candidates.slice(state.candidate).map((c) => ({ ...c, demo: true }));

  const c = cards[0];

  if (!c) {
    const size = state.slate?.size;
    return `
    <div class="screen">
      ${appbar('اليوم', { back: false })}
      <div class="pad center" style="min-height:60vh;text-align:center">
        <div>
          ${star(30)}
          <h3 class="hd" style="margin-top:18px">انتهت مرشّحات اليوم</h3>
          <p class="body" style="color:var(--ink-soft)">
            ${live && (state.slate?.cards || []).length === 0
              ? 'لا أحد اليوم. نعرض فقط من يتّفق معك في ما لا تتنازل عنه.'
              : `نعرض ${size ? arabicDigits(String(size)) : 'عدداً قليلاً من'} الأشخاص يومياً.`
                + ' عدد قليل يُقرأ، وعدد كبير يُمرَّر.'}
          </p>
          ${live && state.benefits && state.benefits.membership !== 'golden' ? `
            <button class="btn" style="margin-top:16px" data-go="membership">
              المزيد يومياً مع العضوية
            </button>` : ''}
        </div>
      </div>
    </div>`;
  }

  const name = c.display_name || c.name;
  const facts = c.demo ? c.facts : [
    word('timeline', c.timeline),
    word('marital_status', c.marital_status),
    word('practice_level', c.practice_level),
    c.willing_to_relocate ? 'مستعد للانتقال' : 'يفضّل مدينته',
    c.family_aware ? 'عائلته على علم' : '',
    c.height_cm ? `${c.height_cm} سم` : '',
  ].filter(Boolean);

  return `
  <div class="screen">
    ${appbar('اليوم', { back: false, side: `${cards.length} متبقّون` })}
    <div class="pad">
      <div class="deck" id="deck">
        <article class="card" id="card" data-id="${escapeAttr(c.id)}">
          <div class="card-photos">
            ${Array.from({ length: Math.max(1, Math.min(c.photos ?? c.photo_count ?? 1, 4)) },
              () => veil()).join('')}
            ${(c.photo_count ?? c.photos) ? '' : `
              <div class="card-nophoto">${star(26, 'var(--muted)', .5)}
                <span class="tiny muted">لا صور بعد</span></div>`}
          </div>

          <div class="card-body">
            <h3 class="hd" style="margin:0">${escapeAttr(name)}${c.age ? `، ${c.age}` : ''}</h3>
            <p class="sub" style="margin:2px 0 0">
              ${escapeAttr(c.city || '—')}${c.work || c.occupation
                ? ` · ${escapeAttr(c.work || c.occupation)}` : ''}
            </p>

            <div class="facts" style="margin-top:12px">
              ${facts.map((f) => `<span class="fact">${escapeAttr(f)}</span>`).join('')}
            </div>

            ${c.bio ? `
              <p style="margin:14px 0 0;font-size:15px;line-height:1.95">${escapeAttr(c.bio)}</p>` : ''}

            <button class="btn ghost" style="margin-top:14px" data-request="${escapeAttr(c.id)}">
              <span style="display:inline-flex;gap:8px;align-items:center;justify-content:center">
                ${ico.eye} طلب رؤية الصور
              </span>
            </button>
            <p class="note" style="margin-top:6px">
              كل الصور مموّهة. لا يوجد إعداد يجعل صورتك مكشوفة للجميع.
            </p>
          </div>
        </article>
      </div>

      <div class="swipe-row">
        <button class="swipe-btn no" data-swipe="no" data-id="${escapeAttr(c.id)}"
                aria-label="لا، شكراً">✕</button>
        <button class="swipe-btn yes" data-swipe="yes" data-id="${escapeAttr(c.id)}"
                aria-label="مهتم">${star(22, '#fff')}</button>
      </div>
      <p class="note" style="text-align:center">
        اهتمامك لا يُبلَّغ لأحد. إن بادله الطرف الآخر، تُفتح المحادثة لكما معاً.
      </p>
    </div>
  </div>`;
};

async function loadSlate() {
  try {
    const [slate, benefits] = await Promise.all([
      state.db.mySlate(), state.db.myBenefits().catch(() => null),
    ]);
    state.slate = slate;
    state.benefits = benefits;
    state.gate = slate?.gated ? (slate.status || 'none') : '';
  } catch (error) {
    state.slate = { cards: [] };
    console.warn('[nasib] slate:', error.message);
  }
}

screens.photos = () => {
  const live = !!state.db;
  const requests = live ? (state.myRequests || []) : state.requests;
  const grants = live ? (state.myGrants || []) : state.grants;
  const loading = live && (state.myRequests === null || state.myGrants === null);

  return `
  <div class="screen">
    ${appbar('صوري', { back: false })}
    <div class="pad">
      ${loading ? `<div class="panel"><p class="muted" style="margin:0">جارٍ التحميل…</p></div>` : `
      <p class="eyebrow">طلبات رؤية صورك</p>
      ${requests.length === 0
        ? `<div class="panel"><p class="muted" style="margin:0">لا توجد طلبات الآن.</p></div>`
        : requests.map((r) => `
          <div class="panel">
            <div style="display:flex;align-items:flex-start;gap:12px">
              <div style="flex:1;min-width:0">
                <div style="font-size:16.5px;font-weight:600">${
                  escapeAttr(r.display_name || r.name || '—')}${r.age ? `، ${r.age}` : ''}</div>
                <div class="tiny muted" style="margin-top:2px">${
                  escapeAttr(r.city || '—')} · يطلب رؤية صورك</div>
              </div>
              ${r.verified ? `<span class="badge id">${star(12, 'var(--accent)')} عضو مقبول</span>` : ''}
            </div>
            ${r.note ? `
              <div class="panel flat" style="background:var(--page);margin-top:12px;padding:12px 14px">
                <p style="margin:0;font-size:14.5px;line-height:1.85">${escapeAttr(r.note)}</p>
              </div>` : ''}
            <hr class="rule">
            <div style="display:flex;gap:10px;align-items:flex-start">
              ${ico.shield}
              <p class="tiny muted" style="margin:0;line-height:1.75">راجعت الإدارة هذا الطلب قبل أن يصلك.</p>
            </div>
            <div class="btn-row" style="margin-top:14px">
              <button class="btn ghost" data-decide-photo="no" data-id="${escapeAttr(r.id)}">لا أسمح</button>
              <button class="btn wide" data-decide-photo="yes" data-id="${escapeAttr(r.id)}">أسمح برؤية صوري</button>
            </div>
            <p class="note">قرارك لا يُبلَّغ له بأي تفصيل. لا داعي لتبرير الرفض.</p>
          </div>`).join('')}

      <div class="spacer"></div>
      <p class="eyebrow">من يرى صوري</p>
      <div class="panel tight">
        ${grants.length === 0
          ? '<p class="muted tiny" style="margin:0">لا أحد يرى صورك الآن.</p>'
          : grants.map((g) => `
            <div class="line-item" style="align-items:center">
              <div style="flex:1;min-width:0">
                <div style="font-size:15.5px;font-weight:600">${
                  escapeAttr(g.display_name || g.name || '—')}</div>
                <div class="tiny muted">
                  ${(g.view_count ?? g.views)
                    ? `شاهدها ${g.view_count ?? g.views} مرة` : 'لم يشاهدها بعد'}
                  · يتبقى ${g.days_left ?? g.days} يوماً
                </div>
              </div>
              <button class="btn quiet" style="width:auto;color:var(--danger)"
                      data-revoke="${escapeAttr(g.id)}">سحب الإذن</button>
            </div>`).join('')}
      </div>

      ${grants.some((g) => (g.screenshots ?? g.shots) > 0) ? `
        <div class="panel" style="margin-top:12px;border-inline-start:3px solid var(--danger)">
          <div style="display:flex;gap:10px;align-items:flex-start">
            ${ico.warn}
            <div>
              <div style="font-weight:600;font-size:15.5px;color:var(--danger)">
                رُصدت محاولة لقطة شاشة لصورك
              </div>
              <p style="margin:8px 0 0;font-size:14px;line-height:1.8">
                أُبلغ صاحب المحاولة بأننا رصدناها وبأن صورك تحمل علامة تعريف باسمه.
                عند المحاولة الثانية يُسحب إذنه تلقائياً دون انتظار قرارك.
              </p>
            </div>
          </div>
        </div>` : ''}`}

      <div class="spacer"></div>
      <div class="panel tinted">
        <p class="eyebrow">في المتصفح</p>
        <p style="margin:0;font-size:14px;line-height:1.85">
          منع لقطات الشاشة خاصية نظام تشغيل، ولا يملكها المتصفح. في تطبيق
          الهاتف تُمنع اللقطة نفسها؛ هنا نرصد ما نستطيع رصده فقط.
        </p>
      </div>
    </div>
  </div>`;
};

/**
 * The state of this conversation's contact release, at the top of it.
 *
 * Every stage is shown to both sides except one: before both have
 * pressed, the person who pressed sees only their own press. Telling
 * someone that the other is waiting on them is pressure, and it leaks
 * interest the product keeps private until it is mutual.
 */
function releaseBanner() {
  const r = state.release;
  if (!r || !r.exists) {
    return `
      <div class="panel tinted accent" style="margin-bottom:14px">
        <div style="display:flex;gap:10px;align-items:flex-start">
          ${ico.shield}
          <div style="flex:1;min-width:0">
            <p style="margin:0;font-size:14px;line-height:1.85">
              البيانات الشخصية محجوبة في هذه المحادثة. إذا اطمأن كلاكما، اضغطا
              «بِنغو» معاً لطلب تبادل الأرقام.
            </p>
            <button class="btn" style="margin-top:10px" data-bingo>بِنغو</button>
          </div>
        </div>
      </div>`;
  }

  if (r.state === 'released') {
    return `
      <div class="panel accent-alt" style="margin-bottom:14px">
        <p class="eyebrow">تبادلتما الأرقام</p>
        <p style="margin:0 0 8px;font-size:14px;line-height:1.85">
          من الآن أنتما على تواصل مباشر، وما يجري خارج التطبيق خارج حمايته.
        </p>
        <div class="code-line" dir="ltr">${escapeAttr(r.other_phone || '')}</div>
      </div>`;
  }

  const stages = {
    pending_other: ['طلبت تبادل الأرقام',
      'سنكمل حين يطلب الطرف الآخر ذلك أيضاً. لا نخبره بأنك طلبت.'],
    pending_admin: ['طلبتما تبادل الأرقام',
      'الطلب عند الإدارة للمراجعة قبل أي دفع.'],
    declined_by_admin: ['لم تُقبل عملية التبادل',
      'راسل الدعم إن كنت ترى أن هذا خطأ.'],
    expired: ['انتهت المهلة',
      'لم يكتمل الدفع من الطرفين في الوقت المحدد.'],
    cancelled: ['أُلغي الطلب', ''],
  };

  if (r.state === 'awaiting_payment') {
    const by = r.pay_by ? new Date(r.pay_by).toLocaleString('ar', {
      weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit',
    }) : '';
    return `
      <div class="panel" style="margin-bottom:14px;border-inline-start:3px solid var(--accent)">
        <p class="eyebrow">بانتظار الدفع</p>
        <p style="margin:0 0 10px;font-size:14px;line-height:1.85">
          ${r.i_paid
            ? 'دفعتَ حصتك. ننتظر الطرف الآخر.'
            : `حصتك: <b>${r.my_amount} ${escapeAttr(r.currency || '')}</b>.`}
          ${by ? `<br>المهلة حتى ${escapeAttr(by)}.` : ''}
        </p>
        <p class="tiny muted" style="margin:0;line-height:1.85">
          لا تُكشف الأرقام إلا بعد دفع الطرفين. إن لم يدفع أحدكما خلال المهلة،
          يُعاد المبلغ المدفوع.
        </p>
        ${r.i_paid ? '' : `
          <button class="btn" style="margin-top:10px" data-go="pay">كيف أدفع</button>`}
      </div>`;
  }

  const [title, note] = stages[r.state] || ['', ''];
  return `
    <div class="panel tinted" style="margin-bottom:14px">
      <p class="eyebrow">${escapeAttr(title)}</p>
      ${note ? `<p style="margin:0;font-size:14px;line-height:1.85">${escapeAttr(note)}</p>` : ''}
      ${r.refund_due && !r.refunded_at
        ? '<p class="tiny" style="margin:8px 0 0;color:var(--caution)">مبلغك مستحق الإرجاع.</p>' : ''}
      ${['pending_other', 'pending_admin'].includes(r.state)
        ? '<button class="btn quiet" style="margin-top:8px" data-cancel-release>إلغاء الطلب</button>' : ''}
    </div>`;
}

// How to pay. Deliberately plain: there is no card form here, because
// there is no payment provider — a transfer, then a person confirms it.
screens.pay = () => {
  const r = state.release;
  return `
  <div class="screen">
    ${appbar('الدفع')}
    <div class="pad">
      <div class="panel">
        <p class="eyebrow">المبلغ</p>
        <div style="font-size:30px;font-weight:700">
          ${r?.my_amount ?? '—'} <span style="font-size:16px">${escapeAttr(r?.currency || '')}</span>
        </div>
        <p class="tiny muted" style="margin-top:8px;line-height:1.85">
          يُدفع لمرة واحدة عن هذا التبادل. إن لم يدفع الطرف الآخر خلال المهلة،
          يُعاد إليك المبلغ كاملاً.
        </p>
      </div>

      <div class="panel tinted accent">
        <p class="eyebrow">كيف</p>
        <p style="margin:0;font-size:14.5px;line-height:1.9">
          حوّل المبلغ بالطريقة المتفق عليها مع الإدارة، واكتب في خانة الملاحظات
          اسمك كما يظهر في التطبيق. تُراجع الإدارة التحويل وتسجّله، ثم تُكشف
          الأرقام فور دفع الطرفين.
        </p>
      </div>

      <div class="panel tinted">
        <p class="eyebrow">لماذا بمقابل</p>
        <p style="margin:0;font-size:14px;line-height:1.85">
          تبادل الأرقام يعني خروجكما من حماية التطبيق: لا فلترة للرسائل، ولا
          مكتب، ولا إمكانية سحب إذن. الرسم يجعل الخطوة قراراً، لا ضغطة.
        </p>
      </div>

      <button class="btn ghost" style="margin-top:18px" data-go="chat">رجوع إلى المحادثة</button>
    </div>
  </div>`;
};

// The chat screen is a list of conversations until one is open, because
// a member with two matches and no way to choose between them is a
// screen that only ever worked with one fixture in it.
screens.chat = () => {
  const live = !!state.db;

  if (live && state.matches === null) {
    return `<div class="screen">${appbar('المحادثة', { back: false })}
      <div class="pad"><div class="panel"><p class="muted" style="margin:0">جارٍ التحميل…</p></div></div></div>`;
  }

  if (live && !state.openMatch) {
    const matches = state.matches || [];
    return `
    <div class="screen">
      ${appbar('المحادثة', { back: false })}
      <div class="pad">
        ${matches.length === 0 ? `
          <div class="panel">
            <p style="margin:0;font-size:15px;line-height:1.9">
              لا محادثات بعد. تبدأ المحادثة حين يُبدي الطرفان اهتماماً متبادلاً —
              ولا يعلم أحدكما باهتمام الآخر قبل ذلك.
            </p>
          </div>`
        : matches.map((m) => `
          <button class="panel" style="width:100%;text-align:inherit;border:1px solid var(--line);cursor:pointer"
                  data-open-match="${escapeAttr(m.id)}">
            <div style="display:flex;align-items:center;gap:12px">
              <div style="flex:1;min-width:0">
                <div style="font-size:16.5px;font-weight:600">
                  ${escapeAttr(m.display_name || '—')}${m.age ? `، ${m.age}` : ''}
                </div>
                <div class="tiny muted" style="margin-top:2px">
                  ${escapeAttr(m.city || '—')}
                  ${m.contact_unlocked ? ' · فُتح تبادل التواصل' : ' · قبل المكالمة المرئية'}
                </div>
              </div>
              ${m.unread ? `<span class="badge id">${m.unread}</span>` : ''}
            </div>
          </button>`).join('')}
      </div>
    </div>`;
  }

  const name = live
    ? (state.matches || []).find((m) => m.id === state.openMatch)?.display_name || '—'
    : 'يوسف';

  return `
  <div class="screen">
    <div class="appbar">
      <button class="iconbtn" data-back aria-label="رجوع">${ico.back}</button>
      <div style="text-align:center">
        <h2 style="margin:0">${escapeAttr(name)}</h2>
        <div class="tiny muted" style="margin-top:1px">الوليّ يطّلع على المحادثة</div>
      </div>
      <span class="iconbtn" aria-hidden="true">${ico.shield}</span>
    </div>

    <div class="pad">
      ${live ? releaseBanner() : `
        <div class="banner info" style="margin-bottom:14px">
          ${ico.room}
          <span>مكالمة مرئية داخل التطبيق قبل تبادل أي وسيلة تواصل.</span>
        </div>`}
      <div class="thread" id="thread"></div>
    </div>

    <div id="composer-warning"></div>
    <div class="composer">
      <textarea id="draft" rows="1" placeholder="اكتب رسالة" aria-label="نص الرسالة"></textarea>
      <button class="send" id="send" aria-label="إرسال">${ico.send}</button>
    </div>
    <p class="note pad" style="text-align:center">
      الرسالة تُفحص قبل الإرسال، وتُفحص مرة أخرى على الخادم.
    </p>
  </div>`;
};

screens.meeting = () => {
  const live = !!state.db;

  if (live && state.meetings === null) {
    return `<div class="screen">${appbar('لقاء في المكتب', { back: false })}
      <div class="pad"><div class="panel"><p class="muted" style="margin:0">جارٍ التحميل…</p></div></div></div>`;
  }

  // The live shape, from my_meetings. Falls back to the fixture so the
  // screen still demonstrates itself with no backend.
  const m = live
    ? (state.meetings || []).find((x) =>
        ['scheduled', 'pending_scheduling', 'proposed'].includes(x.state))
    : {
        state: 'scheduled', with_name: 'يوسف', office: DEMO.meeting.office,
        address: DEMO.meeting.address, room: DEMO.meeting.room,
        staff_name: DEMO.meeting.staff, when_text: DEMO.meeting.when,
        proposer_brings_family: true, invitee_brings_family: true,
      };

  if (!m) {
    return `
    <div class="screen">
      ${appbar('لقاء في المكتب', { back: false })}
      <div class="pad">
        <div class="panel">
          <p style="margin:0;font-size:15px;line-height:1.9">
            لا لقاء مقترحاً الآن. اللقاء الأول يكون في مكتبنا وبحضور موظّف،
            ويُقترح من داخل المحادثة بعد المكالمة المرئية.
          </p>
        </div>
        <div class="panel tinted accent" style="margin-top:14px">
          <p style="margin:0;font-size:14px;line-height:1.85">
            نحن لا نرتّب لقاءً في مكان عام ولا في بيت أحد. المكتب هو المكان،
            وهذا ليس تشدّداً — هو ما يجعل الطرف الآخر يوافق على اللقاء أصلاً.
          </p>
        </div>
      </div>
    </div>`;
  }

  const when = m.when_text
    || (m.starts_at
        ? new Date(m.starts_at).toLocaleString('ar', {
            weekday: 'long', day: 'numeric', month: 'long',
            hour: 'numeric', minute: '2-digit',
          })
        : 'لم يُحدَّد الموعد بعد');

  const families = m.proposer_brings_family && m.invitee_brings_family
    ? 'الطرفان يحضران مع أهلهما'
    : m.proposer_brings_family || m.invitee_brings_family
    ? 'أحد الطرفين يحضر مع أهله'
    : 'لا أحد يحضر مع أهله';

  const settled = m.state === 'scheduled';

  return `
  <div class="screen">
    ${appbar('لقاء في المكتب', { back: false })}
    <div class="pad">
      <div class="panel ${settled ? 'accent-alt' : ''}">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          ${star(18, settled ? 'var(--accent)' : 'var(--muted)')}
          <span style="font-size:16px;font-weight:600">${
            settled ? 'الموعد مؤكد' : word('meeting', m.state)}</span>
        </div>
        <hr class="rule">
        <dl style="margin:0">
          <div class="kv"><dt>مع</dt><dd>${escapeAttr(m.with_name || '—')}</dd></div>
          <div class="kv"><dt>الموعد</dt><dd>${escapeAttr(when)}</dd></div>
          ${m.office ? `<div class="kv"><dt>المكتب</dt><dd>${escapeAttr(m.office)}</dd></div>` : ''}
          ${m.address ? `<div class="kv"><dt>العنوان</dt><dd style="font-weight:400">${
            escapeAttr(m.address)}</dd></div>` : ''}
          ${m.room ? `<div class="kv"><dt>الغرفة</dt><dd>${escapeAttr(m.room)}</dd></div>` : ''}
          ${m.staff_name ? `<div class="kv"><dt>الموظّفة</dt><dd>${
            escapeAttr(m.staff_name)}</dd></div>` : ''}
          <div class="kv"><dt>العائلات</dt><dd>${families}</dd></div>
        </dl>
        ${m.maps_url ? `
          <a class="btn quiet" style="margin-top:10px;display:block;text-align:center"
             href="${escapeAttr(m.maps_url)}" target="_blank" rel="noopener">الموقع على الخريطة</a>` : ''}
      </div>

      ${settled ? `
        <div class="panel">
          <p class="eyebrow">قبل أن تأتي</p>
          <div class="line-item" style="padding-top:2px">${ico.check}<span>احضر قبل الموعد بعشر دقائق</span></div>
          <div class="line-item">${ico.check}<span>أحضِر هويتك</span></div>
          <div class="line-item">${ico.face}<span>إن تأخرت أو اعتذرت، أخبرنا من التطبيق</span></div>
        </div>
        <p class="note">نسجّل الحضور. عدم الحضور دون إشعار يُسجَّل في ملفك.</p>`
      : `
        <div class="panel tinted accent">
          <p style="margin:0;font-size:14px;line-height:1.85">
            ${m.i_proposed
              ? 'اقترحتَ هذا اللقاء، وننتظر ردّ الطرف الآخر.'
              : 'اقترح الطرف الآخر هذا اللقاء. الردّ لك.'}
            يحدّد المكتب الموعد النهائي بعد موافقة الطرفين.
          </p>
        </div>`}

      <button class="btn quiet" style="color:var(--danger);margin-top:14px"
              data-cancel-meeting="${escapeAttr(m.id || '')}">إلغاء اللقاء</button>
    </div>
  </div>`;
};

// --------------------------------------------------------------------- //
// My profile
// --------------------------------------------------------------------- //

// Arabic for the enum values, in one place. The database stores the enum;
// a screen that stored the Arabic would make every query a translation.
const WORDS = {
  marital_status: {
    never_married: 'لم يسبق لي الزواج', divorced: 'مطلّق/ة', widowed: 'أرمل/ة',
  },
  practice_level: {
    practicing: 'ملتزم/ة', moderately_practicing: 'ملتزم/ة إلى حدٍّ ما',
    cultural: 'بحكم النشأة', prefer_not_to_say: 'أفضّل عدم الإجابة',
  },
  timeline: {
    within_6_months: 'خلال 6 شهور', within_1_year: 'خلال سنة',
    within_2_years: 'خلال سنتين', when_right_person: 'عند الشخص المناسب',
  },
  outcome_kind: {
    married: 'زواج', engaged: 'خطوبة', ended: 'انتهت',
    not_compatible: 'غير متوافقين', left_platform: 'ترك التطبيق',
  },
  redacted: {
    phone: 'رقم هاتف', email: 'بريد', handle: 'حساب تواصل',
    address: 'عنوان', identifier: 'تفاصيل اتصال', url: 'رابط',
  },
  reason: {
    fake_profile: 'ملف مزيّف', already_married: 'متزوج بالفعل',
    asked_for_money: 'طلب مالاً', harassment: 'مضايقة',
    inappropriate_content: 'محتوى غير لائق', not_serious: 'غير جادّ',
    underage: 'قاصر', other: 'أخرى',
  },
  meeting: {
    proposed: 'مقترح', pending_scheduling: 'بانتظار موعد',
    scheduled: 'محدَّد موعده', completed: 'تمّ',
    cancelled: 'ملغى', declined: 'مرفوض', no_show: 'لم يحضر',
  },
  release: {
    pending_other: 'بانتظار الطرف الآخر', pending_admin: 'بانتظار المراجعة',
    declined_by_admin: 'مرفوض', awaiting_payment: 'بانتظار الدفع',
    released: 'تمّ التبادل', expired: 'انتهت المهلة', cancelled: 'ملغى',
  },
  status: {
    // Not an account_status: browse_members returns it for a visitor with
    // a session and no application, where no account exists to have one.
    none: 'لم تُرسل طلباً بعد',
    applying: 'قيد الاستكمال', pending_review: 'قيد المراجعة', admitted: 'مقبول',
    rejected: 'مرفوض', shadow_limited: 'محدود', suspended: 'موقوف',
    banned: 'محظور', paused: 'متوقف مؤقتاً', closed: 'مغلق',
  },
};
const word = (group, value) => WORDS[group]?.[value] || value || '—';

const fact = (label, value) => `
  <div class="line-item" style="align-items:baseline">
    <span class="tiny muted" style="min-width:104px">${label}</span>
    <span style="flex:1;font-size:15px">${escapeAttr(value ?? '—')}</span>
  </div>`;

screens.profile = () => {
  const p = state.profile;

  if (!state.db) {
    return `
    <div class="screen">
      ${appbar('ملفي', { back: false })}
      <div class="pad">
        <div class="panel tinted accent">
          <p class="eyebrow">لا يوجد خادم</p>
          <p style="margin:0;font-size:14.5px;line-height:1.85">
            هذه النسخة تعمل ببيانات ثابتة، فلا ملف شخصي لعرضه. اربط مشروع
            Supabase ليصبح الملف حقيقياً — التفاصيل في docs/deploy.md.
          </p>
        </div>
      </div>
    </div>`;
  }

  if (!p) {
    return `
    <div class="screen">
      ${appbar('ملفي', { back: false })}
      <div class="pad"><div class="panel"><p class="muted" style="margin:0">جارٍ التحميل…</p></div></div>
    </div>`;
  }

  if (!p.user_id) {
    return `
    <div class="screen">
      ${appbar('ملفي', { back: false })}
      <div class="pad">
        <div class="panel">
          <p style="margin:0 0 10px;font-size:15px">لم تُرسل طلب انضمام من هذا الجهاز بعد.</p>
          <button class="btn" data-go="apply">ابدأ طلب الانضمام</button>
        </div>
      </div>
    </div>`;
  }

  const photos = p.photos || [];

  return `
  <div class="screen">
    ${appbar('ملفي', { back: false })}
    <div class="pad">
      <div class="panel">
        <div style="display:flex;align-items:flex-start;gap:12px">
          <div style="flex:1;min-width:0">
            <div style="font-size:19px;font-weight:700">${escapeAttr(p.display_name || '—')}</div>
            <div class="tiny muted" style="margin-top:3px">
              ${escapeAttr(p.city || 'بلا مدينة')} · ${word('status', p.status)}
            </div>
          </div>
          <button class="btn quiet" style="width:auto" data-go="apply">تعديل</button>
        </div>
      </div>

      <p class="eyebrow">صوري</p>
      <div class="panel">
        <div class="photo-grid" id="photo-grid">
          ${photos.map((ph) => `
            <div class="photo-cell" data-path="${escapeAttr(ph.storage_path)}"
                 role="img" aria-label="صورتك${ph.approved ? '' : ' — قيد المراجعة'}">
              <div class="photo-veil">${star(22, 'var(--accent)', 0.4)}</div>
              ${/* Your own photos are shown clearly. The blur is what
                    everyone ELSE sees, and applying it here too was a
                    mistake of mine: you cannot tell whether your own
                    photo is any good through a blur, and checking that is
                    the only reason to open this screen. */ ''}
              ${/* alt is empty on purpose: a failed image would otherwise
                    print its label across the tile, and the cell already
                    carries the description for a screen reader. */ ''}
              <img alt="" class="unveiled" data-zoom
                   data-signed="${escapeAttr(ph.storage_path)}">
              <div class="photo-tags">
                ${ph.is_primary ? '<span class="photo-tag">الأساسية</span>' : ''}
                ${ph.approved ? '' : '<span class="photo-tag pending">قيد المراجعة</span>'}
              </div>
              <button class="photo-del" data-del-photo="${ph.id}" aria-label="حذف">${ico.trash}</button>
            </div>`).join('')}
          ${photos.length < 6 ? `
            <label class="photo-cell add">
              ${ico.plus}
              <span class="tiny">أضف صورة</span>
              <input type="file" id="photo-input" accept="image/*" hidden>
            </label>` : ''}
        </div>
        <p class="note" style="margin-top:12px">
          تراها أنت كما هي. أمّا غيرك فيراها مموّهة دائماً، ولا تُكشف إلا بإذنك
          لشخص واحد ولمدة محددة. كل صورة تُراجع قبل أن تظهر لأحد. الحد ست صور.
          اضغط على الصورة لتكبيرها.
        </p>
        <div id="photo-error"></div>
      </div>

      <p class="eyebrow">ما قدّمته</p>
      <div class="panel tight">
        ${fact('الحالة', word('marital_status', p.marital_status))}
        ${fact('الالتزام', word('practice_level', p.practice_level))}
        ${fact('الإطار الزمني', word('timeline', p.timeline))}
        ${fact('الانتقال', p.willing_to_relocate ? 'مستعد/ة' : 'أفضّل مدينتي')}
        ${fact('العائلة', p.family_aware ? 'على علم' : 'ليست على علم بعد')}
        ${p.bio ? fact('نبذة', p.bio) : ''}
      </div>

      ${state.db ? `
        <p class="eyebrow" style="margin-top:22px">المزيد</p>
        <div class="panel tight">
          <button class="btn quiet" data-go="membership">
            العضوية${state.benefits ? ` — ${TIER_NAMES[state.benefits.membership] || ''}` : ''}
          </button>
          <button class="btn quiet" style="margin-top:6px" data-go="search">البحث</button>
          <button class="btn quiet" style="margin-top:6px" data-go="admirers">
            من أبدى اهتمامه بك
          </button>
        </div>` : ''}

      ${state.isAdmin ? `
        <button class="btn ghost" style="margin-top:18px" data-go="admin">
          ${ico.desk} <span style="margin-inline-start:8px">مكتب المراجعة</span>
        </button>` : ''}

      <p class="eyebrow" style="margin-top:22px">حسابك</p>
      <div class="panel tight">
        ${state.email ? `
          <div class="line-item" style="align-items:center">
            <div style="flex:1;min-width:0">
              <div class="tiny muted">مسجّل الدخول باسم</div>
              <div dir="ltr" style="font-size:14.5px;text-align:right">${escapeAttr(state.email)}</div>
            </div>
            <button class="btn quiet" style="width:auto" data-signout>خروج</button>
          </div>`
        : `
          <p style="margin:0 0 10px;font-size:14.5px;line-height:1.85">
            حسابك مرتبط بهذا المتصفح وحده. أضف بريداً وكلمة مرور لتعود إلى طلبك
            من أي جهاز — ولا تفقده إن مسحت بيانات الموقع.
          </p>
          <label class="field" style="margin-bottom:10px">
            <span>البريد الإلكتروني</span>
            <input type="email" name="link-email" dir="ltr" inputmode="email"
                   autocomplete="username" placeholder="you@example.com">
          </label>
          <label class="field" style="margin-bottom:10px">
            <span>كلمة المرور</span>
            <input type="password" name="link-password" dir="ltr" autocomplete="new-password">
          </label>
          <div id="link-error"></div>
          <button class="btn" id="link-submit">احفظ حسابي</button>
          <p class="note" style="text-align:center">
            هذا يحفظ الطلب الذي بدأته هنا، ولا ينشئ حساباً جديداً.
          </p>`}
      </div>

      ${state.email ? `
        <p class="eyebrow" style="margin-top:22px">الدخول إلى حسابك</p>
        <div class="panel tight">
          ${(state.sessions || []).length === 0
            ? '<p class="muted tiny" style="margin:0">…</p>'
            : state.sessions.slice(0, 6).map((sn) => `
              <div class="line-item" style="align-items:baseline">
                <span class="tiny muted" style="min-width:96px">${
                  new Date(sn.started_at).toLocaleDateString('ar', {
                    day: 'numeric', month: 'short' })}</span>
                <span style="flex:1;font-size:13.5px;line-height:1.8">
                  ${escapeAttr(deviceName(sn.user_agent))}
                  ${sn.is_this_one ? ' <b style="color:var(--teal)">— هذا الجهاز</b>'
                    : sn.ended_at ? ' <span class="muted">— انتهت</span>' : ''}
                </span>
              </div>`).join('')}
          <button class="btn quiet" style="margin-top:10px" data-session-secure>
            إنهاء الجلسات الأخرى
          </button>
          <p class="note" style="margin-top:6px">
            جلسة واحدة في كل مرة: الدخول من جهاز جديد يُنهي الجلسة السابقة.
          </p>
        </div>` : ''}

      <p class="eyebrow" style="margin-top:22px">معرّف حسابك</p>
      <div class="panel tight">
        <p class="tiny muted" style="margin:0 0 8px;line-height:1.8">
          هذا ما تحتاجه لتمنح نفسك صلاحية المراجعة، من محرّر SQL في Supabase:
        </p>
        <button class="code-line" dir="ltr" data-copy="select grant_admin('${
          escapeAttr(p.user_id)}');">select grant_admin('${escapeAttr(p.user_id)}');</button>
        <p class="tiny muted" style="margin:8px 0 0">اضغط على السطر لنسخه.</p>
      </div>
    </div>
  </div>`;
};

function wireProfile() {
  if (!state.db) return;

  // The photos on this screen. `render` does the same for every screen,
  // so this exists only for the case where wireProfile runs without a
  // fresh render; both skip anything that already has a src.
  for (const img of document.querySelectorAll('img[data-signed]:not([src])')) {
    state.db.photoDataUrl(img.dataset.signed)
      .then((url) => { if (url) img.src = url; })
      .catch(() => {});
  }

  wireLinkAccount();

  const input = document.getElementById('photo-input');
  const errorBox = document.getElementById('photo-error');

  input?.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;

    // Checked here because the alternative is a slow upload that fails at
    // the end, on a phone, on mobile data.
    if (!file.type.startsWith('image/')) {
      errorBox.innerHTML = `<div class="banner warn" style="margin-top:12px">اختر صورة.</div>`;
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      errorBox.innerHTML = `<div class="banner warn" style="margin-top:12px">الصورة أكبر من 8 ميغابايت.</div>`;
      return;
    }

    errorBox.innerHTML = `<div class="banner" style="margin-top:12px">جارٍ رفع الصورة…</div>`;
    try {
      await state.db.uploadPhoto(file);
      await loadProfile();
      render('profile');
      toast('أُضيفت الصورة. ستُراجع قبل أن تظهر لأحد.');
    } catch (error) {
      errorBox.innerHTML = `<div class="banner warn" style="margin-top:12px">${
        escapeAttr(error.message)}</div>`;
    }
  });
}

/**
 * Turn this browser's anonymous account into one with a password,
 * keeping the same account.
 *
 * Deliberately not "create an account": the person already has one, with
 * their application on it. Signing up fresh would leave all of that on an
 * id nobody can ever reach again.
 */
function wireLinkAccount() {
  const button = document.getElementById('link-submit');
  const errorBox = document.getElementById('link-error');
  if (!button || !state.db) return;

  button.addEventListener('click', async () => {
    const email = document.querySelector('[name="link-email"]').value.trim();
    const password = document.querySelector('[name="link-password"]').value;

    const fail = (message) => {
      errorBox.innerHTML = `<div class="banner warn" style="margin:10px 0">${message}</div>`;
      button.disabled = false;
      button.textContent = 'احفظ حسابي';
    };

    if (!email || !password) return fail('أدخل البريد وكلمة المرور.');
    if (password.length < 6) return fail('اختر كلمة مرور من ٦ أحرف أو أكثر.');

    errorBox.innerHTML = '';
    button.disabled = true;
    button.textContent = 'جارٍ الحفظ…';

    try {
      await state.db.linkEmailPassword(email, password);
      const me = await state.db.whoami();
      state.email = me?.email || email;
      invalidate('profile');
      await loadProfile();
      toast('حُفظ حسابك. يمكنك الدخول به من أي جهاز.');
      render('profile');
    } catch (error) {
      fail(escapeAttr(error.message));
    }
  });
}

async function loadProfile() {
  if (!state.db) return;
  // The sign-in history belongs to the same screen, so it is fetched with
  // it rather than on its own timer.
  state.db.mySessions().then((rows) => { state.sessions = rows; }).catch(() => {});
  try {
    // `my_profile()` answers SQL null for a visitor who has not applied.
    // Normalised here so no caller has to remember that, and so a falsy
    // result can never be mistaken for "not fetched yet".
    state.profile = (await state.db.myProfile()) || { user_id: '' };
  } catch (error) {
    console.warn('[nasib] could not read the profile:', error.message);
    state.profile = { user_id: '' };
  }
}

// --------------------------------------------------------------------- //
// Reviewer sign-in
// --------------------------------------------------------------------- //

// Two sign-in screens, one mechanism. A reviewer is an ordinary account
// with a row in admin_users, so the difference between these screens is
// where they send you and what they say — not how they authenticate.
// They are separate URLs because a member arriving at a page headed
// "reviewers" learns something about the product that is none of their
// business, and a reviewer wants a page that does not offer to create an
// account.
screens.staff = () => `
  <div class="screen">
    ${appbar('دخول المراجعين')}
    <div class="pad" id="login-form" data-mode="signin" data-after="admin">
      <div class="center" style="margin-top:6px">${star(26)}</div>
      <h3 class="hd" style="text-align:center;margin-top:14px">دخول المراجعين</h3>
      <p class="body" style="text-align:center;font-size:14.5px;color:var(--ink-soft)">
        هذه الشاشة لمن يراجع الطلبات، لا للأعضاء.
      </p>

      <label class="field" style="margin-top:18px">
        <span>البريد الإلكتروني</span>
        <input type="email" name="email" dir="ltr" autocomplete="username"
               inputmode="email" placeholder="you@example.com">
      </label>

      <label class="field">
        <span>كلمة المرور</span>
        <input type="password" name="password" dir="ltr" autocomplete="current-password">
      </label>

      <div id="login-error"></div>
      <button class="btn" style="margin-top:6px" id="login-submit">دخول</button>

      <p class="note" style="text-align:center;margin-top:16px">
        لست مراجعاً؟ <a href="#/login" style="color:var(--teal)">دخول الأعضاء</a>
      </p>
    </div>
  </div>`;

// ── members ───────────────────────────────────────────────────────────

/** Sign in, or create an account — the same screen, two modes. */
screens.login = () => {
  const creating = state.loginMode === 'signup';
  return `
  <div class="screen">
    ${appbar(creating ? 'إنشاء حساب' : 'دخول')}
    <div class="pad" id="login-form" data-mode="${creating ? 'signup' : 'signin'}" data-after="member">
      <div class="center" style="margin-top:6px">${star(26)}</div>
      <h3 class="hd" style="text-align:center;margin-top:14px">
        ${creating ? 'أنشئ حسابك' : 'أهلاً بعودتك'}
      </h3>
      <p class="body" style="text-align:center;font-size:14.5px;color:var(--ink-soft)">
        ${creating
          ? 'البريد وكلمة المرور هما ما يعيدك إلى طلبك من أي جهاز.'
          : 'ادخل بالبريد وكلمة المرور اللذين أنشأت بهما حسابك.'}
      </p>

      <label class="field" style="margin-top:18px">
        <span>البريد الإلكتروني</span>
        <input type="email" name="email" dir="ltr" inputmode="email"
               autocomplete="${creating ? 'username' : 'username'}" placeholder="you@example.com">
      </label>

      <label class="field">
        <span>كلمة المرور</span>
        <input type="password" name="password" dir="ltr"
               autocomplete="${creating ? 'new-password' : 'current-password'}">
      </label>

      <div id="login-error"></div>
      <button class="btn" style="margin-top:6px" id="login-submit">
        ${creating ? 'إنشاء الحساب' : 'دخول'}
      </button>

      <button class="btn quiet" style="margin-top:10px" data-login-mode="${
        creating ? 'signin' : 'signup'}">
        ${creating ? 'لديّ حساب — دخول' : 'ليس لديّ حساب — إنشاء حساب'}
      </button>

      ${state.userId && !state.email ? `
        <div class="panel tinted accent" style="margin-top:22px">
          <p class="eyebrow">تستخدم الموقع بالفعل</p>
          <p style="margin:0;font-size:14px;line-height:1.85">
            إنشاء حساب جديد من هنا يبدأ من الصفر. إن كنت قد بدأت طلباً على هذا
            المتصفح، اربطه بحسابك من شاشة <a href="#/profile" style="color:var(--teal)">ملفي</a>
            حتى لا تفقده.
          </p>
        </div>` : ''}
    </div>
  </div>`;
};

function wireLogin() {
  const form = document.getElementById('login-form');
  const button = document.getElementById('login-submit');
  const errorBox = document.getElementById('login-error');
  if (!form || !button) return;

  const creating = form.dataset.mode === 'signup';
  const staff = form.dataset.after === 'admin';
  const label = button.textContent.trim();

  const fail = (message) => {
    errorBox.innerHTML = `<div class="banner warn" style="margin-bottom:12px">${message}</div>`;
    button.disabled = false;
    button.textContent = label;
  };

  const submit = async () => {
    const email = form.querySelector('[name="email"]').value.trim();
    const password = form.querySelector('[name="password"]').value;

    if (!email || !password) return fail('أدخل البريد وكلمة المرور.');
    if (creating && password.length < 6) return fail('اختر كلمة مرور من ٦ أحرف أو أكثر.');
    if (!state.db) return fail('لا يوجد خادم في هذه النسخة.');

    errorBox.innerHTML = '';
    button.disabled = true;
    button.textContent = creating ? 'جارٍ الإنشاء…' : 'جارٍ الدخول…';

    try {
      if (creating) {
        const result = await state.db.signUpWithPassword(email, password);
        if (result.needsConfirmation) {
          // Saying "check your email" when the project's mail is not
          // configured is how someone waits for a message that will
          // never arrive.
          errorBox.innerHTML = `
            <div class="banner" style="margin-bottom:12px">
              أُنشئ الحساب، لكنه يحتاج تفعيل البريد قبل الدخول. إن لم تصلك رسالة،
              أوقف تأكيد البريد من إعدادات Supabase، أو أكّد الحساب من لوحة التحكم.
            </div>`;
          button.disabled = false;
          button.textContent = label;
          return;
        }
      } else {
        await state.db.signInWithPassword(email, password);
      }

      // Everything held in memory was read as whoever this browser was a
      // moment ago.
      const me = await state.db.whoami();
      state.isAdmin = !!me?.is_admin;
      state.userId = me?.user_id || '';
      state.email = me?.email || '';
      state.application = null;
      state.profile = null;
      state.queue = null;
      state.members = null;
      invalidate('profile', 'today', 'admin');

      if (staff) {
        if (!state.isAdmin) {
          // Signed in correctly, to an account nobody granted.
          // Authentication and authorisation are separate here on
          // purpose, and saying so beats a desk that refuses them.
          return fail(`دخلت بنجاح، لكن هذا الحساب ليس مراجعاً. تُمنح الصلاحية من محرّر SQL:
            <br><code dir="ltr">select grant_admin_by_email('${escapeAttr(email)}');</code>`);
        }
        return go('admin', { replace: true });
      }

      // A member goes where they left off: their status if they have
      // applied, the form if they have not, the desk if they happen to
      // be a reviewer signing in on the member screen.
      state.application = await state.db.myApplication();
      go(state.isAdmin ? 'desk'
         : !state.application ? 'apply'
         : state.application.status === 'admitted' ? 'today'
         : 'review', { replace: true });
    } catch (error) {
      fail(escapeAttr(error.message));
    }
  };

  button.addEventListener('click', submit);
  // Enter in either field submits, which is what a password manager does
  // after filling them.
  for (const input of form.querySelectorAll('input')) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });
  }
}

// --------------------------------------------------------------------- //
// The review desk
// --------------------------------------------------------------------- //

const QUEUE_TABS = [
  ['waiting', 'في الانتظار'],
  ['admitted', 'مقبولون'],
  ['rejected', 'مرفوضون'],
  ['all', 'الكل'],
];

// The desk's sections. Counts come from admin_stats, so a reviewer can
// see where the work is without opening each one.
const DESK_TABS = [
  ['desk', 'اللوحة', () => 0],
  ['admin', 'الطلبات', (s) => s?.waiting],
  ['admin-chats', 'المحادثات', (s) => s?.flagged_chats],
  ['admin-photos', 'الصور', (s) => s?.photos_pending],
  ['admin-requests', 'طلبات الصور', (s) => s?.requests_pending],
  ['admin-reports', 'البلاغات', (s) => s?.reports_open],
  ['admin-meetings', 'اللقاءات', (s) => s?.meetings_pending],
  ['admin-releases', 'تبادل الأرقام', (s) => s?.releases_pending],
  ['admin-search', 'بحث', () => 0],
  ['admin-audit', 'السجلّ', () => 0],
  ['admin-stats', 'الأرقام', () => 0],
];

/** Every desk route, so the shell and the surface token agree on one list. */
const DESK_ROUTES = new Set([...DESK_TABS.map(([id]) => id), 'member']);

/**
 * The rail. A horizontal scroller on a phone; a sidebar once there is
 * width for one. Same markup either way — the console layout is a media
 * query, not a second component, because two components drift.
 */
const deskNav = (current) => `
  <nav class="rail" aria-label="أقسام المكتب">
    ${DESK_TABS.map(([id, label, count]) => {
      const n = count(state.stats) || 0;
      return `<button data-go="${id}" aria-current="${id === current}">
        <span>${label}</span>
        ${n ? `<span class="badge">${n}</span>` : ''}
      </button>`;
    }).join('')}
    <button data-go="today" style="margin-top:10px;color:var(--muted)">
      <span>العودة للتطبيق</span>
    </button>
  </nav>`;

const deskTop = (title, { side = '' } = {}) => `
  <header class="desk-top">
    <button class="iconbtn" data-back aria-label="رجوع">${ico.back}</button>
    <span class="mark">${star(17, '#fff')}</span>
    <h2>${title}</h2>
    <span class="who">${side || escapeAttr(state.email || 'مكتب المراجعة')}</span>
  </header>`;

/** Morning, afternoon or evening, in Arabic. */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'صباح الخير' : h < 17 ? 'طاب يومك' : 'مساء الخير';
}

// ── drawing ───────────────────────────────────────────────────────────

/**
 * One measure over fourteen days, as an area under a 2px line.
 *
 * Deliberately one series per chart. Signups, matches and messages
 * differ by an order of magnitude or two, and putting them on one axis
 * flattens the small ones to nothing while a second axis would let the
 * shapes be arranged to say anything. Three small charts, each with its
 * own scale and its own label, are the honest form.
 */
function sparkline(values, colour) {
  const w = 220, h = 54, pad = 2;
  if (!values.length) return '';
  const top = Math.max(...values, 1);
  // Mirrored for RTL: time advances in the reading direction, so the
  // oldest day is at the right edge and today is at the left, where the
  // eye finishes. The marker sits on today.
  const x = (i) => w - pad - (i / Math.max(values.length - 1, 1)) * (w - pad * 2);
  const y = (v) => h - pad - (v / top) * (h - pad * 2 - 6);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${line}L${x(values.length - 1).toFixed(1)},${h}L${x(0).toFixed(1)},${h}Z`;
  const id = `g${Math.random().toString(36).slice(2, 8)}`;
  return `
    <svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"
         role="img" aria-label="آخر ١٤ يوماً">
      <defs>
        <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${colour}" stop-opacity=".34"/>
          <stop offset="1" stop-color="${colour}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#${id})"/>
      <path d="${line}" fill="none" stroke="${colour}" stroke-width="2"
            stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(values.length - 1).toFixed(1)}" cy="${y(values[values.length - 1]).toFixed(1)}"
              r="3.2" fill="${colour}"/>
    </svg>`;
}

/** A tile: the number first, the trend under it, the label above. */
const tile = (label, figure, { foot = '', spark = '', go = '' } = {}) => `
  <${go ? 'button' : 'div'} class="tile${go ? ' press' : ''}${
    go && !Number(figure) ? ' clear' : ''}"${go ? ` data-go="${go}"` : ''}>
    <div class="label">${label}</div>
    <div class="figure">${figure}</div>
    ${foot ? `<div class="foot">${foot}</div>` : ''}
    ${spark}
  </${go ? 'button' : 'div'}>`;

/** One thing waiting on a person: the count, what it is, and a way in. */
const work = (route, label, n, note = '') => `
  <button class="work${n ? '' : ' clear'}" data-go="${route}">
    <span class="n">${n}</span>
    <span class="l">${label}${note && n ? `<small>${note}</small>` : ''}</span>
    <span class="go">${ico.back}</span>
  </button>`;

/** Magnitude on one shared scale: horizontal bars, one hue. */
const barRows = (rows, { step = false } = {}) => {
  const top = Math.max(...rows.map(([, n]) => n), 1);
  return `<div class="bars">${rows.map(([name, n], i) => `
    <div class="bar-row${step ? ` step-${i + 1}` : ''}">
      <span class="name">${name}</span>
      <span class="track"><span class="fill" style="width:${
        Math.max((n / top) * 100, n ? 2 : 0)}%"></span></span>
      <span class="n">${n}</span>
    </div>`).join('')}</div>`;
};

// ── the conversation monitor ───────────────────────────────────────────
//
// This screen shows two members' private messages to a reviewer. Three
// things about how it is built, because the design is the safeguard:
//
//   * The default list is `flagged` — pairs the redaction filter fired
//     on — ranked by how many times it fired. A reviewer who works from
//     the top of this list is looking at the people most likely to be
//     working around the platform, not browsing strangers' courtships.
//   * Opening a thread writes a row against BOTH members. The screen
//     says so, before the thread, every time. A reviewer who does not
//     want to be in that log should not open the thread.
//   * What the filter removed is gone. The badge says a number was sent;
//     the number was never stored, so there is nothing here to reveal.

const CHAT_FILTERS = [
  ['flagged',  'مُعلَّمة'],
  ['reported', 'فيها بلاغ'],
  ['active',   'نشطة'],
  ['quiet',    'صامتة'],
  ['all',      'الكل'],
];

const attemptState = (n) => (n >= 4 ? 'crit' : n >= 2 ? 'serious' : n >= 1 ? 'warn' : 'good');

screens['admin-chats'] = () => {
  const q = state.chats;
  const rows = q?.rows;
  const filter = state.chatFilter || 'flagged';
  const counts = q?.counts || {};

  return `
  <div class="screen desk-shell">
    ${deskTop('المحادثات', { side: rows ? `${rows.length} محادثة` : '' })}
    ${deskNav('admin-chats')}
    <div class="desk-body">

      <div class="chips" style="margin-bottom:14px">
        ${CHAT_FILTERS.map(([id, label]) => `
          <button class="chip" data-chat-filter="${id}" aria-pressed="${id === filter}">
            ${label}${counts[id] ? ` (${counts[id]})` : ''}
          </button>`).join('')}
      </div>

      <div class="monitor">
        <div class="pane">
          ${!rows ? `<div class="panel"><p class="muted" style="margin:0">جارٍ التحميل…</p></div>`
            : rows.length === 0 ? `
              <div class="panel">
                <p style="margin:0;font-size:15px;line-height:1.9">${
                  filter === 'flagged'
                    ? 'لم يحاول أحد تجاوز المرشّح. هذه هي الحالة التي تريدها.'
                    : 'لا محادثات في هذا التصنيف.'}</p>
              </div>`
            : `<div class="convo-list">${rows.map((r) => {
                const total = Number(r.redactions || 0);
                const a = Number(r.a_redactions || 0);
                const b = Number(r.b_redactions || 0);
                // One-sided pushing is the case worth naming: it reads
                // differently from two people impatient with the rules.
                const oneSided = total >= 2 && (a === 0 || b === 0);
                return `
                <button class="convo" data-chat="${escapeAttr(r.match_id)}"
                        aria-current="${r.match_id === state.openChat}">
                  <span class="pair">
                    ${escapeAttr(r.a_name || 'بلا اسم')}
                    <span class="vs">و</span>
                    ${escapeAttr(r.b_name || 'بلا اسم')}
                  </span>
                  <span class="meta">
                    <span>${r.messages || 0} رسالة</span>
                    ${total ? `
                      <span class="attempts">
                        <span class="state ${attemptState(total)}">
                          <span class="dot"></span>${total} محاولة
                        </span>
                        ${oneSided ? '<span style="color:var(--caution)">من طرف واحد</span>' : ''}
                      </span>` : ''}
                    ${Number(r.reports) ? `<span class="state crit">
                      <span class="dot"></span>${r.reports} بلاغ</span>` : ''}
                    <span>${r.last_at
                      ? new Date(r.last_at).toLocaleDateString('ar')
                      : 'لم تبدأ'}</span>
                  </span>
                </button>`;
              }).join('')}</div>`}
        </div>

        <div>${threadPane()}</div>
      </div>
    </div>
  </div>`;
};

function threadPane() {
  const t = state.chat;

  if (!state.openChat) {
    return `
      <div class="panel">
        <p class="eyebrow">قراءة محادثة</p>
        <p style="margin:0;font-size:14.5px;line-height:1.9;color:var(--ink-soft)">
          اختر محادثة من القائمة. فتح أي محادثة يُسجّل باسمك وباسم الطرفين
          في سجلّ الوصول — وهذا ما يجعل المراقبة قابلة للمساءلة بدل أن تكون
          تلصّصاً.
        </p>
      </div>`;
  }
  if (!t || t.match_id !== state.openChat) {
    return `<div class="panel"><p class="muted" style="margin:0">جارٍ التحميل…</p></div>`;
  }

  const [a, b] = t.parties || [];
  const messages = t.messages || [];

  return `
    <div class="panel" style="margin-bottom:12px">
      <div style="display:flex;gap:14px;flex-wrap:wrap">
        ${(t.parties || []).map((party) => `
          <div style="flex:1;min-width:150px">
            <div style="font-size:16px;font-weight:700">
              ${escapeAttr(party.name || 'بلا اسم')}${party.age ? `، ${party.age}` : ''}
            </div>
            <div class="tiny muted" style="margin-top:3px">
              ${escapeAttr(party.city || '—')} · ${TIER_NAMES[party.membership] || ''}
            </div>
            <div style="margin-top:7px;display:flex;gap:6px;flex-wrap:wrap">
              ${Number(party.redactions) ? `
                <span class="state ${attemptState(Number(party.redactions))}">
                  <span class="dot"></span>${party.redactions} محاولة
                </span>` : '<span class="state good"><span class="dot"></span>لا محاولات</span>'}
              ${Number(party.reports_against) ? `
                <span class="state crit"><span class="dot"></span>${
                  party.reports_against} بلاغ</span>` : ''}
            </div>
            <button class="btn quiet" style="margin-top:6px;text-align:start"
                    data-member="${escapeAttr(party.user_id)}">فتح الملف</button>
          </div>`).join('')}
      </div>
    </div>

    <div class="panel tinted" style="margin-bottom:12px">
      <p style="margin:0;font-size:13.5px;line-height:1.85">
        قراءتك لهذه المحادثة سُجّلت باسمك وباسم الطرفين. ما حجبه المرشّح غير
        موجود هنا ولا في قاعدة البيانات — تُعرض المحاولة، لا الرقم.
      </p>
    </div>

    ${messages.length === 0
      ? `<div class="panel"><p class="muted" style="margin:0">لا رسائل بعد.</p></div>`
      : `<div class="panel">
          <div class="thread">
            ${messages.map((m) => {
              const cats = (m.categories || []).map((c) => word('redacted', c)).join('، ');
              return `
              <div class="msg ${m.side}${m.redacted ? ' stripped' : ''}">
                ${escapeAttr(m.body)}
                ${m.redacted ? `<span class="caught">حُجب: ${
                  cats || 'تفاصيل اتصال'}</span>` : ''}
                <span class="stamp">${
                  escapeAttr((m.side === 'a' ? a : b)?.name || '')} · ${
                  new Date(m.created_at).toLocaleString('ar', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              </div>`;
            }).join('')}
          </div>
        </div>`}

    ${t.release ? `
      <p class="eyebrow" style="margin-top:16px">تبادل الأرقام</p>
      <div class="panel tight">
        ${fact('الحالة', word('release', t.release.state) || t.release.state)}
        ${fact('المبلغان', `${t.release.a_amount ?? '—'} / ${t.release.b_amount ?? '—'}`)}
      </div>` : ''}
  `;
}

// ── the dashboard ─────────────────────────────────────────────────────

const STATUS_WORDS = {
  applying: 'يكتب طلبه', pending_review: 'ينتظر المراجعة', admitted: 'مقبول',
  rejected: 'مرفوض', shadow_limited: 'ظهور محدود', banned: 'محظور',
};

screens.desk = () => {
  const o = state.overview;

  if (!o) {
    return `
    <div class="screen desk-shell">
      ${deskTop('اللوحة')}
      ${deskNav('desk')}
      <div class="desk-body">
        <div class="tiles">${[0, 0, 0, 0].map(() => `
          <div class="tile"><div class="label">…</div><div class="figure">—</div></div>`).join('')}</div>
      </div>
    </div>`;
  }

  const series   = o.series || [];
  const days     = (key) => series.map((d) => Number(d[key] || 0));
  const sum      = (key) => days(key).reduce((a, b) => a + b, 0);
  const q        = o.queue || {};
  const totals   = o.totals || {};
  const waiting  = Number(o.longest_wait_hours || 0);

  // The oldest applicant, not the mean wait. An average of twenty
  // applications from this morning and one from March reads as four
  // hours, and the person from March is who the number is about.
  const waitState = waiting >= 72 ? 'crit' : waiting >= 24 ? 'warn' : 'good';
  const waitWord  = waiting >= 72 ? 'متأخّر' : waiting >= 24 ? 'ينتظر' : 'منتظم';

  const funnel = o.funnel || {};
  const memberships = o.memberships || {};

  return `
  <div class="screen desk-shell">
    ${deskTop('اللوحة')}
    ${deskNav('desk')}
    <div class="desk-body">

      <div style="margin:2px 0 20px">
        <h3 class="hd" style="margin:0">
          <span class="grad-text">${greeting()}</span>
        </h3>
        <p class="tiny muted" style="margin:4px 0 0">
          ${Number(q.applications || 0) + Number(q.photos || 0) + Number(q.reports || 0)
            + Number(q.requests || 0) + Number(q.meetings || 0) + Number(q.releases || 0) === 0
            ? 'لا شيء ينتظر قراراً الآن.'
            : `${Number(q.applications || 0) + Number(q.photos || 0) + Number(q.reports || 0)
                 + Number(q.requests || 0) + Number(q.meetings || 0)
                 + Number(q.releases || 0)} أمراً ينتظر قراراً.`}
          ${Number(q.flagged_chats || 0)
            ? ` و${q.flagged_chats} محادثة أوقف المرشّح تفاصيل فيها.`
            : ''}
        </p>
      </div>

      <p class="eyebrow">آخر ١٤ يوماً</p>
      <div class="tiles">
        ${tile('تسجيلات جديدة', sum('signups'),
               { foot: 'خلال أسبوعين', spark: sparkline(days('signups'), 'var(--viz-1)') })}
        ${tile('توافقات', sum('matches'),
               { foot: `${totals.matches || 0} نشطة الآن`, spark: sparkline(days('matches'), 'var(--viz-2)') })}
        ${tile('رسائل', sum('messages'),
               { foot: `${totals.messages || 0} منذ البداية`, spark: sparkline(days('messages'), 'var(--viz-3)') })}
        ${tile('أطول انتظار', `${waiting}<span style="font-size:15px;font-weight:600"> س</span>`,
               { foot: `<span class="state ${waitState}"><span class="dot"></span>${waitWord}</span>` })}
      </div>

      <p class="eyebrow" style="margin-top:22px">ينتظر قراراً</p>
      <div class="worklist">
        ${[
          ['admin',          'طلبات عضوية', q.applications, ''],
          ['admin-chats',    'محادثات مُعلَّمة', q.flagged_chats, 'المرشّح أوقف تفاصيل فيها'],
          ['admin-photos',   'صور تنتظر الاعتماد', q.photos, ''],
          ['admin-reports',  'بلاغات مفتوحة', q.reports, ''],
          ['admin-requests', 'طلبات رؤية الصور', q.requests, ''],
          ['admin-meetings', 'لقاءات تنتظر موعداً', q.meetings, ''],
          ['admin-releases', 'تبادل أرقام', q.releases, ''],
        ].map(([route, label, n, note]) => work(route, label, Number(n || 0), note)).join('')}
      </div>

      <div style="display:grid;gap:16px;margin-top:22px"
           class="desk-split">
        <div>
          <p class="eyebrow">مسار القبول</p>
          <div class="panel">
            ${barRows(Object.keys(STATUS_WORDS)
              .filter((k) => Number(funnel[k] || 0) > 0 || k === 'admitted')
              .map((k) => [STATUS_WORDS[k], Number(funnel[k] || 0)]))}
          </div>
        </div>
        <div>
          <p class="eyebrow">العضويات</p>
          <div class="panel">
            ${barRows(['basic', 'premium', 'golden']
              .map((k) => [TIER_NAMES[k], Number(memberships[k] || 0)]), { step: true })}
            <p class="tiny muted" style="margin:12px 0 0">
              مستوى واحد متدرّج، لا ثلاثة ألوان: الأساسية والمميّزة والذهبية
              مرتّبة، وليست أصنافاً مستقلّة.
            </p>
          </div>
        </div>
      </div>

      ${(o.cities || []).length ? `
        <p class="eyebrow" style="margin-top:22px">المدن</p>
        <div class="panel">
          ${barRows(o.cities.map((c) => [escapeAttr(c.city), Number(c.n)]))}
        </div>` : ''}

      <p class="eyebrow" style="margin-top:22px">الإجمالي</p>
      <div class="panel tight">
        ${fact('الأعضاء', totals.members)}
        ${fact('توافقات نشطة', totals.matches)}
        ${fact('أرقام تبادلت', totals.releases)}
        ${fact('المراجعون', totals.reviewers)}
        ${Object.entries(o.outcomes || {}).map(([k, n]) =>
          fact(word('outcome_kind', k) || k, n)).join('')}
      </div>
    </div>
  </div>`;
};

/**
 * The application queue as a card stack.
 *
 * Borrowed from the swipe deck members use, and it earns its place here
 * for a reason that has nothing to do with fashion: a reviewer working
 * through forty applications makes a better decision looking at one
 * person at a time than scrolling a list where the forty blur together.
 * One card, one decision, then it is gone.
 *
 * Three guards on the borrowing:
 *   * A reviewer's own application is never in the deck — it renders as
 *     a card that cannot be decided, same rule as the list.
 *   * Reject asks twice. A swipe is a cheap gesture and rejection is not
 *     a cheap outcome.
 *   * "Open the file" is always one tap away, because a card is a summary
 *     and some decisions need the whole application.
 */

/**
 * Decide the top card, then let it leave before the repaint.
 *
 * The card flies out first and the request goes in parallel: a reviewer
 * working through a queue should not watch a spinner between every
 * decision. If the request fails the card comes back, which is the one
 * case where the optimism has to be undone rather than apologised for.
 */
async function decideFromDeck(id, action) {
  const card = document.querySelector(`#deck .card[data-card="${id}"]`);
  card?.classList.add(action === 'admit' ? 'gone-yes' : 'gone-no');

  if (!state.db) {
    toast('لا اتصال بقاعدة البيانات.');
    return;
  }

  try {
    await state.db.adminDecide(id, action);
    state.members = null;
    state.member = null;
    invalidate('stats', 'member');
    // Drop it from the queue in place rather than refetching: the next
    // card has to be on screen now, and the counts are refreshed by the
    // stats read the shell does anyway.
    if (state.queue?.rows) {
      state.queue.rows = state.queue.rows.filter((r) => r.id !== id);
    }
    toast(action === 'admit' ? 'قُبل الطلب.' : 'رُفض الطلب.');
    await new Promise((r) => setTimeout(r, 200));
    if (current() === 'admin') render('admin');
  } catch (error) {
    card?.classList.remove('gone-yes', 'gone-no');
    toast(error.message);
  }
}

/**
 * Drag the top card.
 *
 * Pointer events rather than touch events, so a reviewer with a mouse
 * gets the same gesture as one with a phone. The threshold is a third of
 * the card's width: far enough that a stray scroll does not decide
 * somebody's application.
 */
function wireDeck() {
  const deck = document.getElementById('deck');
  const card = deck?.querySelector('.card');
  if (!card) return;

  let startX = 0, startY = 0, dx = 0, dragging = false, decided = false;
  const threshold = () => Math.max(card.offsetWidth / 3, 90);

  card.addEventListener('pointerdown', (event) => {
    if (event.button) return;
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    card.style.transition = 'none';
    card.setPointerCapture?.(event.pointerId);
  });

  card.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    dx = event.clientX - startX;
    const dy = event.clientY - startY;
    // A mostly-vertical drag is a scroll, not a verdict.
    if (Math.abs(dy) > Math.abs(dx) * 1.6 && Math.abs(dx) < 24) return;
    card.style.transform = `translateX(${dx}px) rotate(${dx / 26}deg)`;
    // RTL: dragging toward the inline start (leftward, negative dx) is
    // the forward direction, so that is admit — the same direction as
    // the green button, which sits at the inline end.
    card.dataset.lean = dx < -40 ? 'yes' : dx > 40 ? 'no' : '';
  });

  const release = () => {
    if (!dragging || decided) return;
    dragging = false;
    card.style.transition = '';
    if (Math.abs(dx) > threshold()) {
      const action = dx < 0 ? 'admit' : 'reject';
      if (card.dataset.card === state.userId) {
        toast('لا يبتّ المراجع في طلبه.');
      } else if (action === 'reject') {
        // Same two-step as the button: the drag arms it, a tap confirms.
        toast('اسحب مرة أخرى أو اضغط ✕ لتأكيد الرفض.');
        const button = document.querySelector('[data-deck="reject"]');
        if (button) {
          button.dataset.confirming = 'yes';
          button.style.background = 'var(--st-crit)';
          button.style.color = '#fff';
        }
      } else {
        decided = true;
        card.style.transform = '';
        card.dataset.lean = '';
        decideFromDeck(card.dataset.card, 'admit');
        return;
      }
    }
    card.style.transform = '';
    card.dataset.lean = '';
    dx = 0;
  };

  card.addEventListener('pointerup', release);
  card.addEventListener('pointercancel', release);
  card.addEventListener('lostpointercapture', release);
}

function reviewDeck(rows) {
  const deck = rows.slice(0, 12);
  if (!deck.length) return '';

  return `
    <div class="stack" id="deck">
      ${deck.map((r, i) => {
        const mine = r.id === state.userId;
        return `
        <article class="card" data-card="${escapeAttr(r.id)}" data-i="${i}">
          <span class="verdict yes">قبول</span>
          <span class="verdict no">رفض</span>
          <div class="shot">
            ${r.photo
              ? `<img alt="" data-signed="${escapeAttr(r.photo)}">`
              : `<div class="none">لم يرفع صوراً</div>`}
            <div class="over">
              <div class="nm">${escapeAttr(r.display_name || 'بلا اسم')}${
                r.age ? `، ${r.age}` : ''}</div>
              <div class="sub">
                ${escapeAttr(r.city || '—')}
                ${r.occupation ? ` · ${escapeAttr(r.occupation)}` : ''}
                ${r.photo_count ? ` · ${r.photo_count} صور` : ' · بلا صور'}
              </div>
            </div>
          </div>
          <div class="facts">
            <div class="ln"><span>الحالة</span><span>${
              word('marital_status', r.marital_status)}</span></div>
            <div class="ln"><span>الالتزام</span><span>${
              word('practice_level', r.practice_level)}</span></div>
            <div class="ln"><span>الإطار الزمني</span><span>${
              word('timeline', r.timeline)}</span></div>
            <div class="ln"><span>العائلة</span><span>${
              r.family_aware ? 'على علم' : 'ليست على علم'}</span></div>
            ${Number(r.reports_against) ? `
              <div class="ln"><span>بلاغات</span><span class="state crit">
                <span class="dot"></span>${r.reports_against} مفتوح</span></div>` : ''}
            ${mine ? `
              <div class="ln"><span>ملاحظة</span><span style="color:var(--caution)">
                هذا طلبك — لا يبتّ المراجع في طلبه</span></div>` : ''}
          </div>
        </article>`;
      }).join('')}
    </div>

    <div class="deck-controls">
      <button class="round no" data-deck="reject" aria-label="رفض">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
      <button class="round" data-deck="open" aria-label="فتح الملف">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 5h16v14H4zM8 9h8M8 13h5"/></svg>
      </button>
      <button class="round yes big" data-deck="admit" aria-label="قبول">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 6 9 17l-5-5"/></svg>
      </button>
    </div>

    <p class="tiny muted" style="text-align:center;margin:12px 0 0">
      اسحب البطاقة أو استخدم الأزرار. الرفض يسأل مرّتين.
      ${deck.length < rows.length ? `باقي ${rows.length - deck.length} بعد هؤلاء.` : ''}
    </p>`;
}

screens.admin = () => {
  const q = state.queue;

  // Opening this URL without being a reviewer is the common case — it is
  // how the first reviewer is made. So it is a screen with the one thing
  // that is needed, not a refusal: the account id, in the statement that
  // grants it, ready to copy.
  if (q?.forbidden) {
    const id = state.userId || '';
    return `
    <div class="screen desk-shell">
      ${deskTop('مكتب المراجعة')}
      <div class="desk-body">
        <div class="panel">
          <p class="eyebrow">لست مراجعاً</p>
          <p style="margin:0;font-size:15px;line-height:1.9">
            هذه الشاشة لمن يراجع الطلبات. لا يوجد اسم مستخدم ولا كلمة مرور —
            الصلاحية تُمنح لحساب بعينه من قاعدة البيانات، ولا يمكن منحها من
            داخل التطبيق. هذا مقصود: لو أمكن ذلك لصار للمكتب باب من المتصفح.
          </p>
        </div>

        ${id ? `
          <p class="eyebrow">لتمنح هذا الجهاز الصلاحية</p>
          <div class="panel tight">
            <p class="tiny muted" style="margin:0 0 8px;line-height:1.85">
              انسخ السطر التالي، وشغّله في محرّر SQL في Supabase، ثم أعد تحميل الصفحة.
            </p>
            <button class="code-line" dir="ltr" data-copy="select grant_admin('${
              escapeAttr(id)}');">select grant_admin('${escapeAttr(id)}');</button>
            <p class="tiny muted" style="margin:8px 0 0">اضغط على السطر لنسخه.</p>
          </div>

          <div class="panel tinted accent" style="margin-top:14px">
            <p style="margin:0;font-size:14px;line-height:1.85">
              هذا المعرّف يخصّ هذا المتصفح وحده. متصفّح آخر أو جهاز آخر له معرّف
              مختلف، ومسح بيانات الموقع يُنشئ معرّفاً جديداً ويُفقد الصلاحية.
            </p>
          </div>` : `
          <div class="panel">
            <p style="margin:0;font-size:15px">لا توجد جلسة بعد. أعد تحميل الصفحة.</p>
          </div>`}

        <button class="btn" style="margin-top:18px" data-go="staff">دخول بحساب مراجع</button>
        <button class="btn ghost" style="margin-top:10px" data-go="today">رجوع</button>
      </div>
    </div>`;
  }

  const filter = state.queueFilter || 'waiting';
  const rows = q?.rows || [];
  // The stack is only honest for the waiting queue: a card you swipe
  // through implies every card gets a decision, which is true of
  // applications and not of a list you are browsing.
  const stackable = filter === 'waiting' && rows.length > 0;
  const asStack = stackable && state.queueView !== 'list';

  return `
  <div class="screen desk-shell">
    ${deskTop('مكتب المراجعة', { side: q ? `${rows.length} طلب` : '' })}
    ${deskNav('admin')}
    <div class="desk-body">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
        <div class="chips" style="flex:1">
          ${QUEUE_TABS.map(([id, label]) => `
            <button class="chip" data-queue="${id}"
                    aria-pressed="${filter === id}">
              ${label}${q?.counts?.[id] ? ` (${q.counts[id]})` : ''}
            </button>`).join('')}
        </div>
        ${stackable ? `
          <button class="chip" data-queue-view="${asStack ? 'list' : 'stack'}">
            ${asStack ? 'كقائمة' : 'كبطاقات'}
          </button>` : ''}
      </div>

      ${asStack ? reviewDeck(rows) : ''}

      ${asStack ? '' : !q ? `<div class="panel"><p class="muted" style="margin:0">جارٍ التحميل…</p></div>`
        : (q.rows || []).length === 0
        ? `<div class="panel"><p class="muted" style="margin:0">لا أحد هنا.</p></div>`
        : (q.rows || []).map((r) => `
          <div class="panel" data-row="${escapeAttr(r.id)}">
            <div style="display:flex;align-items:flex-start;gap:12px">
              <div style="flex:1;min-width:0">
                <div style="font-size:16.5px;font-weight:600">
                  ${escapeAttr(r.display_name || 'بلا اسم')}${r.age ? `، ${r.age}` : ''}
                </div>
                <div class="tiny muted" style="margin-top:2px">
                  ${escapeAttr(r.city || '—')} · ${word('status', r.status)}
                  ${r.photo_count ? ` · ${r.photo_count} صور` : ' · بلا صور'}
                </div>
                <button class="btn quiet" style="width:auto;padding:6px 0;margin-top:6px"
                        data-member="${escapeAttr(r.id)}">فتح الملف</button>
              </div>
            </div>

            <div class="panel flat" style="background:var(--page);margin-top:12px;padding:12px 14px">
              <div class="tiny" style="line-height:2">
                ${word('marital_status', r.marital_status)} ·
                ${word('practice_level', r.practice_level)} ·
                ${word('timeline', r.timeline)}
                ${r.family_aware ? ' · العائلة على علم' : ''}
                ${r.willing_to_relocate ? ' · مستعد للانتقال' : ''}
              </div>
              ${r.bio ? `<p style="margin:10px 0 0;font-size:14.5px;line-height:1.85">${
                escapeAttr(r.bio)}</p>` : ''}
            </div>

            ${r.id === state.userId ? `
              <div class="panel tinted accent" style="margin-top:14px">
                <p class="eyebrow">هذا طلبك أنت</p>
                <p style="margin:0;font-size:14px;line-height:1.85">
                  لا يبتّ المراجع في طلبه. لو أمكن ذلك لكان في النظام حساب واحد
                  على الأقل لم يراجعه أحد — وهو حساب من يملك المراجعة.
                </p>
                ${['applying', 'pending_review'].includes(r.status) ? `
                  <p class="tiny muted" style="margin:12px 0 8px;line-height:1.85">
                    أثناء التجربة، يمكنك قبول نفسك من محرّر SQL — وهو المكان
                    الوحيد الذي يملك بيانات الدخول لقاعدة البيانات:
                  </p>
                  <button class="code-line" dir="ltr" data-copy="begin; select set_config('nasib.reviewing','on',true); update users set status='admitted', admitted_at=now() where id='${
                    escapeAttr(r.id)}'; commit;">begin; select set_config('nasib.reviewing','on',true); update users set status='admitted', admitted_at=now() where id='${escapeAttr(r.id)}'; commit;</button>
                  <p class="tiny muted" style="margin:8px 0 0">اضغط على السطر لنسخه.</p>` : ''}
              </div>`
              : ['applying', 'pending_review'].includes(r.status) ? `
              <div class="btn-row" style="margin-top:14px">
                <button class="btn ghost" data-decide-user="reject" data-id="${escapeAttr(r.id)}">رفض</button>
                <button class="btn wide" data-decide-user="admit" data-id="${escapeAttr(r.id)}">قبول</button>
              </div>`
              : r.status === 'admitted' ? `
              <div class="btn-row" style="margin-top:14px">
                <button class="btn quiet" style="color:var(--danger)"
                        data-decide-user="shadow_limit" data-id="${escapeAttr(r.id)}">تحديد الظهور</button>
              </div>` : ''}
          </div>`).join('')}

      ${state.email ? `
        <div class="panel tight" style="margin-top:18px">
          <div class="line-item" style="align-items:center">
            <div style="flex:1;min-width:0">
              <div class="tiny muted">تراجع بحساب</div>
              <div dir="ltr" style="font-size:14.5px;text-align:right">${escapeAttr(state.email)}</div>
            </div>
            <button class="btn quiet" style="width:auto" data-signout>خروج</button>
          </div>
        </div>` : ''}

      <div class="panel tinted accent" style="margin-top:18px">
        <p class="eyebrow">ما يُسجَّل</p>
        <p style="margin:0;font-size:14px;line-height:1.85">
          كل قرار يُحفظ باسمك وبسببه، وكل مرة تفتح هذه القائمة تُسجَّل.
          هذا ليس تتبّعاً لك، بل ما يجعل إساءة استخدام هذه الشاشة قابلة للكشف.
        </p>
      </div>
    </div>
  </div>`;
};

async function loadQueue(filter = state.queueFilter || 'waiting') {
  state.queueFilter = filter;
  if (!state.db) return;
  try {
    state.queue = await state.db.adminQueue(filter);
  } catch (error) {
    // `not an admin` is the ordinary case for anyone opening this URL, not
    // a failure. It was being shown as an English toast over a desk that
    // had rendered anyway, which looks like the app is broken rather than
    // like a door that is shut.
    if (/not an admin/i.test(error.message)) {
      state.queue = { forbidden: true, rows: [], counts: {} };
    } else {
      state.queue = { rows: [], counts: {} };
      toast(error.message);
    }
  }
}

// --------------------------------------------------------------------- //
// Memberships, search, and who is interested
// --------------------------------------------------------------------- //

const TIER_NAMES = { basic: 'الأساسية', premium: 'المميّزة', golden: 'الذهبية' };

screens.membership = () => {
  const mine = state.benefits?.membership || 'basic';
  const tiers = state.memberships || [];

  return `
  <div class="screen">
    ${appbar('العضوية')}
    <div class="pad">
      ${tiers.length === 0
        ? `<div class="panel"><p class="muted" style="margin:0">جارٍ التحميل…</p></div>`
        : tiers.map((t) => `
          <div class="panel ${t.membership === mine ? 'accent-alt' : ''}">
            <div style="display:flex;align-items:baseline;gap:8px">
              <h3 class="hd" style="margin:0">${TIER_NAMES[t.membership] || t.membership}</h3>
              ${t.membership === mine
                ? '<span class="badge photo">عضويتك</span>' : ''}
            </div>
            ${t.monthly_price ? `
              <div style="font-size:22px;font-weight:700;margin-top:6px">
                ${t.monthly_price} <span style="font-size:14px">${escapeAttr(t.currency)} / شهر</span>
              </div>` : ''}
            <div class="panel tight" style="margin-top:12px;background:var(--page)">
              <div class="line-item">${ico.done}<span>${
                arabicDigits(String(t.daily_candidates))} مرشّحين يومياً</span></div>
              <div class="line-item">${t.can_search ? ico.done : ico.pending}<span class="${
                t.can_search ? '' : 'muted'}">البحث بالمدينة والعمر والتوجّه</span></div>
              <div class="line-item">${t.can_see_interest ? ico.done : ico.pending}<span class="${
                t.can_see_interest ? '' : 'muted'}">معرفة من أبدى اهتمامه بك</span></div>
              <div class="line-item">${t.release_discount ? ico.done : ico.pending}<span class="${
                t.release_discount ? '' : 'muted'}">
                ${t.release_discount === 100 ? 'تبادل الأرقام بلا رسوم'
                  : t.release_discount ? `خصم ${t.release_discount}% على تبادل الأرقام`
                  : 'رسوم كاملة على تبادل الأرقام'}</span></div>
            </div>
          </div>`).join('')}

      <div class="panel tinted accent">
        <p class="eyebrow">كيف تشترك</p>
        <p style="margin:0;font-size:14px;line-height:1.85">
          الاشتراك يُفعَّل من الإدارة بعد التحويل — لا توجد بطاقة تُدخل هنا.
          راسل الإدارة بالعضوية التي تريدها.
        </p>
      </div>

      <div class="panel tinted">
        <p style="margin:0;font-size:14px;line-height:1.85">
          العضوية لا تشتري قبولاً ولا تُظهر ملفك قبل غيرك. تشتري عدداً أكبر من
          المرشّحين وأدوات للبحث — والمراجعة واحدة للجميع.
        </p>
      </div>
    </div>
  </div>`;
};

screens.admirers = () => {
  const a = state.admirers;
  return `
  <div class="screen">
    ${appbar('من أبدى اهتمامه')}
    <div class="pad">
      ${!a ? `<div class="panel"><p class="muted" style="margin:0">جارٍ التحميل…</p></div>`
        : !a.allowed ? `
          <div class="panel accent-alt">
            <h3 class="hd" style="margin:0">${arabicDigits(String(a.count || 0))} أبدوا اهتمامهم بك</h3>
            <p style="margin:8px 0 0;font-size:14.5px;line-height:1.9">
              معرفة من هم متاحة في العضوية المميّزة والذهبية.
            </p>
            <button class="btn" style="margin-top:12px" data-go="membership">العضويات</button>
          </div>`
        : (a.rows || []).length === 0
        ? `<div class="panel"><p class="muted" style="margin:0">لا أحد بعد.</p></div>`
        : (a.rows || []).map((r) => `
          <div class="panel">
            <div style="font-size:16.5px;font-weight:600">
              ${escapeAttr(r.display_name || '—')}${r.age ? `، ${r.age}` : ''}
            </div>
            <div class="tiny muted" style="margin-top:2px">
              ${escapeAttr(r.city || '—')} · ${word('timeline', r.timeline)}
            </div>
          </div>`).join('')}

      <p class="note">
        من يظهر هنا أبدى اهتمامه بك ولم تردّ بعد. لا يعلم أنك تراه.
      </p>
    </div>
  </div>`;
};

const SEARCH_FIELDS = [
  ['marital_status', 'الحالة', [['never_married', 'لم يسبق له الزواج'],
    ['divorced', 'مطلّق/ة'], ['widowed', 'أرمل/ة']]],
  ['practice_level', 'الالتزام', [['practicing', 'ملتزم/ة'],
    ['moderately_practicing', 'إلى حدٍّ ما'], ['cultural', 'بحكم النشأة']]],
  ['timeline', 'الإطار الزمني', [['within_6_months', 'خلال 6 شهور'],
    ['within_1_year', 'خلال سنة'], ['within_2_years', 'خلال سنتين']]],
];

screens.search = () => {
  const r = state.searchRows;
  const f = state.searchFilters || {};

  if (r && r.allowed === false) {
    return `
    <div class="screen">
      ${appbar('بحث')}
      <div class="pad">
        <div class="panel accent-alt">
          <h3 class="hd" style="margin:0">البحث للعضويات المدفوعة</h3>
          <p style="margin:8px 0 0;font-size:14.5px;line-height:1.9">
            في العضوية الأساسية نعرض عليك مرشّحين مختارين يومياً. البحث بالمدينة
            والعمر والتوجّه متاح في المميّزة والذهبية.
          </p>
          <button class="btn" style="margin-top:12px" data-go="membership">العضويات</button>
        </div>
      </div>
    </div>`;
  }

  return `
  <div class="screen">
    ${appbar('بحث')}
    <div class="pad" id="search-form">
      <label class="field">
        <span>المدينة</span>
        <input type="search" name="city" value="${escapeAttr(f.city || '')}"
               placeholder="رام الله" autocomplete="off">
      </label>

      <div style="display:flex;gap:10px">
        <label class="field" style="flex:1">
          <span>العمر من</span>
          <input type="number" name="min_age" inputmode="numeric" min="18" max="90"
                 value="${escapeAttr(f.min_age || '')}">
        </label>
        <label class="field" style="flex:1">
          <span>إلى</span>
          <input type="number" name="max_age" inputmode="numeric" min="18" max="90"
                 value="${escapeAttr(f.max_age || '')}">
        </label>
      </div>

      ${SEARCH_FIELDS.map(([name, label, options]) => `
        <p class="eyebrow">${label}</p>
        <div class="chips scroll-row" data-search-group="${name}">
          <button class="chip" data-search-value="" aria-pressed="${!f[name]}">الكل</button>
          ${options.map(([value, text]) => `
            <button class="chip" data-search-value="${value}"
                    aria-pressed="${f[name] === value}">${text}</button>`).join('')}
        </div>
        <div class="spacer" style="height:10px"></div>`).join('')}

      <button class="btn" id="search-run">ابحث</button>

      <div style="margin-top:18px">
        ${!r ? ''
          : (r.rows || []).length === 0
          ? `<div class="panel"><p class="muted" style="margin:0">لا نتائج بهذه الشروط.</p></div>`
          : (r.rows || []).map((c) => `
            <div class="panel">
              <div style="font-size:16.5px;font-weight:600">
                ${escapeAttr(c.display_name || '—')}${c.age ? `، ${c.age}` : ''}
              </div>
              <div class="tiny muted" style="margin-top:2px">
                ${escapeAttr(c.city || '—')} · ${word('timeline', c.timeline)}
                · ${word('marital_status', c.marital_status)}
              </div>
              ${c.bio ? `<p style="margin:10px 0 0;font-size:14.5px;line-height:1.85">${
                escapeAttr(c.bio)}</p>` : ''}
              <div class="btn-row" style="margin-top:12px">
                <button class="btn ghost" data-swipe="no" data-id="${escapeAttr(c.id)}">تخطّي</button>
                <button class="btn wide" data-swipe="yes" data-id="${escapeAttr(c.id)}">مهتم</button>
              </div>
            </div>`).join('')}
      </div>

      <p class="note">
        البحث لا يتجاوز ما لا تتنازل عنه أنت أو هم: من لا يتّفق معك في شروطك
        الأساسية لا يظهر هنا مهما بحثت.
      </p>
    </div>
  </div>`;
};

function wireSearchScreen() {
  const run = document.getElementById('search-run');
  if (!run || !state.db) return;

  run.addEventListener('click', async () => {
    const form = document.getElementById('search-form');
    const value = (name) => form.querySelector(`[name="${name}"]`)?.value.trim() || '';

    state.searchFilters = {
      ...state.searchFilters,
      city: value('city') || undefined,
      min_age: value('min_age') || undefined,
      max_age: value('max_age') || undefined,
    };

    run.disabled = true;
    run.textContent = 'جارٍ البحث…';
    try {
      // Undefined keys are dropped so the function's "filter not given"
      // branch is taken rather than compared against an empty string.
      const filters = Object.fromEntries(
        Object.entries(state.searchFilters).filter(([, v]) => v !== undefined && v !== ''));
      state.searchRows = await state.db.searchMembers(filters);
    } catch (error) {
      toast(error.message);
    } finally {
      run.disabled = false;
      run.textContent = 'ابحث';
      render('search');
    }
  });
}

async function loadMembership() {
  try {
    const [benefits, tiers] = await Promise.all([
      state.db.myBenefits(), state.db.allMemberships(),
    ]);
    state.benefits = benefits;
    state.memberships = tiers;
  } catch (error) { console.warn('[nasib] membership:', error.message); }
}

async function loadAdmirers() {
  try { state.admirers = await state.db.myAdmirers(); }
  catch (error) { state.admirers = { allowed: false, count: 0, rows: [] }; }
}

async function loadSearchGate() {
  // Only to learn whether this membership may search, so the screen can
  // show the upgrade panel instead of a form that will refuse.
  try { state.searchRows = await state.db.searchMembers({}); }
  catch { state.searchRows = null; }
}

// --------------------------------------------------------------------- //
// The rest of the review desk
// --------------------------------------------------------------------- //

/** A photo, veiled, with its signed URL fetched after paint. */
const adminPhoto = (path, extra = '') => `
  <div class="photo-cell" data-path="${escapeAttr(path)}">
    <div class="photo-veil">${star(22, 'var(--accent)', 0.4)}</div>
    <img alt="" data-signed="${escapeAttr(path)}" class="unveiled" data-zoom>
    ${extra}
  </div>`;

// ── photos waiting for approval ───────────────────────────────────────

const PHOTO_FILTERS = [['pending', 'تنتظر'], ['approved', 'معتمدة'], ['all', 'الكل']];

screens['admin-photos'] = () => {
  const q = state.photoQueue;
  const rows = q?.rows;
  const filter = state.photoFilter || 'pending';
  return `
  <div class="screen desk-shell">
    ${deskTop('الصور', { side: rows ? `${rows.length} صورة` : '' })}
    ${deskNav('admin-photos')}
    <div class="desk-body">
      <div class="chips scroll-row" style="margin-bottom:16px">
        ${PHOTO_FILTERS.map(([id, label]) => `
          <button class="chip" data-photo-filter="${id}" aria-pressed="${filter === id}">
            ${label}${q?.counts?.[id] ? ` (${q.counts[id]})` : ''}
          </button>`).join('')}
      </div>
      ${!rows ? `<div class="panel"><p class="muted" style="margin:0">جارٍ التحميل…</p></div>`
        : rows.length === 0
        ? `<div class="panel"><p class="muted" style="margin:0">${
            filter === 'pending' ? 'لا صور تنتظر المراجعة — أُنجز كل شيء.'
            : filter === 'approved' ? 'لم تُعتمد أي صورة بعد.'
            : 'لا صور بعد.'}</p></div>`
        : rows.map((ph) => `
          <div class="panel">
            <div style="display:flex;gap:12px;align-items:flex-start">
              <div style="width:96px;flex:none">
                ${adminPhoto(ph.storage_path, ph.is_primary
                  ? '<div class="photo-tags"><span class="photo-tag">الأساسية</span></div>' : '')}
              </div>
              <div style="flex:1;min-width:0">
                <div style="font-size:16px;font-weight:600">
                  ${escapeAttr(ph.display_name || 'بلا اسم')}${ph.age ? `، ${ph.age}` : ''}
                </div>
                <div class="tiny muted" style="margin-top:2px">
                  ${escapeAttr(ph.city || '—')} · ${word('status', ph.status)}
                  ${ph.approved ? ' · <span style="color:var(--teal)">معتمدة</span>' : ''}
                </div>
                <button class="btn quiet" style="width:auto;padding:6px 0;margin-top:6px"
                        data-member="${escapeAttr(ph.user_id)}">فتح الملف</button>
              </div>
            </div>
            <div class="btn-row" style="margin-top:14px">
              ${ph.approved ? `
                <button class="btn ghost" style="color:var(--danger)"
                        data-photo-action="delete" data-id="${escapeAttr(ph.id)}">حذف</button>
                <button class="btn ghost wide" data-photo-action="unapprove"
                        data-id="${escapeAttr(ph.id)}">سحب الاعتماد</button>`
              : `
                <button class="btn ghost" data-photo-action="delete" data-id="${escapeAttr(ph.id)}">حذف</button>
                <button class="btn wide" data-photo-action="approve" data-id="${escapeAttr(ph.id)}">اعتماد</button>`}
            </div>
          </div>`).join('')}

      <div class="panel tinted accent" style="margin-top:14px">
        <p style="margin:0;font-size:14px;line-height:1.85">
          الصورة لا تظهر لأحد قبل اعتمادها — لا للمرشّحين ولا لمن مُنح إذناً.
          الحذف نهائي، ويزيل الملف نفسه.
        </p>
      </div>
    </div>
  </div>`;
};

// ── one member's record ───────────────────────────────────────────────

screens.member = () => {
  const m = state.member;
  if (!m) {
    return `<div class="screen">${appbar('ملف العضو')}
      <div class="pad"><div class="panel"><p class="muted" style="margin:0">جارٍ التحميل…</p></div></div></div>`;
  }

  const waiting = ['applying', 'pending_review'].includes(m.status);

  return `
  <div class="screen desk-shell">
    ${deskTop(escapeAttr(m.display_name || 'ملف العضو'))}
    <div class="pad">
      <div class="panel">
        <div style="display:flex;align-items:flex-start;gap:12px">
          <div style="flex:1;min-width:0">
            <div style="font-size:19px;font-weight:700">
              ${escapeAttr(m.display_name || 'بلا اسم')}${m.age ? `، ${m.age}` : ''}
            </div>
            <div class="tiny muted" style="margin-top:3px">
              ${escapeAttr(m.city || '—')} · ${word('status', m.status)}
              ${m.reports_against ? ` · <span style="color:var(--danger)">${
                m.reports_against} بلاغ</span>` : ''}
            </div>
          </div>
        </div>
      </div>

      ${(m.photos || []).length ? `
        <p class="eyebrow">الصور</p>
        <div class="panel">
          <div class="photo-grid">
            ${m.photos.map((ph) => adminPhoto(ph.storage_path, `
              <div class="photo-tags">
                ${ph.is_primary ? '<span class="photo-tag">الأساسية</span>' : ''}
                <span class="photo-tag ${ph.approved ? '' : 'pending'}">${
                  ph.approved ? 'معتمدة' : 'تنتظر'}</span>
              </div>`)).join('')}
          </div>
        </div>` : ''}

      <p class="eyebrow">ما قدّمه</p>
      <div class="panel tight">
        ${fact('الحالة', word('marital_status', m.marital_status))}
        ${fact('الالتزام', word('practice_level', m.practice_level))}
        ${fact('الإطار الزمني', word('timeline', m.timeline))}
        ${fact('العمل', m.occupation)}
        ${fact('التعليم', m.education)}
        ${fact('الأبناء', m.children_count)}
        ${fact('الانتقال', m.willing_to_relocate ? 'مستعد' : 'يفضّل مدينته')}
        ${fact('العائلة', m.family_aware ? 'على علم' : 'ليست على علم')}
        ${fact('وضع الوليّ', m.wali_required ? 'مطلوب' : 'غير مطلوب')}
        ${fact('تقدّم الطلب', m.applied_at ? new Date(m.applied_at).toLocaleDateString('ar') : '—')}
      </div>

      ${m.bio ? `
        <p class="eyebrow">بكلماته</p>
        <div class="panel flat"><p style="margin:0;font-size:15px;line-height:1.95">${
          escapeAttr(m.bio)}</p></div>` : ''}

      <p class="eyebrow">العضوية</p>
      <div class="panel">
        <div class="tiny muted" style="margin-bottom:10px">
          ${TIER_NAMES[m.membership] || 'أساسية'}${
            m.membership_until
              ? ` · حتى ${new Date(m.membership_until).toLocaleDateString('ar')}`
              : m.membership && m.membership !== 'basic' ? '' : ' · بلا مدة'}
        </div>
        <div class="chips">
          ${['basic', 'premium', 'golden'].map((level) => `
            <button class="chip" type="button"
                    aria-pressed="${level === (m.membership || 'basic')}"
                    data-membership="${level}" data-id="${escapeAttr(m.user_id)}">
              ${TIER_NAMES[level]}
            </button>`).join('')}
        </div>
        <label class="field" style="margin-top:12px">
          <span>عدد الأشهر</span>
          <select id="membership-months">
            ${[1, 3, 6, 12].map((n) => `
              <option value="${n}" ${n === 1 ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </label>
        <p class="tiny muted" style="margin:10px 0 0">
          الدفع يتم خارج التطبيق. اختيار مستوى هنا يسجّل من منحه ومتى.
        </p>
      </div>

      <p class="eyebrow">سجلّ القرارات</p>
      <div class="panel tight">
        ${(m.decisions || []).length === 0
          ? '<p class="muted tiny" style="margin:0">لا قرارات بعد.</p>'
          : m.decisions.map((d) => `
            <div class="line-item" style="align-items:baseline">
              <span class="tiny muted" style="min-width:104px">${
                new Date(d.created_at).toLocaleDateString('ar')}</span>
              <span style="flex:1;font-size:14.5px">
                ${escapeAttr(d.action)} · ${escapeAttr(d.reason_code)}
                ${d.by ? `<span class="tiny muted"> — ${escapeAttr(d.by)}</span>` : ''}
                ${d.notes ? `<br><span class="tiny muted">${escapeAttr(d.notes)}</span>` : ''}
              </span>
            </div>`).join('')}
      </div>

      ${m.user_id === state.userId ? `
        <div class="panel tinted accent" style="margin-top:18px">
          <p style="margin:0;font-size:14px">هذا ملفك أنت. لا يبتّ المراجع في طلبه.</p>
        </div>`
        : `
        <div class="btn-row" style="margin-top:18px">
          ${waiting ? `
            <button class="btn ghost" data-decide-user="reject" data-id="${escapeAttr(m.user_id)}">رفض</button>
            <button class="btn wide" data-decide-user="admit" data-id="${escapeAttr(m.user_id)}">قبول</button>`
          : m.status === 'admitted' ? `
            <button class="btn ghost" data-decide-user="shadow_limit" data-id="${escapeAttr(m.user_id)}">تحديد الظهور</button>
            <button class="btn ghost" style="color:var(--danger)"
                    data-decide-user="ban_account" data-id="${escapeAttr(m.user_id)}">حظر</button>`
          : `
            <button class="btn wide" data-decide-user="unban" data-id="${escapeAttr(m.user_id)}">إعادة للمراجعة</button>`}
        </div>`}
    </div>
  </div>`;
};

// ── reports ───────────────────────────────────────────────────────────

screens['admin-reports'] = () => {
  const q = state.reports;
  return `
  <div class="screen desk-shell">
    ${deskTop('البلاغات', { side: q ? `${(q.rows || []).length} بلاغ` : '' })}
    ${deskNav('admin-reports')}
    <div class="desk-body">
      ${!q ? `<div class="panel"><p class="muted" style="margin:0">جارٍ التحميل…</p></div>`
        : (q.rows || []).length === 0
        ? `<div class="panel"><p class="muted" style="margin:0">لا بلاغات مفتوحة.</p></div>`
        : (q.rows || []).map((r) => `
          <div class="panel">
            <div style="display:flex;align-items:flex-start;gap:10px">
              ${ico.warn}
              <div style="flex:1;min-width:0">
                <div style="font-size:16px;font-weight:600">${word('reason', r.reason)}</div>
                <div class="tiny muted" style="margin-top:2px">
                  ضدّ ${escapeAttr(r.reported_name || '—')} · ${word('status', r.reported_status)}
                  ${r.reports_against_total > 1
                    ? ` · <span style="color:var(--danger)">${r.reports_against_total} بلاغات عليه</span>` : ''}
                </div>
                <div class="tiny muted">
                  من ${escapeAttr(r.reporter_name || '—')}
                  ${r.reports_by_reporter > 2
                    ? ` · <span style="color:var(--caution)">قدّم ${r.reports_by_reporter} بلاغات</span>` : ''}
                </div>
              </div>
            </div>
            ${r.detail ? `
              <div class="panel flat" style="background:var(--page);margin-top:12px;padding:12px 14px">
                <p style="margin:0;font-size:14.5px;line-height:1.85">${escapeAttr(r.detail)}</p>
              </div>` : ''}
            <button class="btn quiet" style="width:auto;padding:6px 0;margin-top:8px"
                    data-member="${escapeAttr(r.reported_id)}">فتح ملف المبلَّغ عنه</button>
            ${r.status === 'open' ? `
              <div class="btn-row" style="margin-top:12px">
                <button class="btn ghost" data-report="dismissed" data-id="${escapeAttr(r.id)}">لا إجراء</button>
                <button class="btn wide" data-report="actioned" data-id="${escapeAttr(r.id)}">اتُّخذ إجراء</button>
              </div>` : `<p class="tiny muted" style="margin-top:10px">${
                r.status === 'actioned' ? 'اتُّخذ إجراء' : 'أُغلق دون إجراء'}</p>`}
          </div>`).join('')}

      <div class="panel tinted accent" style="margin-top:14px">
        <p style="margin:0;font-size:14px;line-height:1.85">
          عدد البلاغات التي قدّمها المُبلِّغ معروض عمداً: البلاغ دليل على صاحبه
          كما هو دليل على من اشتُكي منه.
        </p>
      </div>
    </div>
  </div>`;
};

// ── photo access requests, screened before she ever sees them ─────────

screens['admin-requests'] = () => {
  const rows = state.photoRequests;
  return `
  <div class="screen desk-shell">
    ${deskTop('طلبات الصور', { side: rows ? String(rows.length) : '' })}
    ${deskNav('admin-requests')}
    <div class="desk-body">
      ${!rows ? `<div class="panel"><p class="muted" style="margin:0">جارٍ التحميل…</p></div>`
        : rows.length === 0
        ? `<div class="panel"><p class="muted" style="margin:0">لا طلبات تنتظر الفرز.</p></div>`
        : rows.map((r) => `
          <div class="panel">
            <div style="font-size:16px;font-weight:600">
              ${escapeAttr(r.requester_name || '—')}${r.requester_age ? `، ${r.requester_age}` : ''}
              <span class="tiny muted" style="font-weight:400"> يطلب رؤية صور ${
                escapeAttr(r.owner_name || '—')}</span>
            </div>
            <div class="tiny muted" style="margin-top:2px">
              ${word('status', r.requester_status)}
              ${r.requests_by_requester > 3
                ? ` · <span style="color:var(--caution)">قدّم ${r.requests_by_requester} طلباً</span>` : ''}
            </div>
            ${r.note ? `
              <div class="panel flat" style="background:var(--page);margin-top:12px;padding:12px 14px">
                <p style="margin:0;font-size:14.5px;line-height:1.85">${escapeAttr(r.note)}</p>
              </div>` : '<p class="tiny muted" style="margin-top:10px">بلا رسالة.</p>'}
            <button class="btn quiet" style="width:auto;padding:6px 0;margin-top:8px"
                    data-member="${escapeAttr(r.requester_id)}">فتح ملف الطالب</button>
            <div class="btn-row" style="margin-top:12px">
              <button class="btn ghost" data-screen-request="no" data-id="${escapeAttr(r.id)}">إيقاف</button>
              <button class="btn wide" data-screen-request="yes" data-id="${escapeAttr(r.id)}">تمرير إليها</button>
            </div>
            <p class="note">الطلب الموقوف لا يصلها، ولا تُخطَر به.</p>
          </div>`).join('')}
    </div>
  </div>`;
};

// ── the numbers ───────────────────────────────────────────────────────

const statTile = (label, value, note = '') => `
  <div class="panel" style="margin:0">
    <div style="font-size:26px;font-weight:700;line-height:1.2">${value}</div>
    <div class="tiny muted" style="margin-top:2px">${label}</div>
    ${note ? `<div class="tiny" style="margin-top:4px;color:var(--caution)">${note}</div>` : ''}
  </div>`;

screens['admin-stats'] = () => {
  const s = state.stats;
  return `
  <div class="screen desk-shell">
    ${deskTop('الأرقام')}
    ${deskNav('admin-stats')}
    <div class="desk-body">
      ${!s ? `<div class="panel"><p class="muted" style="margin:0">جارٍ التحميل…</p></div>` : `
        <div class="stat-grid">
          ${statTile('في الانتظار', s.waiting ?? 0,
            s.longest_wait_hours > 24 ? `أقدم طلب: ${Math.round(s.longest_wait_hours / 24)} يوم` : '')}
          ${statTile('أعضاء مقبولون', s.admitted ?? 0)}
          ${statTile('صور تنتظر', s.photos_pending ?? 0)}
          ${statTile('طلبات صور', s.requests_pending ?? 0)}
          ${statTile('بلاغات مفتوحة', s.reports_open ?? 0)}
          ${statTile('محادثات نشطة', s.matches_active ?? 0)}
        </div>

        <p class="eyebrow" style="margin-top:22px">آخر ٧ أيام</p>
        <div class="panel tight">
          ${fact('طلبات جديدة', s.applied_7d ?? 0)}
          ${fact('قرارات', s.decided_7d ?? 0)}
        </div>

        <p class="eyebrow" style="margin-top:22px">زمن الانتظار</p>
        <div class="panel tight">
          ${fact('أطول انتظار', s.longest_wait_hours
            ? `${s.longest_wait_hours} ساعة` : 'لا أحد ينتظر')}
          ${fact('وسيط زمن القرار', s.median_decision_hours
            ? `${s.median_decision_hours} ساعة` : '—')}
        </div>

        <div class="panel tinted accent" style="margin-top:18px">
          <p style="margin:0;font-size:14px;line-height:1.85">
            نعرض أطول انتظار لا متوسّطه. المتوسّط يخفي الشخص الذي ينتظر منذ
            أسبوع خلف عشرة قرارات سريعة — وهو الشخص الذي يغادر.
          </p>
        </div>`}
    </div>
  </div>`;
};

async function loadMyPhotos() {
  try {
    const [requests, grants] = await Promise.all([
      state.db.myPhotoRequests(), state.db.myPhotoGrants(),
    ]);
    state.myRequests = requests;
    state.myGrants = grants;
  } catch (error) {
    state.myRequests = [];
    state.myGrants = [];
    console.warn('[nasib] photos:', error.message);
  }
}

async function loadMatches() {
  try { state.matches = await state.db.myMatches(); }
  catch (error) { state.matches = []; console.warn('[nasib] matches:', error.message); }
}

async function loadThread() {
  if (!state.openMatch) return;
  try {
    const [thread, release] = await Promise.all([
      state.db.matchThread(state.openMatch),
      state.db.myRelease(state.openMatch).catch(() => ({ exists: false })),
    ]);
    state.thread = thread;
    state.release = release;
  } catch (error) {
    state.thread = { messages: [] };
    toast(error.message);
  }
}

async function loadMeetings() {
  try { state.meetings = await state.db.myMeetings(); }
  catch (error) { state.meetings = []; console.warn('[nasib] meetings:', error.message); }
}

// ── search ────────────────────────────────────────────────────────────

screens['admin-search'] = () => `
  <div class="screen desk-shell">
    ${deskTop('بحث')}
    ${deskNav('admin-search')}
    <div class="desk-body">
      <label class="field">
        <span>الاسم، المدينة، أو معرّف الحساب</span>
        <input type="search" id="search-q" value="${escapeAttr(state.searchQ || '')}"
               placeholder="ليلى، رام الله، 43df2ce6" autocomplete="off">
      </label>

      ${state.searchResults === null ? ''
        : state.searchResults.length === 0
        ? `<div class="panel"><p class="muted" style="margin:0">لا نتائج.</p></div>`
        : state.searchResults.map((r) => `
          <div class="panel">
            <div style="display:flex;align-items:center;gap:12px">
              <div style="flex:1;min-width:0">
                <div style="font-size:16.5px;font-weight:600">
                  ${escapeAttr(r.display_name || 'بلا اسم')}${r.age ? `، ${r.age}` : ''}
                </div>
                <div class="tiny muted" style="margin-top:2px">
                  ${escapeAttr(r.city || '—')} · ${word('status', r.status)}
                  ${r.photo_count ? ` · ${r.photo_count} صور` : ''}
                </div>
              </div>
              <button class="btn quiet" style="width:auto"
                      data-member="${escapeAttr(r.id)}">فتح</button>
            </div>
          </div>`).join('')}
    </div>
  </div>`;

function wireSearch() {
  const input = document.getElementById('search-q');
  if (!input) return;

  // Typed into, not submitted: a reviewer looking for one person types a
  // few letters and expects the list to narrow. Debounced, because one
  // request per keystroke is a request per keystroke.
  let timer;
  input.addEventListener('input', () => {
    state.searchQ = input.value;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 2) { state.searchResults = null; return render('admin-search'); }
      try {
        state.searchResults = await state.db.adminSearch(q);
      } catch (error) {
        state.searchResults = [];
        toast(error.message);
      }
      // Re-rendering moves focus, so it is restored with the caret where
      // it was — otherwise every result that arrives interrupts typing.
      const at = input.selectionStart;
      render('admin-search');
      const again = document.getElementById('search-q');
      if (again) { again.focus(); again.setSelectionRange(at, at); }
    }, 250);
  });
  input.focus();
}

// ── meetings waiting on the office ────────────────────────────────────

screens['admin-meetings'] = () => {
  const q = state.adminMeetings;
  const rows = q?.rows;
  return `
  <div class="screen desk-shell">
    ${deskTop('اللقاءات', { side: rows ? String(rows.length) : '' })}
    ${deskNav('admin-meetings')}
    <div class="desk-body">
      ${!rows ? `<div class="panel"><p class="muted" style="margin:0">جارٍ التحميل…</p></div>`
        : rows.length === 0
        ? `<div class="panel">
             <p style="margin:0;font-size:15px;line-height:1.9">
               لا لقاءات تنتظر موعداً. يظهر اللقاء هنا بعد موافقة الطرفين،
               ليُحدَّد له موعد في أحد المكاتب.
             </p>
           </div>`
        : rows.map((m) => `
          <div class="panel">
            <div style="font-size:16.5px;font-weight:600">
              ${escapeAttr(m.party_a || '—')} و${escapeAttr(m.party_b || '—')}
            </div>
            <div class="tiny muted" style="margin-top:2px">
              ${word('meeting', m.state)} · ${escapeAttr(m.city || '—')}
              · اقتُرح ${new Date(m.proposed_at).toLocaleDateString('ar')}
            </div>
            ${m.note ? `
              <div class="panel flat" style="background:var(--page);margin-top:12px;padding:12px 14px">
                <p style="margin:0;font-size:14.5px;line-height:1.85">${escapeAttr(m.note)}</p>
              </div>` : ''}
            ${(m.proposer_brings_family || m.invitee_brings_family) ? `
              <div class="line-item" style="margin-top:8px">${ico.family}<span class="tiny">
                ${m.proposer_brings_family && m.invitee_brings_family
                  ? 'الطرفان يحضران مع أهلهما — غرفة أكبر'
                  : 'أحد الطرفين يحضر مع أهله'}
              </span></div>` : ''}

            ${m.starts_at ? `
              <div class="panel flat" style="background:var(--page);margin-top:12px;padding:12px 14px">
                <div class="tiny">${escapeAttr(m.office || '')} · ${
                  escapeAttr(m.room || '')} · ${escapeAttr(m.staff_name || '')}</div>
                <div style="font-size:15px;margin-top:4px">${
                  new Date(m.starts_at).toLocaleString('ar', {
                    weekday: 'long', day: 'numeric', month: 'long',
                    hour: 'numeric', minute: '2-digit' })}</div>
              </div>`
            : `
              <div style="margin-top:12px">
                <p class="eyebrow">اختر موعداً</p>
                ${(state.slots || []).length === 0 ? `
                  <p class="tiny muted" style="margin:0;line-height:1.85">
                    لا مواعيد متاحة. تُضاف المواعيد إلى جدول office_slots — بلا
                    مواعيد لا يمكن تحديد أي لقاء.
                  </p>`
                : `<div class="chips" style="gap:8px">
                    ${(state.slots || []).slice(0, 8).map((slot) => `
                      <button class="chip" data-schedule="${escapeAttr(m.id)}"
                              data-slot="${escapeAttr(slot.slot_id || slot.id)}">
                        ${new Date(slot.starts_at).toLocaleString('ar', {
                          day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                        ${slot.room ? ` · ${escapeAttr(slot.room)}` : ''}
                      </button>`).join('')}
                  </div>`}
              </div>`}
          </div>`).join('')}
    </div>
  </div>`;
};

// ── contact releases: approve, price, record payment, refund ──────────

const RELEASE_FILTERS = [
  ['pending', 'للمراجعة'], ['awaiting', 'بانتظار الدفع'],
  ['refunds', 'إرجاع'], ['released', 'تمّت'],
];

screens['admin-releases'] = () => {
  const q = state.releases;
  const rows = q?.rows;
  const filter = state.releaseFilter || 'pending';

  return `
  <div class="screen desk-shell">
    ${deskTop('تبادل الأرقام', { side: rows ? String(rows.length) : '' })}
    ${deskNav('admin-releases')}
    <div class="desk-body">
      <div class="chips scroll-row" style="margin-bottom:16px">
        ${RELEASE_FILTERS.map(([id, label]) => `
          <button class="chip" data-release-filter="${id}" aria-pressed="${filter === id}">
            ${label}${q?.counts?.[id] ? ` (${q.counts[id]})` : ''}
          </button>`).join('')}
      </div>

      ${!rows ? `<div class="panel"><p class="muted" style="margin:0">جارٍ التحميل…</p></div>`
        : rows.length === 0
        ? `<div class="panel"><p class="muted" style="margin:0">لا شيء هنا.</p></div>`
        : rows.map((r) => `
          <div class="panel">
            <div style="font-size:16.5px;font-weight:600">
              ${escapeAttr(r.a_name || '—')} و${escapeAttr(r.b_name || '—')}
            </div>
            <div class="tiny muted" style="margin-top:2px">
              ${escapeAttr(r.messages || 0)} رسالة
              ${r.video_call_at ? ' · تمّت المكالمة المرئية'
                : ' · <span style="color:var(--caution)">بلا مكالمة مرئية</span>'}
              ${r.open_reports ? ` · <span style="color:var(--danger)">${
                r.open_reports} بلاغ مفتوح</span>` : ''}
            </div>

            ${r.state === 'pending_admin' ? `
              <div class="panel flat" style="background:var(--page);margin-top:12px;padding:12px 14px">
                <p class="tiny" style="margin:0;line-height:1.85">
                  بعد الموافقة يدفع كلٌّ منهما حصته. الذهبي لا يدفع، والمميّز نصف الرسم.
                </p>
              </div>
              <div class="btn-row" style="margin-top:12px">
                <button class="btn ghost" data-release="no" data-id="${escapeAttr(r.id)}">رفض</button>
                <button class="btn wide" data-release="yes" data-id="${escapeAttr(r.id)}">موافقة</button>
              </div>`
            : r.state === 'awaiting_payment' ? `
              <div class="panel tight" style="margin-top:12px">
                ${[['a', r.a_name, r.a_amount, r.a_paid_at, r.a_user, r.a_membership],
                   ['b', r.b_name, r.b_amount, r.b_paid_at, r.b_user, r.b_membership]]
                  .map(([, name, amount, paid, uid, tier]) => `
                    <div class="line-item" style="align-items:center">
                      <div style="flex:1;min-width:0">
                        <div style="font-size:14.5px">${escapeAttr(name || '—')}
                          <span class="tiny muted">${TIER_NAMES[tier] || ''}</span></div>
                        <div class="tiny muted">${amount} ${escapeAttr(r.currency)}
                          ${paid ? ' · <span style="color:var(--teal)">دُفع</span>' : ''}</div>
                      </div>
                      ${paid ? '' : `
                        <div style="display:flex;gap:6px;align-items:center">
                          <input type="text" style="width:110px;padding:8px 10px;font-size:13px"
                                 id="ref-${escapeAttr(r.id)}-${escapeAttr(uid)}"
                                 placeholder="رقم الحوالة">
                          <button class="btn quiet" style="width:auto"
                                  data-paid="${escapeAttr(r.id)}" data-user="${escapeAttr(uid)}">
                            تسجيل
                          </button>
                        </div>`}
                    </div>`).join('')}
              </div>
              ${r.pay_by ? `<p class="note">المهلة حتى ${
                new Date(r.pay_by).toLocaleString('ar', {
                  day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })}</p>` : ''}`
            : r.refund_due_to && !r.refunded_at ? `
              <div class="panel flat" style="background:var(--page);margin-top:12px;padding:12px 14px">
                <p style="margin:0;font-size:14px;line-height:1.85">
                  انتهت المهلة بدفعة واحدة. المبلغ مستحق الإرجاع إلى
                  <b>${escapeAttr(r.refund_due_to === r.a_user ? r.a_name : r.b_name)}</b>.
                </p>
              </div>
              <button class="btn" style="margin-top:12px" data-refunded="${escapeAttr(r.id)}">
                سجّل الإرجاع
              </button>`
            : `<p class="tiny muted" style="margin-top:10px">${word('release', r.state)}</p>`}
          </div>`).join('')}

      <div class="panel tinted accent" style="margin-top:14px">
        <p style="margin:0;font-size:14px;line-height:1.85">
          بعد التبادل يخرج الطرفان من حماية التطبيق: لا فلترة للرسائل، ولا مكتب،
          ولا سحب إذن. راجع المحادثة والبلاغات قبل الموافقة.
        </p>
      </div>
    </div>
  </div>`;
};

async function loadReleases() {
  try { state.releases = await state.db.adminReleases(state.releaseFilter || 'pending'); }
  catch (error) { state.releases = { rows: [] }; toast(error.message); }
}

// ── the audit trail ───────────────────────────────────────────────────

screens['admin-audit'] = () => {
  const rows = state.audit;
  return `
  <div class="screen desk-shell">
    ${deskTop('السجلّ')}
    ${deskNav('admin-audit')}
    <div class="desk-body">

      <p class="eyebrow">المراجعون</p>
      <div class="panel tight">
        ${!state.reviewers ? '<p class="muted tiny" style="margin:0">…</p>'
          : state.reviewers.map((r) => `
            <div class="line-item" style="align-items:center">
              <div style="flex:1;min-width:0">
                <div style="font-size:15px" dir="ltr">${escapeAttr(r.email)}</div>
                <div class="tiny muted">
                  ${r.decisions} قرار
                  ${r.last_decision ? ` · آخرها ${
                    new Date(r.last_decision).toLocaleDateString('ar')}` : ''}
                  ${r.active ? '' : ' · موقوف'}
                </div>
              </div>
              ${r.is_me ? '<span class="badge photo">أنت</span>' : ''}
            </div>`).join('')}
      </div>
      <p class="note">
        تُمنح الصلاحية وتُسحب من محرّر SQL فقط. لا يستطيع مراجع أن يمنح نفسه
        أو غيره، ولا أن يوقف زميلاً من داخل التطبيق.
      </p>

      <p class="eyebrow" style="margin-top:22px">عناوين محظورة</p>
      <div class="panel tight">
        <p class="tiny muted" style="margin:0 0 10px;line-height:1.85">
          حظر الحساب وحده لا يكفي: من حُظر يسجّل من جديد ببريد آخر خلال دقيقتين.
          حظر العنوان يبقى بعد إغلاق الحساب.
        </p>
        <label class="field" style="margin-bottom:8px">
          <span>البريد</span>
          <input type="email" id="ban-email" dir="ltr" placeholder="someone@example.com">
        </label>
        <label class="field" style="margin-bottom:8px">
          <span>السبب</span>
          <input type="text" id="ban-reason" placeholder="طلب مالاً، ملف مزيّف…">
        </label>
        <button class="btn" id="ban-submit">حظر هذا البريد</button>
        <div id="ban-error"></div>

        ${(state.bannedEmails || []).length ? `
          <hr class="rule">
          ${state.bannedEmails.map((b) => `
            <div class="line-item" style="align-items:center">
              <div style="flex:1;min-width:0">
                <div style="font-size:14px" dir="ltr">${escapeAttr(b.email)}</div>
                <div class="tiny muted">${escapeAttr(b.reason)}${
                  b.banned_by ? ` · ${escapeAttr(b.banned_by)}` : ''}</div>
              </div>
              <button class="btn quiet" style="width:auto"
                      data-unban="${escapeAttr(b.email)}">رفع الحظر</button>
            </div>`).join('')}` : ''}
      </div>
      <p class="note">
        رفع الحظر يسمح باستخدام العنوان من جديد، ولا يُعيد فتح الحساب القديم.
      </p>

      <p class="eyebrow" style="margin-top:22px">آخر ما جرى</p>
      ${!rows ? `<div class="panel"><p class="muted" style="margin:0">جارٍ التحميل…</p></div>`
        : rows.length === 0
        ? `<div class="panel"><p class="muted" style="margin:0">لا شيء بعد.</p></div>`
        : `<div class="panel tight">
            ${rows.map((e) => `
              <div class="line-item" style="align-items:baseline">
                <span class="tiny muted" style="min-width:92px">${
                  new Date(e.at).toLocaleString('ar', {
                    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                <span style="flex:1;font-size:14px;line-height:1.8">
                  <b>${escapeAttr(e.who || 'مراجع')}</b>
                  ${e.kind === 'access'
                    ? `فتح ملف ${escapeAttr(e.subject || '—')}`
                    : `${escapeAttr(e.detail || e.what)}${
                        e.subject ? ` — ${escapeAttr(e.subject)}` : ''}`}
                </span>
              </div>`).join('')}
          </div>`}

      <div class="panel tinted accent" style="margin-top:14px">
        <p style="margin:0;font-size:14px;line-height:1.85">
          فتح ملف يُسجَّل كما يُسجَّل القرار. مراجع يتصفّح الملفات دون سبب هو
          الخرق الذي يقع فعلاً، وهذا السجلّ هو ما يجعله مرئياً.
        </p>
      </div>
    </div>
  </div>`;
};

function wireBanForm() {
  const button = document.getElementById('ban-submit');
  const errorBox = document.getElementById('ban-error');
  if (!button || !state.db) return;

  button.addEventListener('click', async () => {
    const email = document.getElementById('ban-email').value.trim();
    const reason = document.getElementById('ban-reason').value.trim() || 'reviewed';

    const fail = (message) => {
      errorBox.innerHTML = `<div class="banner warn" style="margin:10px 0">${message}</div>`;
      button.disabled = false;
      button.textContent = 'حظر هذا البريد';
    };
    if (!email.includes('@')) return fail('أدخل بريداً صالحاً.');

    errorBox.innerHTML = '';
    button.disabled = true;
    button.textContent = 'جارٍ الحظر…';
    try {
      const result = await state.db.adminBanEmail(email, reason);
      toast(result.account_closed ? 'حُظر البريد وأُغلق الحساب.' : 'حُظر البريد.');
      invalidate('admin-audit', 'stats');
      state.audit = null;
      render('admin-audit');
    } catch (error) {
      fail(escapeAttr(error.message));
    }
  });
}

async function loadSearch() { /* typed, not fetched on entry */ }

async function loadAdminMeetings() {
  try {
    const [meetings, slots] = await Promise.all([
      state.db.adminMeetings('pending'),
      state.db.openSlots().catch(() => []),
    ]);
    state.adminMeetings = meetings;
    state.slots = Array.isArray(slots) ? slots : [];
  } catch (error) {
    state.adminMeetings = { rows: [] };
    toast(error.message);
  }
}

async function loadAudit() {
  try {
    const [audit, reviewers, banned] = await Promise.all([
      state.db.adminAudit(), state.db.adminReviewers(), state.db.adminBannedEmails(),
    ]);
    state.audit = audit;
    state.reviewers = reviewers;
    state.bannedEmails = banned;
  } catch (error) {
    state.audit = [];
    toast(error.message);
  }
}

async function loadPhotoQueue() {
  try { state.photoQueue = await state.db.adminPhotoQueue(state.photoFilter || 'pending'); }
  catch (error) { state.photoQueue = { rows: [] }; toast(error.message); }
}
async function loadReports() {
  try { state.reports = await state.db.adminReports('open'); }
  catch (error) { state.reports = { rows: [] }; toast(error.message); }
}
async function loadPhotoRequests() {
  try { state.photoRequests = await state.db.adminPhotoRequests(); }
  catch (error) { state.photoRequests = []; toast(error.message); }
}
async function loadStats() {
  try { state.stats = await state.db.adminStats(); }
  catch { state.stats = null; }   // the nav just shows no counts
}
async function loadOverview() {
  try { state.overview = await state.db.adminOverview(); }
  catch (error) { state.overview = null; toast(error.message); }
}
async function loadChats(filter = state.chatFilter || 'flagged') {
  state.chatFilter = filter;
  try { state.chats = await state.db.adminConversations(filter); }
  catch (error) { state.chats = { rows: [], counts: {} }; toast(error.message); }
}
async function loadChatThread() {
  try { state.chat = await state.db.adminConversation(state.openChat); }
  catch (error) { state.chat = null; toast(error.message); }
}
async function loadMember() {
  try { state.member = await state.db.adminMember(state.memberId); }
  catch (error) { state.member = null; toast(error.message); }
}

// --------------------------------------------------------------------- //
// Router
// --------------------------------------------------------------------- //

const TABS = [
  ['today', 'اليوم', ico.tabToday],
  ['photos', 'صوري', ico.tabPhotos],
  ['chat', 'المحادثة', ico.tabChat],
  ['meeting', 'اللقاء', ico.tabMeet],
  ['profile', 'ملفي', ico.tabProfile],
];

const IN_APP = new Set(TABS.map(([id]) => id));
const history = [];

// Changing the password. Reached after ending the other sessions, which
// is the order that matters: an intruder holding a live session is not
// removed by a new password, only by the session ending.
screens.password = () => `
  <div class="screen">
    ${appbar('كلمة المرور')}
    <div class="pad" id="password-form">
      <div class="panel tinted accent">
        <p style="margin:0;font-size:14.5px;line-height:1.85">
          أُنهيت الجلسات الأخرى. اختر كلمة مرور جديدة الآن — من كان داخلاً
          بكلمتك القديمة لن يستطيع العودة.
        </p>
      </div>

      <label class="field" style="margin-top:18px">
        <span>كلمة المرور الجديدة</span>
        <input type="password" name="new-password" dir="ltr" autocomplete="new-password">
      </label>

      <div id="password-error"></div>
      <button class="btn" id="password-submit">حفظ كلمة المرور</button>
      <button class="btn quiet" style="margin-top:10px" data-go="profile">لاحقاً</button>
    </div>
  </div>`;

function wirePassword() {
  const button = document.getElementById('password-submit');
  const errorBox = document.getElementById('password-error');
  if (!button) return;

  button.addEventListener('click', async () => {
    const value = document.querySelector('[name="new-password"]').value;
    const fail = (message) => {
      errorBox.innerHTML = `<div class="banner warn" style="margin:10px 0">${message}</div>`;
      button.disabled = false;
      button.textContent = 'حفظ كلمة المرور';
    };
    if (value.length < 6) return fail('اختر كلمة مرور من ٦ أحرف أو أكثر.');

    errorBox.innerHTML = '';
    button.disabled = true;
    button.textContent = 'جارٍ الحفظ…';
    try {
      await state.db.changePassword(value);
      toast('غُيّرت كلمة المرور.');
      go('profile');
    } catch (error) {
      fail(escapeAttr(error.message));
    }
  });
}

// A banned account. Shown instead of the app rather than letting someone
// wander a product that will refuse everything they try — and without
// saying which of their details is the problem, since that is the thing
// they would change.
screens.closed = () => `
  <div class="screen pad" style="padding-top:64px">
    <div class="center">${star(26, 'var(--muted)')}</div>
    <h3 class="hd" style="text-align:center;margin-top:16px">هذا الحساب مغلق</h3>
    <p class="body" style="text-align:center;font-size:15px;color:var(--ink-soft)">
      لم يعد بإمكانك استخدام نصيب بهذا الحساب. إن كنت ترى أن هذا خطأ،
      راسل الدعم.
    </p>
    <button class="btn ghost" style="margin-top:20px" data-signout>خروج</button>
  </div>`;

/**
 * "Someone else signed in."
 *
 * Shown once, at the top of whatever screen is open, because a warning on
 * a screen nobody visits is not a warning. The action ends every other
 * session and sends them to change the password — in that order, so the
 * intruder is out before the new password is set rather than after.
 */
function showSessionWarning(others) {
  if (!others?.length || document.getElementById('session-warning')) return;

  const when = new Date(others[0].started_at).toLocaleString('ar', {
    day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit',
  });

  const banner = h(`
    <div class="session-warning" id="session-warning">
      <div style="display:flex;gap:10px;align-items:flex-start">
        ${ico.warn}
        <div style="flex:1;min-width:0">
          <b style="font-size:15px">سُجّل الدخول إلى حسابك من جهاز آخر</b>
          <div class="tiny" style="margin-top:4px;line-height:1.8">${escapeAttr(when)}
            ${others.length > 1 ? ` · و${others.length - 1} مرة أخرى` : ''}</div>
          <div class="btn-row" style="margin-top:10px">
            <button class="btn quiet" data-session-ack>كان أنا</button>
            <button class="btn" data-session-secure>لم أكن أنا</button>
          </div>
        </div>
      </div>
    </div>`);
  document.body.appendChild(banner);
}

// A route with no screen. Reachable from a typo, an old link, or — the
// way it was actually found — a URL from a newer build than the one
// deployed. The router used to return early here, leaving whatever was on
// the page, which on first load is nothing: a white page with no
// explanation, on a site that was working a moment ago.
screens.missing = () => `
  <div class="screen pad" style="padding-top:60px">
    <div class="center">${star(26, 'var(--muted)')}</div>
    <h3 class="hd" style="text-align:center;margin-top:16px">لا توجد هذه الصفحة</h3>
    <p class="body" style="text-align:center;font-size:15px;color:var(--ink-soft)">
      ${escapeAttr(state.missingRoute || '')} ليست شاشة في هذه النسخة.
      قد يكون الرابط من نسخة أحدث مما هو منشور.
    </p>
    <button class="btn" style="margin-top:18px" data-go="welcome">إلى البداية</button>
  </div>`;

function render(name) {
  let build = screens[name];

  if (!build) {
    state.missingRoute = name;
    build = screens.missing;
    name = 'missing';
    console.warn(`[nasib] no screen for "${state.missingRoute}" — is this build older than the link?`);
  }

  // The desk is a different surface, not a skin: the token swap happens
  // on the document so `body` picks up the dark ground too. A reviewer
  // should never have to wonder which side of the glass they are on.
  document.documentElement.dataset.surface = DESK_ROUTES.has(name) ? 'desk' : 'app';

  app.innerHTML = build();
  app.firstElementChild?.classList.add('on');
  window.scrollTo(0, 0);

  // The review desk is not a tab, but it is an in-app screen, and a
  // reviewer who lands on it directly must not be left on a screen with no
  // way out. It keeps the bar, with `ملفي` marked current, because that is
  // where the desk is reached from.
  // The desk has its own navigation — the rail and the back button — and
  // the member tab bar sat on top of its content at console width. A
  // reviewer leaves the desk by the back button or the last rail entry.
  const inApp = IN_APP.has(name) || name === 'admin';
  if (inApp) state.admitted = true;
  tabbar.classList.toggle('on', state.admitted && inApp && !DESK_ROUTES.has(name));
  tabbar.style.setProperty('--tabs', String(TABS.length));
  tabbar.innerHTML = TABS.map(([id, label, icon]) => `
    <button data-tab="${id}" aria-current="${
      id === name || (name === 'admin' && id === 'profile')}">${icon}<span>${label}</span></button>`).join('');

  if (name === 'apply') wireApply();
  if (name === 'camera') wireCamera();
  if (name === 'chat') wireChat();
  if (name === 'profile') wireProfile();
  if (name === 'login' || name === 'staff') wireLogin();
  if (name === 'password') wirePassword();

  // Screens that need a round trip paint twice: once from whatever is in
  // `state` (a skeleton, or the previous read) and again when the data
  // lands. A screen that waits for the network before drawing anything
  // reads as a broken tap on a slow connection.
  if (name === 'profile') fetchOnce('profile', loadProfile);
  if (name === 'admin') fetchOnce('admin', loadQueue);
  if (name === 'desk') fetchOnce('desk', loadOverview);
  if (name === 'admin-chats') {
    fetchOnce('chats', loadChats, 'admin-chats');
    if (state.openChat) fetchOnce(`thread:${state.openChat}`, loadChatThread, 'admin-chats');
  }
  if (name === 'today') fetchOnce('today', state.db ? loadSlate : loadMembers);
  if (name === 'admin-photos') fetchOnce('admin-photos', loadPhotoQueue);
  if (name === 'admin-requests') fetchOnce('admin-requests', loadPhotoRequests);
  if (name === 'admin-reports') fetchOnce('admin-reports', loadReports);
  if (name === 'admin-releases') fetchOnce('admin-releases', loadReleases);
  if (name === 'admin-meetings') fetchOnce('admin-meetings', loadAdminMeetings);
  if (name === 'admin-audit') fetchOnce('admin-audit', loadAudit);
  if (name === 'admin-search') wireSearch();
  if (name === 'admin') wireDeck();
  if (name === 'search') { fetchOnce('search', loadSearchGate); wireSearchScreen(); }
  if (name === 'membership') fetchOnce('membership', loadMembership);
  if (name === 'admirers') fetchOnce('admirers', loadAdmirers);
  if (name === 'admin-audit') wireBanForm();
  if (name === 'member') fetchOnce('member', loadMember);
  if (name === 'photos') fetchOnce('photos', loadMyPhotos);
  if (name === 'meeting') fetchOnce('meeting', loadMeetings);
  if (name === 'chat') {
    fetchOnce('chat', loadMatches);
    if (state.openMatch) fetchOnce(`thread:${state.openMatch}`, loadThread, 'chat');
  }

  // The desk's nav shows counts on every one of its screens, so the
  // numbers are fetched once and shared rather than per screen.
  if (name.startsWith('admin') || name === 'member') fetchOnce('stats', loadStats);

  // Photos for any veiled cell on the page. Inlined rather than linked —
  // see photoDataUrl for why the signed URL cannot go straight into src.
  if (state.db) {
    for (const img of document.querySelectorAll('img[data-signed]:not([src])')) {
      state.db.photoDataUrl(img.dataset.signed)
        .then((url) => { if (url) img.src = url; })
        .catch(() => {});
    }
  }
}

/**
 * Fetch a screen's data, at most once every FRESH_MS, then repaint it.
 *
 * The guard is a record of *having fetched*, not a truthiness test on the
 * result. That distinction cost a live site: the profile screen guarded
 * on `!state.profile`, and `my_profile()` returns null for a visitor who
 * has not applied. Null is falsy, so the guard never closed — every
 * render started a fetch, every fetch triggered a render, and the screen
 * sat on "loading…" issuing about five requests a second at the database.
 *
 * Caching it for the whole session was the opposite mistake, and it
 * showed the same way: a reviewer approved a photo and the member's own
 * screen went on saying "قيد المراجعة", because it had read that answer
 * once and would never read it again. Almost everything here is changed
 * by somebody else — a reviewer, the other party, an admission — so an
 * answer held forever is an answer that goes wrong.
 *
 * A minute is long enough to stop the render-fetch loop this guard exists
 * for, and short enough that returning to a screen shows what changed.
 *
 * `screen` is separate from `key` because one screen can have several
 * keys: the chat thread is keyed by match id, and repainting "chat" is
 * not the same as repainting "thread:abc123". Without it the thread
 * loaded and never appeared.
 */
const FRESH_MS = 60_000;
const fetched = new Map();

function fetchOnce(key, load, screen = key) {
  if (!state.db) return;
  const at = fetched.get(key);
  if (at && Date.now() - at < FRESH_MS) return;
  fetched.set(key, Date.now());

  load()
    .catch((error) => console.warn(`[nasib] ${key}:`, error.message))
    .finally(() => {
      // `stats` is shared across the desk rather than being a screen of
      // its own, so it repaints whatever is showing.
      if (key === 'stats') {
        if (current().startsWith('admin') || current() === 'member') render(current());
      } else if (current() === screen) {
        render(screen);
      }
    });
}

/** Mark a screen's data stale, so the next visit fetches it again. */
function invalidate(...keys) {
  for (const key of keys) fetched.delete(key);
}

// Coming back to the tab is the moment someone expects to see what
// changed while they were away — a decision, a reply, an approval.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  fetched.clear();
  render(current());
});

/**
 * Keep the open screen current while someone is looking at it.
 *
 * Almost everything here changes because of somebody else: a reviewer
 * approves a photo, the other party replies, an application is admitted.
 * Without this, the only way to see any of it is to reload — which is
 * what everyone has been doing.
 *
 * Polling rather than a realtime subscription, deliberately. The tables
 * a member cares about are not readable by the client at all — `photos`
 * has its grants revoked, and everything arrives through a definer
 * function — so a change feed would deliver nothing. A request every
 * twenty seconds, only while the tab is visible, is a rounding error
 * against what a single photo costs.
 *
 * Three things it must not do, which is most of the code below: refetch
 * while someone is typing, replace a screen out from under a tap, or run
 * in a background tab.
 */
const POLL_MS = 20_000;

setInterval(() => {
  if (!state.db) return;
  if (document.visibilityState !== 'visible') return;

  // Typing is the interaction a repaint ruins. The search field keeps its
  // own focus, but a half-written message or an unsent application is
  // lost for good.
  const active = document.activeElement;
  if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;

  // The lightbox and the application form both hold state that only
  // exists on the page.
  if (document.querySelector('.lightbox') || current() === 'apply') return;

  // Re-claiming the session on each poll is what makes "one login at a
  // time" visible to the tab that lost: without it, a displaced session
  // sits there looking fine until it tries to write something.
  if (state.email) {
    state.db.registerSession()
      .then((session) => {
        if (session?.current === false) {
          toast('سُجّل الدخول من جهاز آخر. انتهت هذه الجلسة.');
          return state.db.signOut().finally(() => go('login', { replace: true }));
        }
        showSessionWarning(session?.others);
      })
      .catch(() => {});
  }

  // Expiring the current screen's keys is enough: render() re-fetches
  // whatever it finds stale, and repaints only when the answer arrives.
  for (const key of [...fetched.keys()]) {
    if (key === current() || key === 'stats' || key.startsWith('thread:')) {
      fetched.delete(key);
    }
  }
  render(current());
}, POLL_MS);

const current = () => location.hash.slice(2) || 'welcome';

function go(name, { replace = false } = {}) {
  if (!replace && current() !== name) history.push(current());
  location.hash = `#/${name}`;
}

window.addEventListener('hashchange', () => render(location.hash.slice(2) || 'welcome'));

// --------------------------------------------------------------------- //
// The application
// --------------------------------------------------------------------- //

/** Read the form into the shape apply_for_membership expects. */
function readApplication(form) {
  const value = (name) => form.querySelector(`[name="${name}"]`)?.value.trim() ?? '';
  const chosen = (name) => form
    .querySelector(`[data-field="${name}"] .chip[aria-pressed="true"]`)?.dataset.value ?? '';

  return {
    display_name: value('display_name'),
    date_of_birth: value('date_of_birth'),
    city: value('city'),
    phone: value('phone').replace(/[^\d+]/g, ''),
    country_code: 'PS',
    gender: chosen('gender'),
    marital_status: chosen('marital_status'),
    practice_level: chosen('practice_level'),
    timeline: chosen('timeline'),
    living_after_marriage: chosen('living_after_marriage'),
    family_aware: chosen('family_aware') === 'true',
    willing_to_relocate: chosen('willing_to_relocate') === 'true',
  };
}

/* Checked here only so the applicant is not made to wait for a round trip
   to be told their name is empty. Every one of these is also enforced in
   the database, which is the copy that counts. */
function firstProblem(application) {
  if (!application.display_name) return 'اكتب الاسم الذي تحبّ أن يظهر.';
  if (!application.date_of_birth) return 'أدخل تاريخ ميلادك.';
  if (application.date_of_birth > eighteenYearsAgo()) return 'هذا التطبيق لمن أتمّ الثامنة عشرة.';
  return '';
}

function wireApply() {
  const form = document.getElementById('apply-form');
  const button = document.getElementById('apply-submit');
  const errorBox = document.getElementById('apply-error');
  if (!form || !button) return;

  const warn = (message) => {
    errorBox.innerHTML = `<div class="banner warn" style="margin-top:16px">${message}</div>`;
  };

  /** Send the application and move on. Assumes the account step is done. */
  const save = async (application) => {
    if (state.saving) return;
    state.saving = true;

    try {
      const row = await state.db.apply(application);
      // Keep what was typed as well as what came back: the function
      // returns the stored status, not the whole form, and re-rendering
      // the screen from the response alone would blank half the fields.
      state.application = { ...application, ...(row || {}) };
      invalidate('profile', 'today');
      go('camera');
    } catch (error) {
      // The database's own sentence, when it has one — the 18+ refusal is
      // already written for the applicant, and rewording it here would
      // only make the two copies disagree.
      warn(escapeAttr(error.message || 'تعذّر الحفظ. حاول مرة أخرى.'));
      button.disabled = false;
      button.textContent = 'حفظ ومتابعة إلى التحقق بالكاميرا';
    } finally {
      state.saving = false;
    }
  };

  /**
   * Ask for an account, here, at the end.
   *
   * An application needs a credential — without one it is attached to a
   * browser and nobody can return to it, which the database enforces.
   * But asking at the top of the form is asking someone to commit before
   * they have seen anything, and this is a product people are cautious
   * about joining. So the form comes first and the account is the last
   * step, with the answers already filled in behind it.
   */
  const askForAccount = (application) => {
    errorBox.innerHTML = `
      <div class="panel tinted accent" style="margin-top:18px" id="apply-account">
        <p class="eyebrow">خطوة أخيرة</p>
        <p style="margin:0 0 12px;font-size:14px;line-height:1.85">
          أنشئ حساباً لتعود إلى طلبك من أي جهاز. لن نعرض بريدك لأحد، ولا نستخدمه
          إلا لدخولك.
        </p>
        <label class="field" style="margin-bottom:10px">
          <span>البريد الإلكتروني</span>
          <input type="email" name="apply-email" dir="ltr" inputmode="email"
                 autocomplete="username" placeholder="you@example.com">
        </label>
        <label class="field" style="margin-bottom:10px">
          <span>كلمة المرور</span>
          <input type="password" name="apply-password" dir="ltr" autocomplete="new-password">
        </label>
        <div id="apply-account-error"></div>
        <button class="btn" id="apply-account-submit">أنشئ الحساب وأرسل الطلب</button>
        <p class="note" style="text-align:center;margin-top:8px">
          لديك حساب؟ <a href="#/login" style="color:var(--teal)">سجّل الدخول</a>
        </p>
      </div>`;

    document.getElementById('apply-account').scrollIntoView({ behavior: 'smooth', block: 'center' });

    const accountButton = document.getElementById('apply-account-submit');
    const accountError = document.getElementById('apply-account-error');

    accountButton.addEventListener('click', async () => {
      const email = document.querySelector('[name="apply-email"]').value.trim();
      const password = document.querySelector('[name="apply-password"]').value;

      const fail = (message) => {
        accountError.innerHTML = `<div class="banner warn" style="margin:10px 0">${message}</div>`;
        accountButton.disabled = false;
        accountButton.textContent = 'أنشئ الحساب وأرسل الطلب';
      };

      if (!email || !password) return fail('أدخل البريد وكلمة المرور.');
      if (password.length < 6) return fail('اختر كلمة مرور من ٦ أحرف أو أكثر.');

      accountError.innerHTML = '';
      accountButton.disabled = true;
      accountButton.textContent = 'جارٍ الإنشاء…';

      try {
        // Linked to the session already in hand rather than signed up
        // fresh, so anything this browser has done so far stays on the
        // same account.
        await state.db.linkEmailPassword(email, password);
        state.email = email;
        await save(application);
      } catch (error) {
        fail(escapeAttr(error.message));
      }
    });
  };

  button.addEventListener('click', async () => {
    const application = readApplication(form);
    const problem = firstProblem(application);
    if (problem) return warn(problem);
    errorBox.innerHTML = '';

    // Without a backend the form is a demonstration; keep the answers in
    // memory so returning to the screen does not wipe them, and move on.
    if (!state.db) {
      state.application = application;
      return go('camera');
    }

    if (!state.email) return askForAccount(application);

    button.disabled = true;
    button.textContent = 'جارٍ الحفظ…';
    await save(application);
  });
}

// --------------------------------------------------------------------- //
// The camera screen
// --------------------------------------------------------------------- //

function wireCamera() {
  const startBtn = document.getElementById('camera-start');
  startBtn?.addEventListener('click', startCapture, { once: true });
}

async function startCapture() {
  const body = document.getElementById('camera-body');
  const ring = document.getElementById('ring');
  const video = document.getElementById('cam');
  const canvas = document.getElementById('cam-canvas');
  const track = document.getElementById('ring-track');
  const fg = track.querySelector('.fg');

  const challenge = issueChallenge();

  body.innerHTML = `
    <div class="dots" id="dots">
      ${challenge.steps.map(() => '<i></i>').join('')}
    </div>
    <div class="center">${ring.outerHTML}</div>
    <p class="instruction" id="instruction">…</p>
    <div id="digits-slot"></div>
    <p class="note" style="text-align:center;margin-top:24px">أبقِ وجهك داخل الدائرة</p>
    <div id="capture-note"></div>`;

  // The ring was moved by the innerHTML above, so take the new nodes.
  const ring2 = document.getElementById('ring');
  const video2 = document.getElementById('cam');
  const canvas2 = document.getElementById('cam-canvas');
  const track2 = document.getElementById('ring-track');
  const fg2 = track2.querySelector('.fg');
  const dots = document.getElementById('dots');
  const instruction = document.getElementById('instruction');

  const CIRCUM = 295.3;
  const paint = ({ hold, coaching }) => {
    fg2.style.strokeDashoffset = String(CIRCUM * (1 - hold));
    track2.classList.toggle('warn', Boolean(coaching));
    instruction.classList.toggle('coach', Boolean(coaching));
    instruction.textContent = coaching ?? stepLabel(capture.currentStep ?? 'look_straight');
    if (!coaching) showDigits(capture.currentStep);
  };

  const showDigits = (step) => {
    const slot = document.getElementById('digits-slot');
    if (!slot) return;
    if (step === 'speak_digits' && challenge.digits) {
      if (!slot.dataset.filled) {
        slot.dataset.filled = '1';
        slot.innerHTML = `
          <p class="digits">${arabicDigits(challenge.digits)}</p>
          <div class="center">
            <button class="btn quiet" id="cannot-speak" style="width:auto">لا أستطيع النطق الآن</button>
          </div>`;
        document.getElementById('cannot-speak').addEventListener('click', () => capture.skip());
      }
    } else if (slot.dataset.filled) {
      slot.dataset.filled = '';
      slot.innerHTML = '';
    }
  };

  const capture = new Capture({
    video: video2,
    canvas: canvas2,
    challenge,
    onProgress: paint,
    onStep: (index) => {
      [...dots.children].forEach((d, i) => {
        d.className = i < index ? 'done' : i === index ? 'now' : '';
      });
    },
    onDone: (result) => showVerdict(result),
  });

  state.capture = capture;

  try {
    const { faceDetection } = await capture.start();
    ring2.classList.add('live');
    [...dots.children][0].className = 'now';

    if (!faceDetection) {
      document.getElementById('capture-note').innerHTML = `
        <p class="note" style="text-align:center">
          متصفحك لا يوفّر كشف الوجه، فنعتمد على تغيّر الصورة بين اللقطات.
        </p>`;
    }
  } catch (err) {
    body.innerHTML = `
      <div class="center" style="min-height:50vh;text-align:center">
        <div>
          <div class="verdict-icon">
            <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="var(--caution)"
                 stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/>
              <path d="M12 8v5M12 16h.01"/></svg>
          </div>
          <h3 class="hd">لم نتمكّن من فتح الكاميرا</h3>
          <p class="body" style="color:var(--ink-soft)">
            ${err?.name === 'NotAllowedError'
              ? 'لم تُمنح الصفحة إذن الكاميرا. اسمح به من إعدادات المتصفح وأعد المحاولة.'
              : 'المتصفح لم يعطِنا كاميرا. جرّب متصفحاً آخر، أو افتح الصفحة عبر https.'}
          </p>
          <button class="btn" data-go="review" style="margin-top:12px">تخطَّ هذه الخطوة</button>
        </div>
      </div>`;
  }
}

function showVerdict({ verdict, reason, median }) {
  const body = document.getElementById('camera-body');
  if (!body) return;

  const shown = {
    matched: {
      colour: 'var(--verified)',
      title: 'تمّت الحركات بنجاح',
      body: 'الوجه أمامك حيّ ويتحرّك، والترتيب نُفّذ كما طُلب. '
          + 'المطابقة مع الهوية والصور تتم على الخادم، وليست جزءاً من نسخة الويب.',
    },
    under_review: {
      colour: 'var(--caution)',
      title: 'نراجع النتيجة',
      body: 'الصورة لم تتغيّر تقريباً بين اللقطات. هذا يحدث مع بثّ ثابت أو صورة '
          + 'موضوعة أمام العدسة — وأحياناً مع شخص ساكن تماماً، ولهذا نراجعها بدل رفضها.',
    },
    retake: {
      colour: 'var(--caution)',
      title: 'لم تكتمل المحاولة',
      body: 'الجلسة تنتهي بعد تسعين ثانية، وتنتهي أيضاً إن لم تصلنا صورة من الكاميرا. '
          + 'أعد المحاولة، وستحصل على ترتيب جديد.',
    },
  }[verdict] ?? { colour: 'var(--caution)', title: 'أعد المحاولة', body: '' };

  body.innerHTML = `
    <div class="center" style="min-height:55vh;text-align:center">
      <div>
        <div class="verdict-icon">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="${shown.colour}"
               stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9"/><path d="m8.2 12.2 2.6 2.6 5-5.6"/>
          </svg>
        </div>
        <h3 class="hd">${shown.title}</h3>
        <p class="body" style="color:var(--ink-soft)">${shown.body}</p>
        ${median !== undefined ? `
          <p class="note">تغيّر الصورة بين اللقطات: ${median.toFixed(2)}${
            reason === 'unnaturally_consistent' ? ' — أقل من الحد المتوقع لوجه حيّ' : ''}</p>` : ''}
        <button class="btn" style="margin-top:18px" data-go="review">متابعة</button>
        <button class="btn quiet" data-go="camera">إعادة المحاولة</button>
      </div>
    </div>`;
}

// --------------------------------------------------------------------- //
// The chat screen
// --------------------------------------------------------------------- //

function paintThread() {
  const thread = document.getElementById('thread');
  if (!thread) return;

  // Live messages arrive already redacted — the trigger did it on the way
  // in, and `redacted` says so. Running the local rules over them again
  // would be redacting redacted text. The local pass stays for the
  // fixtures, and for the composer, where it earns its keep by warning
  // before anything is sent.
  const messages = state.db
    ? (state.thread?.messages || []).map((m) => ({
        from: m.mine ? 'me' : 'them', body: m.body, serverRedacted: m.redacted,
        kinds: Object.keys(m.flags || {}),
      }))
    : state.messages;

  const unlocked = state.db ? !!state.thread?.contact_unlocked : state.contactUnlocked;

  thread.innerHTML = messages.map((m) => {
    if (m.serverRedacted !== undefined) {
      return `
        <div class="bubble ${m.from === 'me' ? 'me' : 'them'}">
          ${escapeAttr(m.body)}
          ${m.serverRedacted
            ? `<small>حُذفت بيانات شخصية من هذه الرسالة</small>` : ''}
        </div>`;
    }
    const r = redact(m.body, { unlocked });
    return `
      <div class="bubble ${m.from === 'me' ? 'me' : 'them'}">
        ${r.text}
        ${r.redacted ? `<small>حُذف ${r.summary} من هذه الرسالة</small>` : ''}
      </div>`;
  }).join('');

  thread.scrollTop = thread.scrollHeight;
}

function wireChat() {
  paintThread();

  const draft = document.getElementById('draft');
  const send = document.getElementById('send');
  const warning = document.getElementById('composer-warning');

  // The chat screen is a list of conversations until one is open, and the
  // list has no composer. Without this the wiring threw on a null and
  // aborted the render, leaving the list stuck on "loading…" — a screen
  // broken by the code meant to make another screen work.
  if (!draft || !send || !warning) return;

  const check = () => {
    draft.style.height = 'auto';
    draft.style.height = `${Math.min(draft.scrollHeight, 110)}px`;

    const unlocked = state.db ? !!state.thread?.contact_unlocked : state.contactUnlocked;
    const r = redact(draft.value, { unlocked });
    send.disabled = draft.value.trim() === '' || r.redacted;

    if (!r.redacted) { warning.innerHTML = ''; return; }

    // Name what was found. "Your message contains an address" is something
    // the sender can act on; "blocked" reads as a fault in the app.
    warning.innerHTML = `
      <div class="pad" style="padding-bottom:0">
        <div class="banner warn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.7" stroke-linecap="round" style="flex:none;margin-top:2px">
            <circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
          <div>
            <b>رسالتك تحتوي على ${r.summary}.</b><br>
            ${r.found.includes('identifier')
              ? 'أرقام الهوية والحسابات البنكية لا تُرسل هنا في أي مرحلة.'
              : 'لا تُرسل بيانات شخصية قبل المكالمة المرئية. معظم عمليات النصب تبدأ بالانتقال إلى تطبيق آخر.'}
          </div>
        </div>
      </div>`;
  };

  draft.addEventListener('input', check);
  check();

  send.addEventListener('click', async () => {
    const body = draft.value.trim();
    if (!body) return;

    if (!state.db) {
      state.messages.push({ from: 'me', body });
      draft.value = '';
      check();
      return paintThread();
    }

    send.disabled = true;
    try {
      await state.db.sendMessage(state.openMatch, body);
      draft.value = '';
      // Re-read rather than appending what was typed: the server may have
      // altered it, and showing the sender their original while the
      // recipient sees a redacted copy is the one outcome worth avoiding.
      state.thread = await state.db.matchThread(state.openMatch);
      check();
      paintThread();
    } catch (error) {
      toast(error.message);
    } finally {
      send.disabled = false;
    }
  });
}

// --------------------------------------------------------------------- //
// One delegated listener for everything the screens declare
// --------------------------------------------------------------------- //

document.addEventListener('click', async (event) => {
  const el = event.target.closest('[data-go], [data-back], [data-tab], .chip, [data-decide], [data-request], [data-revoke], [data-decide-photo], [data-queue], [data-decide-user], [data-del-photo], [data-copy], [data-signout], [data-login-mode], [data-search-value], [data-member], [data-membership], [data-chat], [data-chat-filter], [data-deck], [data-queue-view], [data-photo-action], [data-photo-filter], [data-schedule], [data-unban], [data-release-filter], [data-release], [data-paid], [data-refunded], [data-report], [data-screen-request], [data-open-match], [data-cancel-meeting], [data-swipe], [data-close-overlay], [data-bingo], [data-cancel-release], [data-session-ack], [data-session-secure], img[data-zoom]');
  if (!el) return;

  if (el.dataset.searchValue !== undefined) {
    const group = el.closest('[data-search-group]')?.dataset.searchGroup;
    if (group) {
      state.searchFilters = { ...state.searchFilters, [group]: el.dataset.searchValue || undefined };
      for (const sib of el.parentElement.querySelectorAll('.chip')) {
        sib.setAttribute('aria-pressed', String(sib === el));
      }
    }
    return;
  }

  if (el.dataset.loginMode) {
    state.loginMode = el.dataset.loginMode;
    return render('login');
  }

  if (el.hasAttribute('data-session-ack')) {
    document.getElementById('session-warning')?.remove();
    try { await state.db.acknowledgeSessions(); } catch { /* it reappears next time */ }
    return;
  }

  if (el.hasAttribute('data-session-secure')) {
    el.disabled = true;
    try {
      const result = await state.db.signOutOthers();
      document.getElementById('session-warning')?.remove();
      state.sessions = await state.db.mySessions();
      toast(result.ended
        ? `أُنهيت ${result.ended} جلسة أخرى. غيّر كلمة المرور الآن.`
        : 'لا توجد جلسات أخرى.');
      invalidate('profile');
      return go('password');
    } catch (error) {
      el.disabled = false;
      return toast(error.message);
    }
  }

  if (el.hasAttribute('data-signout')) {
    await state.db?.signOut();
    // Everything in hand was read as the reviewer. Dropping it here
    // rather than on the next render stops a signed-out screen showing
    // the queue it was holding.
    Object.assign(state, {
      isAdmin: false, email: '', userId: '',
      profile: null, queue: null, members: null, application: null,
    });
    invalidate('profile', 'today', 'admin');
    toast('خرجت من حساب المراجعة.');
    return go('welcome', { replace: true });
  }

  if (el.dataset.copy) {
    // A UUID typed by hand is a UUID typed wrong. navigator.clipboard
    // needs a secure origin and a user gesture — it has both here — but
    // it still fails on older browsers and when the permission is denied,
    // so fall back to selecting the text for a manual copy rather than
    // leaving the tap doing nothing.
    try {
      await navigator.clipboard.writeText(el.dataset.copy);
      toast('نُسخ السطر.');
    } catch {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      toast('حدّدنا السطر — انسخه يدوياً.');
    }
    return;
  }

  if (el.dataset.go) return go(el.dataset.go);
  if (el.dataset.tab) return go(el.dataset.tab);

  // ── the review desk ──────────────────────────────────────────────────
  // A photo in a 96-pixel cell cannot be judged, by its owner or by a
  // reviewer. Tapping opens it full-screen — reusing the image already
  // loaded, so there is no second request and nothing new to authorise.
  if (el.matches('img[data-zoom]') || el.closest('img[data-zoom]')) {
    const img = el.matches('img[data-zoom]') ? el : el.closest('img[data-zoom]');
    if (!img.getAttribute('src')) return;      // still loading
    openLightbox(img.src, img.alt);
    return;
  }

  if (el.hasAttribute('data-bingo')) {
    // Asks twice. Pressing Bingo starts something that ends with two
    // people's numbers in each other's hands and money changing hands;
    // it should not be a thing a thumb does by accident.
    if (el.dataset.confirming !== 'yes') {
      el.dataset.confirming = 'yes';
      el.textContent = 'اضغط مرة أخرى للتأكيد';
      return;
    }
    el.disabled = true;
    try {
      await state.db.pressBingo(state.openMatch);
      state.release = await state.db.myRelease(state.openMatch);
      toast('سُجّل طلبك.');
      return render('chat');
    } catch (error) {
      el.disabled = false;
      return toast(error.message);
    }
  }

  if (el.hasAttribute('data-cancel-release')) {
    try {
      await state.db.cancelRelease(state.openMatch);
      state.release = await state.db.myRelease(state.openMatch);
      toast('أُلغي الطلب.');
      return render('chat');
    } catch (error) {
      return toast(error.message);
    }
  }

  if (el.dataset.openMatch) {
    state.openMatch = el.dataset.openMatch;
    state.thread = null;
    state.release = null;
    document.querySelector('.match-overlay')?.remove();

    // `go` when the hash is elsewhere, `render` when it is already here.
    // Painting a screen without moving the hash leaves current() naming
    // the old one, and every fetch that finishes afterwards declines to
    // repaint because the screen it fetched for "is not showing" — which
    // is how this screen sat on "loading…" forever when it was opened
    // from the match overlay.
    if (current() !== 'chat') return go('chat');
    return render('chat');
  }

  if (el.dataset.cancelMeeting) {
    // Cancelling is not undoable and the other side is told, so it asks.
    // A confirm() would freeze the extension that drives these tests, and
    // a second tap is a clearer commitment anyway.
    if (el.dataset.confirming !== 'yes') {
      el.dataset.confirming = 'yes';
      el.textContent = 'اضغط مرة أخرى للتأكيد';
      return;
    }
    try {
      await state.db.rpc('cancel_meeting', { p_meeting_id: el.dataset.cancelMeeting });
      invalidate('meeting');
      state.meetings = null;
      toast('أُلغي اللقاء، وأُبلغ الطرف الآخر.');
      return render('meeting');
    } catch (error) {
      return toast(error.message);
    }
  }

  // ── the rest of the desk ─────────────────────────────────────────────
  if (el.dataset.member) {
    state.member = null;
    state.memberId = el.dataset.member;
    invalidate('member');
    return go('member');
  }

  if (el.dataset.photoFilter) {
    state.photoFilter = el.dataset.photoFilter;
    state.photoQueue = null;
    invalidate('admin-photos');
    return render('admin-photos');
  }

  if (el.dataset.membership) {
    const level = el.dataset.membership;
    const months = Number(document.getElementById('membership-months')?.value || 1);
    el.disabled = true;
    try {
      const set = await state.db.adminSetMembership(el.dataset.id, level, months);
      // Repaint from the row's own values rather than from what was
      // asked for: extending an existing paid tier moves the end date,
      // and the reviewer should see the date they actually bought.
      if (state.member && state.member.user_id === el.dataset.id) {
        state.member.membership = set?.membership || level;
        state.member.membership_until = set?.membership_until ?? null;
      }
      toast(level === 'basic'
        ? 'أُعيد إلى العضوية الأساسية.'
        : `${TIER_NAMES[level]} لمدة ${months} ${months === 1 ? 'شهر' : 'أشهر'}.`);
      invalidate('member', 'stats');
      return render('member');
    } catch (error) {
      el.disabled = false;
      return toast(error.message);
    }
  }

  if (el.dataset.photoAction) {
    const action = el.dataset.photoAction;

    // Deleting destroys the file. A second tap is the confirmation —
    // confirm() would freeze the browser tools that drive the tests, and
    // is easy to dismiss by reflex anyway.
    if (action === 'delete' && el.dataset.confirming !== 'yes') {
      el.dataset.confirming = 'yes';
      el.textContent = 'تأكيد الحذف';
      return;
    }

    el.disabled = true;
    try {
      const result = await state.db.adminPhotoAction(el.dataset.id, action);
      // Deleting removes the row; the file has to follow, and the
      // function hands back the path precisely so it can.
      if (action === 'delete' && result?.storage_path) {
        await state.db.deleteStorageObject?.(result.storage_path);
      }
      toast(action === 'approve' ? 'اعتُمدت الصورة.'
          : action === 'unapprove' ? 'سُحب الاعتماد — عادت للمراجعة.'
          : 'حُذفت الصورة.');
      invalidate('admin-photos', 'stats', 'member');
      state.photoQueue = null;
      return render('admin-photos');
    } catch (error) {
      el.disabled = false;
      return toast(error.message);
    }
  }

  if (el.dataset.releaseFilter) {
    state.releaseFilter = el.dataset.releaseFilter;
    state.releases = null;
    invalidate('admin-releases');
    return render('admin-releases');
  }

  if (el.dataset.release) {
    el.disabled = true;
    try {
      await state.db.adminDecideRelease(el.dataset.id, el.dataset.release === 'yes');
      toast(el.dataset.release === 'yes' ? 'وُوفق — بانتظار الدفع.' : 'رُفض الطلب.');
      invalidate('admin-releases', 'stats');
      state.releases = null;
      return render('admin-releases');
    } catch (error) {
      el.disabled = false;
      return toast(error.message);
    }
  }

  if (el.dataset.paid) {
    // Read from a field beside the button rather than a prompt(): a
    // modal dialog blocks the page, and a bank reference typed into a
    // browser alert is a bank reference nobody can check afterwards.
    const reference =
      document.getElementById(`ref-${el.dataset.paid}-${el.dataset.user}`)?.value.trim() || '';
    el.disabled = true;
    try {
      const result = await state.db.adminMarkPaid(el.dataset.paid, el.dataset.user, reference || null);
      toast(result.state === 'released' ? 'دفع الطرفان — كُشفت الأرقام.' : 'سُجّل الدفع.');
      invalidate('admin-releases', 'stats');
      state.releases = null;
      return render('admin-releases');
    } catch (error) {
      el.disabled = false;
      return toast(error.message);
    }
  }

  if (el.dataset.refunded) {
    const reference = '';
    try {
      await state.db.adminMarkRefunded(el.dataset.refunded, reference || null);
      toast('سُجّل الإرجاع.');
      invalidate('admin-releases');
      state.releases = null;
      return render('admin-releases');
    } catch (error) {
      return toast(error.message);
    }
  }

  if (el.dataset.unban) {
    try {
      await state.db.adminUnbanEmail(el.dataset.unban);
      toast('رُفع الحظر. الحساب القديم يبقى مغلقاً.');
      invalidate('admin-audit');
      state.audit = null;
      return render('admin-audit');
    } catch (error) {
      return toast(error.message);
    }
  }

  if (el.dataset.schedule) {
    el.disabled = true;
    try {
      await state.db.adminScheduleMeeting(el.dataset.schedule, el.dataset.slot);
      toast('حُدّد موعد اللقاء، وأُبلغ الطرفان.');
      invalidate('admin-meetings', 'stats');
      state.adminMeetings = null;
      return render('admin-meetings');
    } catch (error) {
      el.disabled = false;
      return toast(error.message);
    }
  }

  if (el.dataset.report) {
    el.disabled = true;
    try {
      await state.db.adminResolveReport(el.dataset.id, el.dataset.report);
      toast(el.dataset.report === 'actioned' ? 'سُجّل الإجراء.' : 'أُغلق البلاغ.');
      invalidate('admin-reports', 'stats');
      state.reports = null;
      return render('admin-reports');
    } catch (error) {
      el.disabled = false;
      return toast(error.message);
    }
  }

  if (el.dataset.screenRequest) {
    const allow = el.dataset.screenRequest === 'yes';
    el.disabled = true;
    try {
      await state.db.adminScreenRequest(el.dataset.id, allow);
      toast(allow ? 'مُرّر الطلب إليها.' : 'أُوقف الطلب، ولن تُخطَر به.');
      invalidate('admin-requests', 'stats');
      state.photoRequests = null;
      return render('admin-requests');
    } catch (error) {
      el.disabled = false;
      return toast(error.message);
    }
  }

  if (el.dataset.queue) {
    state.queue = null;
    state.queueFilter = el.dataset.queue;
    invalidate('admin');
    return render('admin');                // the skeleton; the router loads
  }

  if (el.dataset.chatFilter) {
    state.chat = null;
    state.openChat = null;
    invalidate('chats');
    await loadChats(el.dataset.chatFilter);
    return render('admin-chats');
  }

  if (el.dataset.chat) {
    // Opening a thread is the logged act, so it is a deliberate tap and
    // never a side effect of rendering the list.
    state.openChat = el.dataset.chat;
    state.chat = null;
    render('admin-chats');
    invalidate(`thread:${state.openChat}`);
    await loadChatThread();
    if (current() === 'admin-chats') render('admin-chats');
    return;
  }

  if (el.dataset.queueView) {
    state.queueView = el.dataset.queueView;
    return render('admin');
  }

  // ── the review deck ──────────────────────────────────────────────
  if (el.dataset.deck) {
    const card = document.querySelector('#deck .card');
    if (!card) return;
    const id = card.dataset.card;

    if (el.dataset.deck === 'open') {
      state.memberId = id;
      state.member = null;
      invalidate('member');
      return go('member');
    }

    if (id === state.userId) {
      return toast('لا يبتّ المراجع في طلبه.');
    }

    // Rejection asks twice. A swipe is a cheap gesture; being turned
    // away from a marriage platform is not a cheap outcome, and the
    // gesture should not be the only thing between the two.
    if (el.dataset.deck === 'reject' && el.dataset.confirming !== 'yes') {
      el.dataset.confirming = 'yes';
      el.setAttribute('aria-label', 'تأكيد الرفض');
      el.style.background = 'var(--st-crit)';
      el.style.color = '#fff';
      return;
    }

    return decideFromDeck(id, el.dataset.deck === 'admit' ? 'admit' : 'reject');
  }

  if (el.dataset.decideUser) {
    const action = el.dataset.decideUser;
    el.disabled = true;
    try {
      await state.db.adminDecide(el.dataset.id, action);
      toast(action === 'admit' ? 'قُبل الطلب.'
          : action === 'reject' ? 'رُفض الطلب.'
          : 'حُدّد ظهوره.');
      // The directory changes when somebody is admitted, so what is
      // cached about it is now wrong.
      state.members = null;
      state.member = null;
      invalidate('today', 'stats', 'member');

      // From a member's record, stay on it — a reviewer who has just
      // admitted someone usually wants to see the result, not be thrown
      // back to a list.
      if (current() === 'member') {
        await loadMember();
        return render('member');
      }
      await loadQueue();
      return render('admin');
    } catch (error) {
      el.disabled = false;
      return toast(error.message);
    }
  }

  if (el.dataset.delPhoto) {
    try {
      await state.db.deletePhoto(el.dataset.delPhoto);
      await loadProfile();
      toast('حُذفت الصورة.');
      return render('profile');
    } catch (error) {
      return toast(error.message);
    }
  }

  if (el.hasAttribute('data-back')) {
    const previous = history.pop();
    location.hash = `#/${previous || 'welcome'}`;
    return;
  }

  if (el.classList.contains('chip')) {
    for (const sibling of el.parentElement.querySelectorAll('.chip')) {
      sibling.setAttribute('aria-pressed', String(sibling === el));
    }
    return;
  }

  if (el.dataset.swipe || el.dataset.decide) {
    const interested = (el.dataset.swipe || el.dataset.decide) === 'yes';

    if (!state.db) {
      state.candidate += 1;
      toast(interested ? 'سجّلنا اهتمامك.' : 'لن نعرضه عليك مجدداً.');
      return render('today');
    }

    const card = document.getElementById('card');
    card?.classList.add(interested ? 'fly-yes' : 'fly-no');
    el.disabled = true;

    try {
      const result = await state.db.swipe(el.dataset.id, interested);
      // Mark it locally so the next card shows at once: a swipe that
      // waits for a round trip before moving is a swipe that feels broken.
      const hit = (state.slate?.cards || []).find((x) => x.id === el.dataset.id);
      if (hit) hit.decision = interested ? 'interested' : 'declined';
      invalidate('today', 'chat');

      if (result?.matched) {
        state.matches = null;
        return showMatch(result.match_id);
      }
      await new Promise((r) => setTimeout(r, 160));   // let the card leave
      return render('today');
    } catch (error) {
      el.disabled = false;
      card?.classList.remove('fly-yes', 'fly-no');
      return toast(error.message);
    }
  }

  if (el.dataset.request) {
    if (!state.db) return toast('وصل طلبك للإدارة. سيُراجَع قبل أن يصلها.');
    el.disabled = true;
    try {
      await state.db.requestPhotoAccess(el.dataset.request);
      toast('وصل طلبك للإدارة. سيُراجَع قبل أن يصلها.');
    } catch (error) {
      toast(error.message);
    } finally {
      el.disabled = false;
    }
    return;
  }

  if (el.dataset.decidePhoto) {
    const approve = el.dataset.decidePhoto === 'yes';

    if (!state.db) {
      state.requests = state.requests.filter((r) => r.id !== el.dataset.id);
      if (approve) {
        state.grants.push({ id: `g${Date.now()}`, name: 'يوسف', days: 14, views: 0, shots: 0 });
      }
      toast(approve ? 'سمحتِ له برؤية صورك لمدة 14 يوماً.' : 'لم نبلّغه بأي تفصيل.');
      return render('photos');
    }

    el.disabled = true;
    try {
      await state.db.respondToPhotoRequest(el.dataset.id, approve);
      invalidate('photos');
      state.myRequests = null;
      state.myGrants = null;
      toast(approve ? 'سمحتِ له برؤية صورك لمدة 14 يوماً.' : 'لم نبلّغه بأي تفصيل.');
      return render('photos');
    } catch (error) {
      el.disabled = false;
      return toast(error.message);
    }
  }

  if (el.dataset.revoke) {
    if (!state.db) {
      state.grants = state.grants.filter((g) => g.id !== el.dataset.revoke);
      toast('سُحب الإذن فوراً.');
      return render('photos');
    }
    try {
      await state.db.revokePhotoAccess(el.dataset.revoke);
      invalidate('photos');
      state.myRequests = null;
      state.myGrants = null;
      toast('سُحب الإذن فوراً.');
      return render('photos');
    } catch (error) {
      return toast(error.message);
    }
  }
});

// Leaving the camera screen must stop the camera. A page that keeps the
// light on after you navigate away is a page nobody trusts twice.
window.addEventListener('hashchange', () => {
  if (location.hash.slice(2) !== 'camera') {
    state.capture?.stop();
    state.capture = null;
  }
});

// --------------------------------------------------------------------- //
// Start
// --------------------------------------------------------------------- //

// Paint first, connect second. The first screen must not wait on a network
// round trip that may not be configured at all, and on a phone on a slow
// connection the difference is the whole first impression.
render(location.hash.slice(2) || 'welcome');

(async () => {
  const db = await connect();
  if (!db) return;                     // No config: the fixtures stand.
  state.db = db;

  try {
    // One call establishes both things the shell needs: whether this
    // browser has an application, and whether it is a reviewer.
    const me = await db.whoami();

    // A banned account is shown one screen and nothing else.
    if (me?.banned) {
      state.banned = true;
      return go('closed', { replace: true });
    }

    // Claim this sign-in. It ends the others — one at a time — and comes
    // back with any sign-in the owner has not been shown yet.
    if (me?.has_credential) {
      db.registerSession()
        .then((session) => {
          if (session?.current === false) {
            // Displaced by a newer sign-in. Say so and step aside rather
            // than leaving a session that will be refused piecemeal.
            toast('سُجّل الدخول من جهاز آخر. انتهت هذه الجلسة.');
            return db.signOut().finally(() => go('login', { replace: true }));
          }
          showSessionWarning(session?.others);
        })
        .catch((error) => console.warn('[nasib] session:', error.message));
    }

    state.isAdmin = !!me?.is_admin;
    // Needed by the review desk's "you are not a reviewer" screen, which
    // has to print this id whether or not an application exists.
    state.userId = me?.user_id || '';
    state.email = me?.email || '';

    if (me?.has_row) {
      state.application = await db.myApplication();
      // A returning applicant lands somewhere useful rather than on the
      // welcome screen, which asks them to start something they finished:
      // a reviewer on the desk, an admitted member inside the app, and
      // anyone still waiting on their status.
      if (current() === 'welcome') {
        go(state.isAdmin ? 'desk'
           : state.application?.status === 'admitted' ? 'today'
           : 'review', { replace: true });
        return;
      }
    } else if (state.isAdmin && current() === 'welcome') {
      // An admin who has not applied — the usual case for the owner.
      go('desk', { replace: true });
      return;
    }
  } catch (error) {
    // Only a failure to establish a SESSION means there is no backend.
    //
    // This used to null `state.db` for any error at all, which turned a
    // single failed read — one missing function, one transient 500 — into
    // "every screen shows fixtures". That is the worst possible response
    // to a small problem: the app silently becomes a demo, and the person
    // using it reports that the data is fake rather than that a call
    // failed. Anything else is logged and left to the screen that asked
    // for it, each of which already handles its own failure.
    const fatal = /not signed in|Anonymous sign-ins|تحديد الحساب|الاتصال بالخادم/.test(
      error.message || '');

    console.warn(`[nasib] ${fatal ? 'no backend' : 'a call failed during startup'}:`,
                 error.message);
    if (fatal) state.db = null;
    state.startupError = error.message;
  }

  // Repaint, whatever is showing. The first render ran before connect()
  // resolved, so any screen that fetches on render did not fetch — it saw
  // `state.db` still null and skipped, and without a second render it
  // never tries again.
  //
  // This was a list of screen names, and a screen added later was not on
  // it: admin-stats sat on "loading…" forever. A list that has to be kept
  // in step with the screens is a list that will fall out of step, so
  // there is no list.
  render(current());
})();

// A read-only window onto what the app thinks is true. There is nothing
// secret in it — it is this browser's own state — and having it turns
// "the data looks wrong" into a question answerable from the console
// rather than a guess:
//
//   nasib.state.db          null means it is running on fixtures
//   nasib.state.startupError  why, if something failed
//   nasib.state.profile     what the server said about you
window.nasib = {
  get state() {
    return {
      db: state.db ? 'connected' : null,
      startupError: state.startupError || null,
      userId: state.userId,
      email: state.email,
      isAdmin: state.isAdmin,
      application: state.application,
      profile: state.profile,
      matches: state.matches,
      meetings: state.meetings,
      myRequests: state.myRequests,
      myGrants: state.myGrants,
      fetched: [...fetched.keys()],
    };
  },
};
