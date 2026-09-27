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
  myRequests: null,
  myGrants: null,
  matches: null,
  thread: null,
  openMatch: '',
  meetings: null,
  photoRequests: null,
  reports: null,
  stats: null,
  member: null,
  memberId: '',
  gate: '',
  missingRoute: '',
  startupError: '',
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
  <div class="screen pad on" style="padding-top:38px">
    <div class="center">${star(30)}</div>
    <h1 class="hero" style="margin-top:18px">نصيب</h1>
    <p style="text-align:center;margin:4px 0 0;font-size:17px;font-weight:500;color:var(--ink-soft)">
      للزواج، لا لغيره.
    </p>
    ${ornament()}
    <p class="body" style="text-align:center">
      كل من تقابله هنا مرّ بتحقق من هويته ومراجعة بشرية. التسجيل طلب انضمام، ولا نقبل الجميع.
    </p>

    <div class="panel tight" style="margin-top:18px">
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
  <div class="screen">
    ${appbar('طلب الانضمام')}
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

screens.today = () => {
  // Live: real admitted members. Otherwise the fixtures, as before.
  const live = state.db && state.members;

  if (live && state.gate) {
    return `
      <div class="screen">
        ${appbar('اليوم', { back: false })}
        <div class="pad center" style="min-height:60vh;text-align:center">
          <div>
            ${star(30)}
            <h3 class="hd" style="margin-top:18px">لم يُفتح هذا القسم بعد</h3>
            <p class="body" style="color:var(--ink-soft)">
              ${state.gate === 'none'
                ? 'لم تُرسل طلب انضمام بعد. نعرض عليك أشخاصاً بعد قبول طلبك،'
                  + ' لأن الطرف الآخر مرّ بالمراجعة نفسها.'
                : `حالة طلبك: ${word('status', state.gate)}. نعرض عليك أشخاصاً بعد`
                  + ' قبول طلبك، لأن الطرف الآخر مرّ بالمراجعة نفسها.'}
            </p>
            <button class="btn quiet" style="margin-top:10px" data-go="${
              state.gate === 'none' ? 'apply' : 'profile'}">${
              state.gate === 'none' ? 'ابدأ طلب الانضمام' : 'ملفي'}</button>
          </div>
        </div>
      </div>`;
  }

  const pool = live ? state.members : DEMO.candidates;
  const c = pool[state.candidate];

  if (!c && live) {
    return `
      <div class="screen">
        ${appbar('اليوم', { back: false })}
        <div class="pad center" style="min-height:60vh;text-align:center">
          <div>
            ${star(30)}
            <h3 class="hd" style="margin-top:18px">${
              state.members.length === 0 ? 'لا أحد بعد' : 'انتهت مرشّحات اليوم'}</h3>
            <p class="body" style="color:var(--ink-soft)">
              ${state.members.length === 0
                ? 'لم يُقبل أحد غيرك حتى الآن. القبول قرار بشري، ويحتاج شخصاً في مكتب المراجعة.'
                : 'نعرض خمسة إلى ثمانية أشخاص في اليوم. عدد قليل يُقرأ، وعدد كبير يُمرَّر.'}
            </p>
          </div>
        </div>
      </div>`;
  }

  if (!c) {
    return `
      <div class="screen">
        ${appbar('اليوم', { back: false })}
        <div class="pad center" style="min-height:60vh;text-align:center">
          <div>
            ${star(30)}
            <h3 class="hd" style="margin-top:18px">انتهت مرشّحات اليوم</h3>
            <p class="body" style="color:var(--ink-soft)">
              نعرض خمسة إلى ثمانية أشخاص في اليوم. عدد قليل يُقرأ، وعدد كبير يُمرَّر.
            </p>
          </div>
        </div>
      </div>`;
  }

  return `
    <div class="screen">
      ${appbar('اليوم', { back: false, side: `${pool.length - state.candidate} متبقّون` })}
      <div class="pad">
        <div style="display:flex;align-items:flex-start;gap:12px">
          <div style="flex:1;min-width:0">
            <h3 class="hd" style="margin:0">${c.name}، ${c.age}</h3>
            <p class="sub" style="margin:2px 0 0">${c.city} · ${c.work}</p>
          </div>
          ${c.verified === true
            ? `<span class="badge id">${star(12, 'var(--accent)')} هوية موثّقة</span>`
            : c.verified === false
            ? `<span class="badge photo">${star(12, 'var(--teal)')} صورة موثّقة</span>`
            : ''}
          ${/* `undefined` is the real member case: the directory does not
                carry a verification result, and a badge is a claim. An app
                that shows "صورة موثّقة" because it had nothing to show is
                worse than one that shows nothing — the badge is the whole
                reason someone trusts the profile. */ ''}
        </div>

        <div class="spacer"></div>
        <div class="veil-row">${Array.from({ length: c.photos }, veil).join('')}</div>

        <button class="btn ghost" style="margin-top:12px" data-request="${c.id}">
          <span style="display:inline-flex;gap:8px;align-items:center;justify-content:center">
            ${ico.eye} طلب رؤية الصور
          </span>
        </button>
        <p class="note">
          كل الصور على هذا التطبيق تُعرض مموّهة. لا يوجد إعداد يجعل صورتك مكشوفة للجميع — لا الآن ولا لاحقاً.
        </p>

        <div class="spacer"></div>
        <p class="eyebrow">جاهزيته للزواج</p>
        <div class="facts">${c.facts.map((f) => `<span class="fact">${f}</span>`).join('')}</div>

        <div class="spacer"></div>
        <p class="eyebrow">بكلماته</p>
        <div class="panel flat"><p style="margin:0;font-size:15px;line-height:1.95">${c.bio}</p></div>

        ${(c.agree.length + c.differ.length) === 0 ? '' : `
        <div class="spacer"></div>
        <p class="eyebrow">أين تتفقان وأين تختلفان</p>
        <div class="panel tight">
          ${c.agree.map((a) => `<div class="line-item">${ico.done}<span>${a}</span></div>`).join('')}
          ${c.differ.map((d) => `
            <div class="line-item">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--caution)"
                   stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12h7"/></svg>
              <span>${d}</span>
            </div>`).join('')}
        </div>`}

        <div class="spacer"></div>
        <div class="btn-row">
          <button class="btn ghost" data-decide="no">لا، شكراً</button>
          <button class="btn wide" data-decide="yes">مهتمة</button>
        </div>
      </div>
    </div>`;
};

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
      <div class="banner info" style="margin-bottom:14px">
        ${ico.room}
        <span>مكالمة مرئية داخل التطبيق قبل تبادل أي وسيلة تواصل.</span>
      </div>
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
            <div class="photo-cell" data-path="${escapeAttr(ph.storage_path)}">
              <div class="photo-veil">${star(22, 'var(--accent)', 0.4)}</div>
              <img alt="" data-signed="${escapeAttr(ph.storage_path)}">
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
          صورك مموّهة لكل من يراها، ولا تُكشف إلا بإذنك لشخص واحد ولمدة محددة.
          كل صورة تُراجع قبل أن تظهر لأحد. الحد ست صور.
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
      go(state.isAdmin ? 'admin'
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
  ['admin', 'الطلبات', (s) => s?.waiting],
  ['admin-photos', 'الصور', (s) => s?.photos_pending],
  ['admin-requests', 'طلبات الصور', (s) => s?.requests_pending],
  ['admin-reports', 'البلاغات', (s) => s?.reports_open],
  ['admin-meetings', 'اللقاءات', (s) => s?.meetings_pending],
  ['admin-search', 'بحث', () => 0],
  ['admin-audit', 'السجلّ', () => 0],
  ['admin-stats', 'الأرقام', () => 0],
];

