// The same cases as supabase/tests/test_message_redaction.sql.
//
//   node --test apps/web/test/
//
// Duplicated on purpose. The SQL is the authority, but this copy runs on
// every keystroke in the composer, and the two drifting apart shows up as
// a message the app said was fine and the server then altered — worse than
// either rule alone. So both are tested against the same list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, wouldRemove } from '../redact.js';

const found = (s) => wouldRemove(s);
const cleaned = (s) => redact(s).text;

test('phone numbers, in every script people actually use', async (t) => {
  await t.test('a plain Latin-digit number', () => {
    assert.ok(found('رقمي 0599123456 اتصل فيني').includes('phone'));
    assert.ok(!cleaned('رقمي 0599123456').includes('0599123456'));
  });

  await t.test('Arabic-Indic digits are digits', () => {
    assert.ok(found('رقمي ٠٥٩٩١٢٣٤٥٦').includes('phone'));
  });

  await t.test('separators do not hide it', () => {
    assert.ok(found('0599 123 456').includes('phone'));
    assert.ok(found('0599-123-456').includes('phone'));
    assert.ok(found('0 5 9 9 1 2 3 4 5 6').includes('phone'));
  });

  await t.test('letters standing in for digits do not hide it', () => {
    assert.ok(found('رقمي O599I23456').includes('phone'));
  });

  await t.test('but ordinary words that fold to digits are not a number', () => {
    // "looooool" folds to "1000000l". The digit guard is what stops it.
    assert.deepEqual(found('looooool شو هالحكي'), []);
  });
});

test('numbers written as words', async (t) => {
  await t.test('Arabic', () =>
    assert.ok(found('صفر خمسة تسعة تسعة واحد اثنين').includes('phone')));
  await t.test('English', () =>
    assert.ok(found('zero five nine nine one two three').includes('phone')));
  await t.test('Levantine spellings', () =>
    assert.ok(found('تسعة تسعة خمسة صفر').includes('phone')));
});

test('addresses', async (t) => {
  await t.test('a street address', () =>
    assert.ok(found('انا ساكن شارع الإرسال عمارة الأمل الطابق الثالث').includes('address')));
  await t.test('a landmark locates a person just as well', () =>
    assert.ok(found('بيتنا قرب مسجد الحرم').includes('address')));
  await t.test('English forms', () =>
    assert.ok(found('I live on Rainey Street building 4').includes('address')));
  await t.test('a post box', () =>
    assert.ok(found('ص.ب 1234 رام الله').includes('address')));
});

test('email, links, handles, leaving the platform', async (t) => {
  await t.test('email', () =>
    assert.ok(found('راسلني amira@example.com').includes('email')));
  await t.test('a bare domain', () =>
    assert.ok(found('شوف instagram.com/someone').includes('link')));
  await t.test('the domain written in words', () => {
    assert.ok(found('حسابي instagram dot com slash amira').includes('link'));
    assert.ok(found('انستقرام نقطة كوم').includes('link'));
  });
  await t.test('a handle', () =>
    assert.ok(found('@amira_2000').includes('handle')));
  await t.test('naming the app, which comes before the number', () =>
    assert.ok(found('تعالي نحكي على الواتس').includes('offPlatform')));
});

test('ordinary messages are left alone', async (t) => {
  // A false positive costs someone retyping a harmless sentence and
  // deciding the app is broken.
  const fine = [
    'أهلاً، تشرفت بملفك. كيف حالك اليوم؟',
    'عمري 32 سنة وأعمل مهندس',
    'عندي 3 اخوة وأختين',
    'بشتغل من 8 الصبح لل 5 المسا',
    'ان شاء الله نتقابل في المكتب الخميس',
  ];
  for (const ok of fine) {
    await t.test(`survives: ${ok}`, () => {
      assert.deepEqual(found(ok), []);
      assert.equal(cleaned(ok), ok);
    });
  }
});

test('after the video call', async (t) => {
  await t.test('a phone number is theirs to share', () => {
    const r = redact('رقمي 0599123456', { unlocked: true });
    assert.equal(r.redacted, false);
    assert.ok(r.text.includes('0599123456'));
  });

  await t.test('an IBAN is not, at any stage', () => {
    const r = redact('حسابي PS92PALS000000000400123456702', { unlocked: true });
    assert.ok(r.found.includes('identifier'));
    assert.ok(!r.text.includes('PS92PALS'));
  });

  await t.test('nor is an ID number', () =>
    assert.ok(found('هويتي 401234567').includes('identifier')));
});

test('the warning names what it found, in Arabic', () => {
  const r = redact('رقمي 0599123456 وساكن شارع الإرسال');
  assert.ok(r.summary.includes('رقم هاتف'));
  assert.ok(r.summary.includes('عنوان'));
});
