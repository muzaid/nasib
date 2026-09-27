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
  gate: '',
  isAdmin: false,
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
              حالة طلبك: ${word('status', state.gate)}. نعرض عليك أشخاصاً بعد
              قبول طلبك، لأن الطرف الآخر مرّ بالمراجعة نفسها.
            </p>
            <button class="btn quiet" style="margin-top:10px" data-go="profile">ملفي</button>
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

screens.photos = () => `
  <div class="screen">
    ${appbar('صوري', { back: false })}
    <div class="pad">
      <p class="eyebrow">طلبات رؤية صورك</p>
      ${state.requests.length === 0
        ? `<div class="panel"><p class="muted" style="margin:0">لا توجد طلبات الآن.</p></div>`
        : state.requests.map((r) => `
          <div class="panel">
            <div style="display:flex;align-items:flex-start;gap:12px">
              <div style="flex:1;min-width:0">
                <div style="font-size:16.5px;font-weight:600">${r.name}، ${r.age}</div>
                <div class="tiny muted" style="margin-top:2px">${r.city} · يطلب رؤية صورك</div>
              </div>
              ${r.verified ? `<span class="badge id">${star(12, 'var(--accent)')} هوية موثّقة</span>` : ''}
            </div>
            <div class="panel flat" style="background:var(--page);margin-top:12px;padding:12px 14px">
              <p style="margin:0;font-size:14.5px;line-height:1.85">${r.note}</p>
            </div>
            <hr class="rule">
            <div style="display:flex;gap:10px;align-items:flex-start">
              ${ico.shield}
              <p class="tiny muted" style="margin:0;line-height:1.75">راجعت الإدارة هذا الطلب قبل أن يصلك.</p>
            </div>
            <div class="btn-row" style="margin-top:14px">
              <button class="btn ghost" data-decide-photo="no" data-id="${r.id}">لا أسمح</button>
              <button class="btn wide" data-decide-photo="yes" data-id="${r.id}">أسمح برؤية صوري</button>
            </div>
            <p class="note">قرارك لا يُبلَّغ له بأي تفصيل. لا داعي لتبرير الرفض.</p>
          </div>`).join('')}

      <div class="spacer"></div>
      <p class="eyebrow">من يرى صوري</p>
      <div class="panel tight">
        ${state.grants.map((g) => `
          <div class="line-item" style="align-items:center">
            <div style="flex:1;min-width:0">
              <div style="font-size:15.5px;font-weight:600">${g.name}</div>
              <div class="tiny muted">
                ${g.views ? `شاهدها ${g.views} مرات` : 'لم يشاهدها بعد'} · يتبقى ${g.days} يوماً
              </div>
            </div>
            <button class="btn quiet" style="width:auto;color:var(--danger)" data-revoke="${g.id}">سحب الإذن</button>
          </div>`).join('')}
      </div>

      ${state.grants.some((g) => g.shots > 0) ? `
        <div class="panel" style="margin-top:12px;border-inline-start:3px solid var(--danger)">
          <div style="display:flex;gap:10px;align-items:flex-start">
            ${ico.warn}
            <div>
              <div style="font-weight:600;font-size:15.5px;color:var(--danger)">التقط أحدهم لقطة لصورك</div>
              <div class="tiny muted" style="margin-top:2px">خالد، 30 · أمس 9:14 مساءً · المحاولة الأولى</div>
              <p style="margin:8px 0 0;font-size:14px;line-height:1.8">
                أُبلغ بأننا رصدنا المحاولة وبأن صورك تحمل علامة تعريف باسمه.
                عند المحاولة الثانية يُسحب إذنه تلقائياً دون انتظار قرارك.
              </p>
            </div>
          </div>
        </div>` : ''}

      <div class="panel accent-alt" style="margin-top:12px">
        <p class="eyebrow">ما الذي نمنعه فعلاً</p>
        <p style="margin:0;font-size:14px;line-height:1.85">
          على أندرويد: التقاط الشاشة وتسجيلها محجوبان تماماً على شاشات الصور والمحادثة.
        </p>
        <hr class="rule">
        <p style="margin:0;font-size:14px;line-height:1.85">
          على الآيفون: لا يستطيع أي تطبيق منع لقطة الشاشة — هذه حقيقة النظام، لا خيارنا.
          لكننا نرصدها ونُعلمك باسم من التقطها.
        </p>
        <hr class="rule">
        <p style="margin:0;font-size:14px;line-height:1.85">
          وفي المتصفّح: لا يمكن منع شيء من هذا. لهذا يبقى الكشف عن الصور داخل التطبيق.
        </p>
      </div>
    </div>
  </div>`;

