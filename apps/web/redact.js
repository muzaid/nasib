// Personal details in chat — the browser's copy of the rule.
//
// The authority is the database trigger in
// supabase/migrations/0008_message_redaction.sql, which rewrites every
// message before it is stored and which no client can skip. This file is
// the courtesy: the composer warns the sender *before* they press send and
// names what it found, because silently mangling someone's sentence is
// worse than telling them why it cannot go.
//
// It is a port of the same rules, in the same order. When one changes
// there, change it here — test/redact.test.mjs runs the same cases the SQL
// suite does, so a drift shows up as a failing test rather than as a
// message the app promised was fine and the server then altered.

export const KINDS = {
  identifier: 'رقم هوية أو حساب',
  email: 'بريد إلكتروني',
  link: 'رابط',
  handle: 'حساب',
  phone: 'رقم هاتف',
  address: 'عنوان',
  offPlatform: 'تطبيق آخر',
};

const PLACEHOLDER = '⋯';

// Arabic-Indic and Persian numerals folded to Latin, one character for
// one character. A filter that only knows 0-9 stops nobody in this market.
const EASTERN = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹';
function westernDigits(s) {
  let out = '';
  for (const ch of s) {
    const i = EASTERN.indexOf(ch);
    out += i < 0 ? ch : String(i % 10);
  }
  return out;
}

// Letters standing in for digits — O for zero, l for one — which is the
// first thing anyone tries once a digit filter blocks them.
//
// Applied ONLY where digits are expected. Folding everywhere turns
// "example.com" into "examp1e.c0m" and the email rule stops matching its
// own test; that was a real bug on the SQL side.
function foldLookalikes(s) {
  return s.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1');
}

// label, pattern, fold letters into digits, minimum real digits.
//
// Order matters: identifiers before phone numbers, so a nine-digit ID is
// filed as an ID rather than swallowed by the phone rule. A local ID is
// nine digits and does not start with zero; a mobile is ten and does.
const CHECKS = [
  ['identifier', /([A-Z]{2}[0-9]{2}[A-Z0-9]{10,}|\b[1-9][0-9]{8}\b|[0-9]{12,})/g, true, 6],
  ['email', /[\w.%+-]+@[\w.-]+\.[a-z]{2,}/gi, false, 0],
  ['link', /(https?:\/\/\S+|www\.\S+|[\w-]+\.(com|net|org|me|ly|io|co)\b|\S+\s(dot|نقطة)\s\S+)/gi, false, 0],
  ['handle', /@[\w.]{3,}/g, false, 0],
  ['phone', /([0-9][\s.\-()]{0,3}){6,}/g, true, 4],
  ['phone',
    /((zero|one|two|three|four|five|six|seven|eight|nine|صفر|واحد|اثنين|إثنين|تنين|ثلاثة|تلاتة|اربعة|أربعة|خمسة|ستة|سبعة|ثمانية|تمانية|تسعة)(\s+\S+){0,2}\s*){2,}/gi,
    false, 0],
  ['address',
    /(شارع|شارغ|حارة|حي |منطقة|عمارة|بناية|مبنى|طابق|الطابق|شقة|بيت رقم|ص\.ب|صندوق بريد|قرب |بجانب |مقابل |خلف |street|st\.|avenue|ave\.|building|bldg|floor|apt|apartment|p\.o\. ?box|near |next to |opposite )[^،,.\n]{0,40}/gi,
    false, 0],
  ['offPlatform',
    /(whatsapp|whats ?app|telegram|signal app|snapchat|instagram|insta|tiktok|viber|imo|botim|واتساب|واتس|الواتس|تلغرام|تيليجرام|تلجرام|انستقرام|إنستقرام|انستا|سناب|سنابشات|فايبر)/gi,
    false, 0],
];

const DIGIT = /[0-9٠-٩۰-۹]/g;

// Blank the matched range of `body` using positions found in `probe`.
// Every normalisation above is one character for one character, so the two
// strings line up index for index — which is what lets a number written in
// Arabic-Indic digits be found without the message coming back in Latin
// ones.
function maskByPosition(body, probe, pattern, minDigits) {
  let out = '';
  let cut = 0;
  let hit = false;

  pattern.lastIndex = 0;
  let m;
  while ((m = pattern.exec(probe)) !== null) {
    if (m[0].length === 0) { pattern.lastIndex++; continue; }

    const span = body.slice(m.index, m.index + m[0].length);
    if (minDigits > 0) {
      const digits = (span.match(DIGIT) || []).length;
      if (digits < minDigits) continue;
    }

    out += body.slice(cut, m.index) + PLACEHOLDER;
    cut = m.index + m[0].length;
    hit = true;
  }

  return { text: out + body.slice(cut), hit };
}

/**
 * @param {string} input
 * @param {{unlocked?: boolean}} opts
 * @returns {{text: string, found: string[], redacted: boolean, summary: string}}
 */
export function redact(input, { unlocked = false } = {}) {
  const found = [];
  let out = input;

  for (const [kind, pattern, fold, minDigits] of CHECKS) {
    // After the video call, only identifiers stay blocked: a phone number
    // is then the couple's business, an account number never is.
    if (unlocked && kind !== 'identifier') continue;

    // Recomputed each pass — after a substitution the copy and the
    // original are different lengths, and the next pattern would blank the
    // wrong characters.
    const probe = fold ? foldLookalikes(westernDigits(out)) : westernDigits(out);
    const res = maskByPosition(out, probe, pattern, minDigits);

    if (res.hit) {
      out = res.text;
      if (!found.includes(kind)) found.push(kind);
    }
  }

  return {
    text: out,
    found,
    redacted: found.length > 0,
    summary: found.map((k) => KINDS[k]).join(' و'),
  };
}

/** What the composer needs: what would go if this were sent now. */
export function wouldRemove(draft) {
  return redact(draft, { unlocked: false }).found;
}
