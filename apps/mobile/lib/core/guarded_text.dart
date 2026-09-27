/// Personal details in chat.
///
/// Phone numbers, addresses, emails, links, handles and ID numbers are
/// stripped from messages until the pair have had their in-app video call.
/// This cuts romance-fraud success rates sharply — moving the conversation
/// to WhatsApp is the scammer's first move — and it keeps the relationship
/// where the safety tooling can still see it.
///
/// **This file is not the enforcement point.** The authority is the
/// database trigger in `supabase/migrations/0008_message_redaction.sql`,
/// which rewrites every message before it is stored and which a patched
/// client cannot skip. What happens here is a courtesy: the composer warns
/// the sender *before* they press send, and names what it found, because
/// silently mangling someone's sentence is worse than telling them why it
/// cannot be sent.
///
/// The two must stay in step. The SQL is the authority and its tests in
/// `supabase/tests/test_message_redaction.sql` are what prove the rules;
/// when a pattern changes there, change it here too.
library;

/// What was found, so the warning can be specific. "Your message contains
/// an address" is actionable; "your message was blocked" is not.
enum PersonalDataKind {
  phone,
  address,
  email,
  link,
  handle,
  offPlatform,
  identifier;

  /// Arabic, because every string the user sees is.
  String get label => switch (this) {
        PersonalDataKind.phone => 'رقم هاتف',
        PersonalDataKind.address => 'عنوان',
        PersonalDataKind.email => 'بريد إلكتروني',
        PersonalDataKind.link => 'رابط',
        PersonalDataKind.handle => 'حساب',
        PersonalDataKind.offPlatform => 'تطبيق آخر',
        PersonalDataKind.identifier => 'رقم هوية أو حساب',
      };
}

class ContactGuard {
  static const placeholder = '⋯';

  // ---- normalisation -------------------------------------------------- //

  /// Arabic-Indic and Persian numerals folded to Latin, so one pattern
  /// covers all three scripts. A filter that only knows 0-9 stops nobody
  /// in this market.
  static String _westernDigits(String s) {
    const from = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹';
    final buffer = StringBuffer();
    for (final rune in s.runes) {
      final i = from.indexOf(String.fromCharCode(rune));
      buffer.write(i < 0 ? String.fromCharCode(rune) : '${i % 10}');
    }
    return buffer.toString();
  }

  /// Letters standing in for digits — O for zero, l for one — which is the
  /// first thing anyone tries once a digit filter blocks them.
  ///
  /// Applied ONLY to the patterns that are looking for digits. Applying it
  /// everywhere turns "example.com" into "examp1e.c0m" and the email
  /// pattern stops matching. That was a real bug on the SQL side, caught
  /// by a test, and the same trap is waiting here.
  static String _foldLookalikes(String s) =>
      s.replaceAll(RegExp(r'[Oo]'), '0').replaceAll(RegExp(r'[Il|]'), '1');

  // ---- the patterns, in the order the SQL applies them ---------------- //