const deskNav = (current) => `
  <div class="chips scroll-row" style="margin-bottom:16px">
    ${DESK_TABS.map(([id, label, count]) => {
      const n = count(state.stats);
      return `<button class="chip" data-go="${id}" aria-pressed="${id === current}">${label}${
        n ? ` (${n})` : ''}</button>`;
    }).join('')}
  </div>`;

screens.admin = () => {
  const q = state.queue;

  // Opening this URL without being a reviewer is the common case — it is
  // how the first reviewer is made. So it is a screen with the one thing
  // that is needed, not a refusal: the account id, in the statement that
  // grants it, ready to copy.
  if (q?.forbidden) {
    const id = state.userId || '';
    return `
    <div class="screen">
      ${appbar('مكتب المراجعة')}
      <div class="pad">
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

  return `
  <div class="screen">
    ${appbar('مكتب المراجعة', { side: q ? `${(q.rows || []).length}` : '' })}
    <div class="pad">
      ${deskNav('admin')}
      <div class="chips scroll-row" style="margin-bottom:16px">
        ${QUEUE_TABS.map(([id, label]) => `
          <button class="chip" data-queue="${id}"
                  aria-pressed="${(state.queueFilter || 'waiting') === id}">
            ${label}${q?.counts?.[id] ? ` (${q.counts[id]})` : ''}
          </button>`).join('')}
      </div>

      ${!q ? `<div class="panel"><p class="muted" style="margin:0">جارٍ التحميل…</p></div>`
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
// The rest of the review desk
// --------------------------------------------------------------------- //

/** A photo, veiled, with its signed URL fetched after paint. */
const adminPhoto = (path, extra = '') => `
  <div class="photo-cell" data-path="${escapeAttr(path)}">
    <div class="photo-veil">${star(22, 'var(--accent)', 0.4)}</div>
    <img alt="" data-signed="${escapeAttr(path)}" class="unveiled">
    ${extra}
  </div>`;

// ── photos waiting for approval ───────────────────────────────────────

const PHOTO_FILTERS = [['pending', 'تنتظر'], ['approved', 'معتمدة'], ['all', 'الكل']];

screens['admin-photos'] = () => {
  const q = state.photoQueue;
  const rows = q?.rows;
  const filter = state.photoFilter || 'pending';
  return `
  <div class="screen">
    ${appbar('الصور', { side: rows ? String(rows.length) : '' })}
    <div class="pad">
      ${deskNav('admin-photos')}
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
  <div class="screen">
    ${appbar(escapeAttr(m.display_name || 'ملف العضو'))}
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
  <div class="screen">
    ${appbar('البلاغات', { side: q ? String((q.rows || []).length) : '' })}
    <div class="pad">
      ${deskNav('admin-reports')}
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
  <div class="screen">
    ${appbar('طلبات الصور', { side: rows ? String(rows.length) : '' })}
    <div class="pad">
      ${deskNav('admin-requests')}
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
  <div class="screen">
    ${appbar('الأرقام')}
    <div class="pad">
      ${deskNav('admin-stats')}
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
  try { state.thread = await state.db.matchThread(state.openMatch); }
  catch (error) { state.thread = { messages: [] }; toast(error.message); }
}

async function loadMeetings() {
  try { state.meetings = await state.db.myMeetings(); }
  catch (error) { state.meetings = []; console.warn('[nasib] meetings:', error.message); }
}

// ── search ────────────────────────────────────────────────────────────

screens['admin-search'] = () => `
  <div class="screen">
    ${appbar('بحث')}
    <div class="pad">
      ${deskNav('admin-search')}
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
  <div class="screen">
    ${appbar('اللقاءات', { side: rows ? String(rows.length) : '' })}
    <div class="pad">
      ${deskNav('admin-meetings')}
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

// ── the audit trail ───────────────────────────────────────────────────

screens['admin-audit'] = () => {
  const rows = state.audit;
  return `
  <div class="screen">
    ${appbar('السجلّ')}
    <div class="pad">
      ${deskNav('admin-audit')}

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
    const [audit, reviewers] = await Promise.all([
      state.db.adminAudit(), state.db.adminReviewers(),
    ]);
    state.audit = audit;
    state.reviewers = reviewers;
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

  app.innerHTML = build();
  app.firstElementChild?.classList.add('on');
  window.scrollTo(0, 0);

  // The review desk is not a tab, but it is an in-app screen, and a
  // reviewer who lands on it directly must not be left on a screen with no
  // way out. It keeps the bar, with `ملفي` marked current, because that is
  // where the desk is reached from.
  const inApp = IN_APP.has(name) || name === 'admin';
  if (inApp) state.admitted = true;
  tabbar.classList.toggle('on', state.admitted && inApp);
  tabbar.style.setProperty('--tabs', String(TABS.length));
  tabbar.innerHTML = TABS.map(([id, label, icon]) => `
    <button data-tab="${id}" aria-current="${
      id === name || (name === 'admin' && id === 'profile')}">${icon}<span>${label}</span></button>`).join('');

  if (name === 'apply') wireApply();
  if (name === 'camera') wireCamera();
  if (name === 'chat') wireChat();
  if (name === 'profile') wireProfile();
  if (name === 'login' || name === 'staff') wireLogin();

  // Screens that need a round trip paint twice: once from whatever is in
  // `state` (a skeleton, or the previous read) and again when the data
  // lands. A screen that waits for the network before drawing anything
  // reads as a broken tap on a slow connection.
  if (name === 'profile') fetchOnce('profile', loadProfile);
  if (name === 'admin') fetchOnce('admin', loadQueue);
  if (name === 'today') fetchOnce('today', loadMembers);
  if (name === 'admin-photos') fetchOnce('admin-photos', loadPhotoQueue);
  if (name === 'admin-requests') fetchOnce('admin-requests', loadPhotoRequests);
  if (name === 'admin-reports') fetchOnce('admin-reports', loadReports);
  if (name === 'admin-meetings') fetchOnce('admin-meetings', loadAdminMeetings);
  if (name === 'admin-audit') fetchOnce('admin-audit', loadAudit);
  if (name === 'admin-search') wireSearch();
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
  const el = event.target.closest('[data-go], [data-back], [data-tab], .chip, [data-decide], [data-request], [data-revoke], [data-decide-photo], [data-queue], [data-decide-user], [data-del-photo], [data-copy], [data-signout], [data-login-mode], [data-member], [data-photo-action], [data-photo-filter], [data-schedule], [data-report], [data-screen-request], [data-open-match], [data-cancel-meeting]');
  if (!el) return;

  if (el.dataset.loginMode) {
    state.loginMode = el.dataset.loginMode;
    return render('login');
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
  if (el.dataset.openMatch) {
    state.openMatch = el.dataset.openMatch;
    state.thread = null;
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

  if (el.dataset.decide) {
    // Interest is one-directional and private: a declined person is never
    // told, and the user is never told they were declined either.
    state.candidate += 1;
    toast(el.dataset.decide === 'yes' ? 'سجّلنا اهتمامك.' : 'لن نعرضه عليك مجدداً.');
    return render('today');
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
        go(state.isAdmin ? 'admin'
           : state.application?.status === 'admitted' ? 'today'
           : 'review', { replace: true });
        return;
      }
    } else if (state.isAdmin && current() === 'welcome') {
      // An admin who has not applied — the usual case for the owner.
      go('admin', { replace: true });
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