screens.chat = () => `
  <div class="screen">
    <div class="appbar">
      <button class="iconbtn" data-back aria-label="رجوع">${ico.back}</button>
      <div style="text-align:center">
        <h2 style="margin:0">يوسف</h2>
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
      جرّب كتابة رقم هاتف أو عنوان — الرسالة تُفحص قبل الإرسال.
    </p>
  </div>`;

screens.meeting = () => `
  <div class="screen">
    ${appbar('لقاء في المكتب', { back: false })}
    <div class="pad">
      <div class="panel accent-alt">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          ${star(18, 'var(--accent)')}
          <span style="font-size:16px;font-weight:600">الموعد مؤكد</span>
        </div>
        <hr class="rule">
        <dl style="margin:0">
          <div class="kv"><dt>الموعد</dt><dd>${DEMO.meeting.when}</dd></div>
          <div class="kv"><dt>المكتب</dt><dd>${DEMO.meeting.office}</dd></div>
          <div class="kv"><dt>العنوان</dt><dd style="font-weight:400">${DEMO.meeting.address}</dd></div>
          <div class="kv"><dt>الغرفة</dt><dd>${DEMO.meeting.room}</dd></div>
          <div class="kv"><dt>الموظّفة</dt><dd>${DEMO.meeting.staff}</dd></div>
          <div class="kv"><dt>العائلات</dt><dd>${DEMO.meeting.family}</dd></div>
        </dl>
      </div>

      <div class="panel">
        <p class="eyebrow">قبل أن تأتي</p>
        <div class="line-item" style="padding-top:2px">${ico.check}<span>احضر قبل الموعد بعشر دقائق</span></div>
        <div class="line-item">${ico.check}<span>أحضِر هويتك</span></div>
        <div class="line-item">${ico.face}<span>إن تأخرت أو اعتذرت، أخبرنا من التطبيق</span></div>
      </div>

      <p class="note">نسجّل الحضور. عدم الحضور دون إشعار يُسجَّل في ملفك.</p>
      <button class="btn quiet" style="color:var(--danger)">إلغاء اللقاء</button>
    </div>
  </div>`;

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
  status: {
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

      <p class="eyebrow" style="margin-top:22px">معرّف حسابك</p>
      <div class="panel tight">
        <p class="tiny muted" style="margin:0 0 8px;line-height:1.8">
          هذا ما تحتاجه لتمنح نفسك صلاحية المراجعة، من محرّر SQL في Supabase:
        </p>
        <code class="code-line" dir="ltr">select grant_admin('${escapeAttr(p.user_id)}');</code>
      </div>
    </div>
  </div>`;
};

function wireProfile() {
  if (!state.db) return;

  // Signed URLs, one per photo, fetched after the screen is on the page.
  // The bucket is private and these expire, so there is nothing to cache
  // and no URL worth holding on to.
  for (const img of document.querySelectorAll('img[data-signed]')) {
    state.db.signedUrl(img.dataset.signed)
      .then((url) => { if (url) img.src = url; })
      .catch(() => {});
  }

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

async function loadProfile() {
  if (!state.db) return;
  try {
    state.profile = await state.db.myProfile();
  } catch (error) {
    console.warn('[nasib] could not read the profile:', error.message);
    state.profile = { user_id: '' };
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

screens.admin = () => {
  const q = state.queue;

  return `
  <div class="screen">
    ${appbar('مكتب المراجعة', { side: q ? `${(q.rows || []).length}` : '' })}
    <div class="pad">
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

            ${['applying', 'pending_review'].includes(r.status) ? `
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
    state.queue = { rows: [], counts: {} };
    toast(error.message);
  }
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

function render(name) {
  const build = screens[name];
  if (!build) return;

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

  // Screens that need a round trip paint twice: once from whatever is in
  // `state` (a skeleton, or the previous read) and again when the data
  // lands. A screen that waits for the network before drawing anything
  // reads as a broken tap on a slow connection.
  if (name === 'profile' && state.db && !state.profile) {
    loadProfile().then(() => { if (current() === 'profile') render('profile'); });
  }
  // The `!state.queue` guard is load-bearing, not an optimisation: without
  // it the fetch that follows a render triggers another render, which
  // fetches again. The screen flickers, the buttons are detached from the
  // DOM mid-tap, and nothing can be clicked. Every one of these three has
  // to check that it does not already have its data.
  if (name === 'admin' && state.db && !state.queue) {
    loadQueue().then(() => { if (current() === 'admin') render('admin'); });
  }
  if (name === 'today' && state.db && !state.members) {
    loadMembers().then(() => { if (current() === 'today') render('today'); });
  }
}

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

  button.addEventListener('click', async () => {
    const application = readApplication(form);
    const problem = firstProblem(application);
    if (problem) {
      errorBox.innerHTML = `<div class="banner warn" style="margin-top:16px">${problem}</div>`;
      return;
    }
    errorBox.innerHTML = '';

    // Without a backend the form is a demonstration; keep the answers in
    // memory so returning to the screen does not wipe them, and move on.
    if (!state.db) {
      state.application = application;
      return go('camera');
    }

    if (state.saving) return;
    state.saving = true;
    button.disabled = true;
    button.textContent = 'جارٍ الحفظ…';

    try {
      const row = await state.db.apply(application);
      // Keep what was typed as well as what came back: the function
      // returns the stored status, not the whole form, and re-rendering
      // the screen from the response alone would blank half the fields.
      state.application = { ...application, ...(row || {}) };
      go('camera');
    } catch (error) {
      // The database's own sentence, when it has one — the 18+ refusal is
      // already written for the applicant, and rewording it here would
      // only make the two copies disagree.
      errorBox.innerHTML = `<div class="banner warn" style="margin-top:16px">${
        escapeAttr(error.message || 'تعذّر الحفظ. حاول مرة أخرى.')}</div>`;
      button.disabled = false;
      button.textContent = 'حفظ ومتابعة إلى التحقق بالكاميرا';
    } finally {
      state.saving = false;
    }
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

  thread.innerHTML = state.messages.map((m) => {
    const r = redact(m.body, { unlocked: state.contactUnlocked });
    return `
      <div class="bubble ${m.from === 'me' ? 'me' : 'them'}">
        ${r.text}
        ${r.redacted ? `<small>حُذف ${r.summary} من هذه الرسالة</small>` : ''}
      </div>`;
  }).join('');
}

function wireChat() {
  paintThread();

  const draft = document.getElementById('draft');
  const send = document.getElementById('send');
  const warning = document.getElementById('composer-warning');

  const check = () => {
    draft.style.height = 'auto';
    draft.style.height = `${Math.min(draft.scrollHeight, 110)}px`;

    const r = redact(draft.value, { unlocked: state.contactUnlocked });
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

  send.addEventListener('click', () => {
    const body = draft.value.trim();
    if (!body) return;
    state.messages.push({ from: 'me', body });
    draft.value = '';
    check();
    paintThread();
  });
}

// --------------------------------------------------------------------- //
// One delegated listener for everything the screens declare
// --------------------------------------------------------------------- //

document.addEventListener('click', async (event) => {
  const el = event.target.closest('[data-go], [data-back], [data-tab], .chip, [data-decide], [data-request], [data-revoke], [data-decide-photo], [data-queue], [data-decide-user], [data-del-photo]');
  if (!el) return;

  if (el.dataset.go) return go(el.dataset.go);
  if (el.dataset.tab) return go(el.dataset.tab);

  // ── the review desk ──────────────────────────────────────────────────
  if (el.dataset.queue) {
    state.queue = null;
    state.queueFilter = el.dataset.queue;
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
    toast('وصل طلبك للإدارة. سيُراجَع قبل أن يصلها.');
    return;
  }

  if (el.dataset.decidePhoto) {
    state.requests = state.requests.filter((r) => r.id !== el.dataset.id);
    if (el.dataset.decidePhoto === 'yes') {
      state.grants.push({ id: `g${Date.now()}`, name: 'يوسف', days: 14, views: 0, shots: 0 });
      toast('سمحتِ له برؤية صورك لمدة 14 يوماً.');
    } else {
      toast('لم نبلّغه بأي تفصيل.');
    }
    return render('photos');
  }

  if (el.dataset.revoke) {
    state.grants = state.grants.filter((g) => g.id !== el.dataset.revoke);
    toast('سُحب الإذن فوراً.');
    return render('photos');
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
    // A misconfigured project, anonymous sign-ins left off, or no network.
    // None of that should take the site down: it falls back to the demo,
    // and the console says why for whoever deployed it.
    console.warn('[nasib] running without a backend:', error.message);
    state.db = null;
  }

  // Repaint where the text or the data depends on being connected. The
  // first render ran before `connect()` resolved, so any screen that
  // fetches on render did not fetch — it saw `state.db` still null and
  // skipped. Leaving one out here leaves it showing "loading…" forever.
  if (['apply', 'welcome', 'profile', 'today', 'admin', 'review'].includes(current())) {
    render(current());
  }
})();