  static final _checks = <_Check>[
    // Identifiers before phone numbers: a nine-digit ID and a ten-digit
    // mobile look alike, and the distinction matters after the video call.
    _Check(PersonalDataKind.identifier,
        RegExp(r'([A-Z]{2}[0-9]{2}[A-Z0-9]{10,}|\b[1-9][0-9]{8}\b|[0-9]{12,})'),
        fold: true, minDigits: 6),

    _Check(PersonalDataKind.email,
        RegExp(r'[\w.%+\-]+@[\w.\-]+\.[a-z]{2,}', caseSensitive: false)),

    _Check(PersonalDataKind.link,
        RegExp(
            r'(https?://\S+|www\.\S+|[\w\-]+\.(com|net|org|me|ly|io|co)\b'
            r'|\S+\s(dot|نقطة)\s\S+)',
            caseSensitive: false)),

    _Check(PersonalDataKind.handle, RegExp(r'@[\w.]{3,}')),

    _Check(PersonalDataKind.phone, RegExp(r'([0-9][\s.\-()]{0,3}){6,}'),
        fold: true, minDigits: 4),

    // Spelled out, with up to two filler words between: people write
    // "صفر خمسة تسعة تسعة" the moment digits stop working.
    _Check(
        PersonalDataKind.phone,
        RegExp(
            r'((zero|one|two|three|four|five|six|seven|eight|nine|'
            r'صفر|واحد|اثنين|إثنين|تنين|ثلاثة|تلاتة|اربعة|أربعة|خمسة|'
            r'ستة|سبعة|ثمانية|تمانية|تسعة)(\s+\S+){0,2}\s*){2,}',
            caseSensitive: false)),

    // An address is a place word and what follows it. Nobody sends a
    // street name alone; they send "شارع الإرسال، عمارة الأمل، ط 3".
    _Check(
        PersonalDataKind.address,
        RegExp(
            r'(شارع|شارغ|حارة|حي |منطقة|عمارة|بناية|مبنى|طابق|الطابق|شقة|'
            r'بيت رقم|ص\.ب|صندوق بريد|قرب |بجانب |مقابل |خلف |'
            r'street|st\.|avenue|ave\.|building|bldg|floor|apt|apartment|'
            r'p\.o\. ?box|near |next to |opposite )[^،,.\n]{0,40}',
            caseSensitive: false)),

    _Check(
        PersonalDataKind.offPlatform,
        RegExp(
            r'(whatsapp|whats ?app|telegram|signal app|snapchat|instagram|'
            r'insta|tiktok|viber|imo|botim|واتساب|واتس|الواتس|تلغرام|'
            r'تيليجرام|تلجرام|انستقرام|إنستقرام|انستا|سناب|سنابشات|فايبر)',
            caseSensitive: false)),
  ];

  // ---- the pass -------------------------------------------------------- //

  /// The message as it may be shown, and what was removed from it.
  ///
  /// Matching runs against a normalised copy and the removal is done by
  /// position, so the text the user wrote keeps its own script: a number
  /// in Arabic-Indic digits is found without the message coming back in
  /// Latin ones.
  static GuardResult apply(String input, {required bool unlocked}) {
    final found = <PersonalDataKind>{};
    var out = input;

    for (final check in _checks) {
      // After the video call, only identifiers stay blocked.
      if (unlocked && check.kind != PersonalDataKind.identifier) continue;

      final probe = check.fold
          ? _foldLookalikes(_westernDigits(out))
          : _westernDigits(out);

      final before = out;
      out = _maskByPosition(out, probe, check.pattern, check.minDigits);
      if (out != before) found.add(check.kind);
    }

    return GuardResult(text: out, found: found);
  }

  /// Blank the matched range of [body] using positions found in [probe].
  ///
  /// Every normalisation above is one character for one character, so the
  /// two strings line up index for index.
  static String _maskByPosition(
      String body, String probe, RegExp pattern, int minDigits) {
    final buffer = StringBuffer();
    var cut = 0;

    for (final m in pattern.allMatches(probe)) {
      if (m.end > body.length) break;
      final span = body.substring(m.start, m.end);

      // Without this, "looooool" folds to "1000000l" and is redacted as a
      // phone number. A real number has real digits in it.
      if (minDigits > 0) {
        final digits = RegExp(r'[0-9٠-٩۰-۹]').allMatches(span).length;
        if (digits < minDigits) continue;
      }

      buffer.write(body.substring(cut, m.start));
      buffer.write(placeholder);
      cut = m.end;
    }

    buffer.write(body.substring(cut));
    return buffer.toString();
  }

  /// What the composer needs: what would be removed if this were sent, so
  /// the user can fix it rather than discover it afterwards.
  static Set<PersonalDataKind> wouldRemove(String draft) =>
      apply(draft, unlocked: false).found;
}

class GuardResult {
  const GuardResult({required this.text, required this.found});

  final String text;
  final Set<PersonalDataKind> found;

  bool get redacted => found.isNotEmpty;

  /// "رقم هاتف وعنوان" — for the warning line above the composer.
  String get summary => found.map((k) => k.label).join(' و');
}

class _Check {
  const _Check(this.kind, this.pattern, {this.fold = false, this.minDigits = 0});

  final PersonalDataKind kind;
  final RegExp pattern;
  final bool fold;
  final int minDigits;
}
