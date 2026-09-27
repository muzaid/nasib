import 'package:flutter_test/flutter_test.dart';
import 'package:nasib/core/guarded_text.dart';

/// The same cases as supabase/tests/test_message_redaction.sql.
///
/// They are duplicated on purpose. The SQL is the authority — it is what a
/// patched client meets — but the Dart runs on every keystroke in the
/// composer, and the two drifting apart shows up as a message the app
/// promised was fine and the server then altered. That is worse than
/// either rule alone, so both are tested against the same list.
void main() {
  Set<PersonalDataKind> found(String s) => ContactGuard.wouldRemove(s);
  String cleaned(String s) => ContactGuard.apply(s, unlocked: false).text;

  group('phone numbers, in every script people actually use', () {
    test('a plain Latin-digit number', () {
      expect(found('رقمي 0599123456 اتصل فيني'), contains(PersonalDataKind.phone));
      expect(cleaned('رقمي 0599123456'), isNot(contains('0599123456')));
    });

    test('Arabic-Indic digits are digits', () {
      expect(found('رقمي ٠٥٩٩١٢٣٤٥٦'), contains(PersonalDataKind.phone));
    });

    test('separators do not hide it', () {
      expect(found('0599 123 456'), contains(PersonalDataKind.phone));
      expect(found('0599-123-456'), contains(PersonalDataKind.phone));
      expect(found('0 5 9 9 1 2 3 4 5 6'), contains(PersonalDataKind.phone));
    });

    test('letters standing in for digits do not hide it', () {
      expect(found('رقمي O599I23456'), contains(PersonalDataKind.phone));
    });

    test('but ordinary words that fold to digits are not a phone number', () {
      // "looooool" folds to "1000000l". The digit guard is what stops it.
      expect(found('looooool شو هالحكي'), isEmpty);
    });
  });

  group('numbers written as words', () {
    test('Arabic', () => expect(found('صفر خمسة تسعة تسعة واحد اثنين'),
        contains(PersonalDataKind.phone)));
    test('English', () => expect(found('zero five nine nine one two three'),
        contains(PersonalDataKind.phone)));
    test('Levantine spellings', () => expect(found('تسعة تسعة خمسة صفر'),
        contains(PersonalDataKind.phone)));
  });

  group('addresses', () {
    test('a street address', () => expect(
        found('انا ساكن شارع الإرسال عمارة الأمل الطابق الثالث'),
        contains(PersonalDataKind.address)));

    test('a landmark locates a person just as well', () => expect(
        found('بيتنا قرب مسجد الحرم'), contains(PersonalDataKind.address)));

    test('English forms', () => expect(
        found('I live on Rainey Street building 4'),
        contains(PersonalDataKind.address)));

    test('a post box', () =>
        expect(found('ص.ب 1234 رام الله'), contains(PersonalDataKind.address)));
  });

  group('email, links, handles, leaving the platform', () {
    test('email', () => expect(
        found('راسلني amira@example.com'), contains(PersonalDataKind.email)));

    test('a bare domain', () => expect(
        found('شوف instagram.com/someone'), contains(PersonalDataKind.link)));

    test('the domain written in words', () {
      expect(found('حسابي instagram dot com slash amira'),
          contains(PersonalDataKind.link));
      expect(found('انستقرام نقطة كوم'), contains(PersonalDataKind.link));
    });

    test('a handle', () =>
        expect(found('@amira_2000'), contains(PersonalDataKind.handle)));

    test('naming the app, which is what comes before the number', () => expect(
        found('تعالي نحكي على الواتس'), contains(PersonalDataKind.offPlatform)));
  });

  group('ordinary messages are left alone', () {
    // The cost of a false positive is someone retyping a harmless sentence
    // and deciding the app is broken.
    for (final ok in [
      'أهلاً، تشرفت بملفك. كيف حالك اليوم؟',
      'عمري 32 سنة وأعمل مهندس',
      'عندي 3 اخوة وأختين',
      'بشتغل من 8 الصبح لل 5 المسا',
      'ان شاء الله نتقابل في المكتب الخميس',
    ]) {
      test('survives: $ok', () {
        expect(found(ok), isEmpty);
        expect(cleaned(ok), ok);
      });
    }
  });

  group('after the video call', () {
    test('a phone number is theirs to share', () {
      final r = ContactGuard.apply('رقمي 0599123456', unlocked: true);
      expect(r.redacted, isFalse);
      expect(r.text, contains('0599123456'));
    });

    test('an IBAN is not, at any stage', () {
      final r = ContactGuard.apply(
          'حسابي PS92PALS000000000400123456702', unlocked: true);
      expect(r.found, contains(PersonalDataKind.identifier));
      expect(r.text, isNot(contains('PS92PALS')));
    });

    test('nor is an ID number', () {
      expect(found('هويتي 401234567'), contains(PersonalDataKind.identifier));
    });
  });

  test('the warning names what it found, in Arabic', () {
    final r = ContactGuard.apply('رقمي 0599123456 وساكن شارع الإرسال',
        unlocked: false);
    expect(r.summary, contains('رقم هاتف'));
    expect(r.summary, contains('عنوان'));
  });
}
