import '../core/models.dart';
import '../features/meetings/office_meeting.dart';
import '../features/photos/photo_access.dart';

/// Fixtures for the test build.
///
/// They exist so the app can be installed and walked through end to end
/// without a backend, a Supabase project or a verification service. The
/// numbers here match the seed data in `supabase/seed/`, so what you see on
/// the device is what the database would serve.
class Demo {
  static final me = Profile(
    userId: 'me',
    displayName: 'أميرة',
    age: 27,
    city: 'رام الله',
    country: 'PS',
    maritalStatus: MaritalStatus.neverMarried,
    childrenCount: 0,
    practiceLevel: PracticeLevel.practicing,
    timeline: MarriageTimeline.withinOneYear,
    willingToRelocate: false,
    familyAware: true,
    hasWali: true,
    documentVerified: false,
    identityConfidence: 93,
    bio: 'معلّمة لغة عربية في رام الله. عيلتي عارفة إني بدوّر، وبفكّر بالزواج خلال السنة الجاية.',
    occupation: 'معلّمة',
  );

  static final yousef = Profile(
    userId: 'yousef',
    displayName: 'يوسف',
    age: 32,
    city: 'عمّان',
    country: 'JO',
    maritalStatus: MaritalStatus.neverMarried,
    childrenCount: 0,
    practiceLevel: PracticeLevel.practicing,
    timeline: MarriageTimeline.withinOneYear,
    willingToRelocate: true,
    familyAware: true,
    hasWali: false,
    documentVerified: true,
    identityConfidence: 100,
    bio: 'مهندس مدني في عمّان من خمس سنين، وأصل عيلتي من الخليل. عيلتي عارفة إني بدوّر، '
        'وبفكّر بالزواج خلال السنة الجاية. بحب التاريخ وبلعب كرة كل جمعة.',
    occupation: 'مهندس مدني',
    photoUrls: const ['1.jpg', '2.jpg', '3.jpg'],
  );

  static final samer = Profile(
    userId: 'samer',
    displayName: 'سامر',
    age: 34,
    city: 'نابلس',
    country: 'PS',
    maritalStatus: MaritalStatus.divorced,
    childrenCount: 1,
    practiceLevel: PracticeLevel.moderatelyPracticing,
    timeline: MarriageTimeline.withinTwoYears,
    willingToRelocate: false,
    familyAware: true,
    hasWali: false,
    documentVerified: false,
    identityConfidence: 88,
    bio: 'صيدلاني في نابلس، ولي ابنة عمرها ست سنين تعيش معي. أبحث عن شريكة تقدّر هذا.',
    occupation: 'صيدلاني',
    photoUrls: const ['1.jpg', '2.jpg'],
  );

  static final candidates = [
    Candidate(
      profile: yousef,
      agreements: const [
        'السكن بعد الزواج: بيت مستقل',
        'الإنجاب: خلال سنتين',
        'الإطار الزمني: خلال سنة',
      ],
      disagreements: const ['المدينة: هو في عمّان وأنتِ في رام الله'],
    ),
    Candidate(
      profile: samer,
      agreements: const ['المدينة: كلاكما في الضفة', 'العائلة على علم'],
      disagreements: const ['لديه ابنة من زواج سابق', 'الإطار الزمني: خلال سنتين'],
    ),
  ];

  static final match = Match(
    id: 'match-1',
    other: yousef,
    videoCallDone: false,
    contactUnlocked: false,
    waliPresent: true,
  );

  // The third message carries a phone number, so the redaction and the
  // composer warning can both be seen without typing anything.
  static final messages = [
    Message(
      id: '1',
      senderId: 'yousef',
      body: 'أهلاً، تشرفت بملفك. عيلتي عارفة إني بدوّر، وإذا حابة نحكي بجدية أنا جاهز.',
      sentAt: DateTime.now().subtract(const Duration(hours: 3)),
    ),
    Message(
      id: '2',
      senderId: 'me',
      body: 'أهلاً وسهلاً. بابا هو الولي وهو مطّلع. بحب أعرف أكثر عن عيلتك.',
      sentAt: DateTime.now().subtract(const Duration(hours: 2, minutes: 40)),
    ),
    Message(
      id: '3',
      senderId: 'yousef',
      body: 'أكيد. أبوي من الخليل وأمي من نابلس، وإخوتي ثلاثة. رقمي ⋯ إذا بتحبي نكمل هناك.',
      sentAt: DateTime.now().subtract(const Duration(hours: 2)),
      redacted: true,
    ),
  ];

  static final photoRequests = [
    const PhotoRequestView(
      id: 'req-1',
      name: 'يوسف',
      age: 32,
      city: 'عمّان',
      documentVerified: true,
      note: 'أهلاً، أنا وعيلتي من الخليل وحابب أتعرف عليكم.',
    ),
  ];

  static final grants = [
    GrantView(
      id: 'grant-1',
      name: 'يوسف',
      expiresAt: DateTime.now().add(const Duration(days: 11)),
      viewCount: 3,
      lastViewedAt: DateTime.now().subtract(const Duration(hours: 5)),
    ),
    GrantView(
      id: 'grant-2',
      name: 'سامر',
      expiresAt: DateTime.now().add(const Duration(days: 6)),
      viewCount: 0,
    ),
    // One screenshot already detected: the warning state, one short of the
    // second detection that revokes the grant on its own.
    GrantView(
      id: 'grant-3',
      name: 'خالد',
      expiresAt: DateTime.now().add(const Duration(days: 9)),
      viewCount: 2,
      lastViewedAt: DateTime.now().subtract(const Duration(days: 1)),
      screenshotCount: 1,
      lastScreenshotAt: DateTime.now().subtract(const Duration(hours: 13)),
    ),
  ];

  static final appointment = Appointment(
    officeName: 'مكتب رام الله',
    address: 'شارع الإرسال، عمارة الأمل، الطابق الثالث',
    startsAt: DateTime.now().add(const Duration(days: 2, hours: 5)),
    room: 'غرفة 1',
    staffName: 'أم محمد',
    familyAttending: true,
  );
}
