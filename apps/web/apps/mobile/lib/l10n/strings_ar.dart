/// Every string in the app.
///
/// There is one language here and it is Arabic. Not an Arabic translation
/// of an English product — the copy is written in Arabic first, and there
/// is no English locale to fall back to, because a fallback is how an app
/// ends up half-translated.
///
/// Register: plain Levantine-leaning MSA. Formal enough for a father to
/// read over his daughter's shoulder, plain enough not to sound like a
/// government form.
library;

class Ar {
  // ---------------------------------------------------------------- //
  // Identity
  // ---------------------------------------------------------------- //
  static const appName = 'نصيب';
  static const tagline = 'للزواج، لا لغيره.';

  static const welcomeBody =
      'كل من تقابله هنا مرّ بتحقق من هويته ومراجعة بشرية. '
      'التسجيل طلب انضمام، ولا نقبل الجميع.';

  static const pointLiveness = 'صورة حيّة تثبت أن الشخص حقيقي';
  static const pointReview = 'مراجعة بشرية لكل ملف';
  static const pointWali = 'وضع الوليّ، إن أردت';
  static const pointPhotos = 'صورك مموّهة دائماً، ولا تُكشف إلا بموافقتك';
  static const pointOffice = 'اللقاء الأول في مكتبنا، بحضور موظّف';

  static const start = 'ابدأ طلب الانضمام';
  static const takesMinutes = 'يستغرق من 8 إلى 12 دقيقة';

  // ---------------------------------------------------------------- //
  // Common
  // ---------------------------------------------------------------- //
  static const next = 'متابعة';
  static const back = 'رجوع';
  static const cancel = 'إلغاء';
  static const confirm = 'تأكيد';
  static const send = 'إرسال';
  static const approve = 'أوافق';
  static const reject = 'أرفض';
  static const close = 'إغلاق';
  static const retry = 'إعادة المحاولة';
  static const optional = 'اختياري';
  static const yes = 'نعم';
  static const no = 'لا';
  static const notNow = 'ليس الآن';

  // ---------------------------------------------------------------- //
  // Application
  // ---------------------------------------------------------------- //
  static const stepOf = 'من';
  static const submitApplication = 'إرسال الطلب';

  static const stepBasics = 'من أنت';
  static const stepBasicsSub = 'الأساسيات';
  static const stepFamily = 'وضعك العائلي';
  static const stepFamilySub = 'الحالة الاجتماعية والأبناء';
  static const stepReadiness = 'جاهزيتك للزواج';
  static const stepReadinessSub = 'الإطار الزمني والسكن';
  static const stepAbout = 'عن نفسك';
  static const stepAboutSub = 'بكلماتك أنت';
  static const stepPhotos = 'صورك';
  static const stepPhotosSub = 'تُحفظ مموّهة، ولا تُكشف إلا بإذنك';
  static const stepLiveness = 'إثبات أنك أنت';
  static const stepLivenessSub = 'صورة حيّة، ثلاثون ثانية';
  static const stepPledge = 'تعهّدك';
  static const stepPledgeSub = 'قبل الإرسال';

  static const fieldName = 'الاسم';
  static const fieldNameHint = 'الاسم الأول فقط';
  static const fieldBirth = 'تاريخ الميلاد';
  static const fieldCity = 'المدينة';
  static const fieldCityHint = 'رام الله، عمّان، نابلس، ...';
  static const fieldEducation = 'الدراسة';
  static const fieldWork = 'العمل';

  static const maritalStatus = 'الحالة الاجتماعية';
  static const maritalNever = 'أعزب / عزباء';
  static const maritalDivorced = 'مطلّق / مطلّقة';
  static const maritalWidowed = 'أرمل / أرملة';

  static const childrenCount = 'عدد الأبناء';
  static const childrenNone = 'لا يوجد';

  static const practice = 'الالتزام الديني';
  static const practicePracticing = 'ملتزم';
  static const practiceModerate = 'ملتزم إلى حد ما';
  static const practiceCultural = 'مسلم ثقافياً';
  static const practicePreferNot = 'أفضّل عدم الذكر';

  static const timeline = 'متى تودّ الزواج';
  static const timelineSixMonths = 'خلال 6 شهور';
  static const timelineYear = 'خلال سنة';
  static const timelineTwoYears = 'خلال سنتين';
  static const timelineRightPerson = 'عند وجود الشخص المناسب';

  static const livingAfter = 'أين تودّ السكن بعد الزواج';
  static const livingOwn = 'بيت مستقل';
  static const livingFamily = 'مع العائلة';
  static const livingUndecided = 'لم أقرر';

  static const relocate = 'هل أنت مستعد للانتقال';
  static const relocateMaybe = 'ربما';
  static const familyAware = 'هل عائلتك على علم';
  static const familyNotYet = 'ليس بعد';

  static const aboutYou = 'اكتب عن نفسك';
  static const aboutYouHint = 'ما الذي تبحث عنه؟ كيف تقضي يومك؟';
  static const aboutYouNote = 'اكتب بالعربية الفصحى أو باللهجة — كلاهما مفهوم.';

  static const addPhoto = 'أضف صورة';
  static const photosAlwaysBlurred =
      'كل الصور على هذا التطبيق تُعرض مموّهة. لا يوجد إعداد يجعل صورتك '
      'مكشوفة للجميع — لا الآن ولا لاحقاً.';
  static const photosHowRevealed =
      'إذا أراد أحد رؤية صورك، يقدّم طلباً. يمرّ الطلب على إدارتنا أولاً، '
      'ثم يصلك أنت. القرار قرارك وحدك، ويمكنك سحبه في أي وقت.';

  static const livenessTitle = 'نطلب صورة حيّة مرة واحدة فقط.';
  static const livenessBody =
      'هذه الخطوة هي سبب وجود التطبيق: كل ملف هنا يعود إلى شخص حقيقي تم '
      'التحقق منه. الصورة الحيّة لا تُعرض على أحد، وتُحذف بعد ثلاثين يوماً.';
  static const livenessNote =
      'لن نطلب هويتك في هذه المرحلة. التوثيق بالهوية اختياري ويمنحك شارة أعلى.';

  // ---------------------------------------------------------------- //
  // Guided live capture
  //
  // Never the word "failed". A capture that does not work is almost always
  // bad light or a phone held too close — naming the likely cause is both
  // kinder and more useful than a verdict.
  // ---------------------------------------------------------------- //
  static const liveCaptureTitle = 'التحقق بالكاميرا';
  static const liveCaptureIntroTitle = 'انظر إلى الكاميرا، ونطلب منك حركات بسيطة';
  static const liveCaptureIntroBody =
      'نطابق وجهك مع صورك ومع هويتك. الترتيب يختلف في كل مرة، ولهذا لا ينفع '
      'مقطع مصوّر مسبقاً.';
  static const liveCaptureHintLight = 'اختر مكاناً فيه إضاءة جيدة';
  static const liveCaptureHintAlone = 'كن وحدك في الصورة';
  static const liveCaptureHintPrivate = 'هذه اللقطات لا تُعرض على أحد، وتُحذف بعد ثلاثين يوماً';
  static const liveCaptureStart = 'ابدأ';
  static const liveCaptureSeconds = 'أقل من دقيقة';
  static const liveCaptureHoldStill = 'أبقِ وجهك داخل الدائرة';
  static const liveCaptureCannotSpeak = 'لا أستطيع النطق الآن';

  static const stepLookStraight = 'انظر أمامك مباشرة';
  static const stepTurnLeft = 'أدر رأسك إلى اليسار';
  static const stepTurnRight = 'أدر رأسك إلى اليمين';
  static const stepLookUp = 'ارفع رأسك قليلاً';
  static const stepBlink = 'أغمض عينيك';
  static const stepSmile = 'ابتسم';
  static const stepSpeakDigits = 'اقرأ هذه الأرقام بصوت مسموع';

  static const captureMatched = 'تم التحقق';
  static const captureMatchedBody =
      'الوجه الذي أمام الكاميرا يطابق صورك ويطابق هويتك.';

  static const captureNotYourPhotos = 'صورك ليست لك';
  static const captureNotYourPhotosBody =
      'الوجه أمام الكاميرا لا يطابق الصور التي رفعتها. ارفع صوراً لك أنت، '
      'وأعد المحاولة.';

  static const captureNotYourId = 'الهوية ليست لك';
  static const captureNotYourIdBody =
      'الوجه أمام الكاميرا لا يطابق صورة الهوية. إن كانت الهوية هويتك فعلاً، '
      'قدّم اعتراضاً وسيراجعه شخص من الفريق.';

  static const captureRetake = 'لم تتضح الصورة';
  static const captureRetakeBody =
      'غالباً بسبب الإضاءة أو قرب الهاتف من وجهك. جرّب في مكان أوضح، '
      'وأبعد الهاتف قليلاً.';
  static const captureRetakeAction = 'إعادة المحاولة';

  static const captureUnderReview = 'نراجع النتيجة';
  static const captureUnderReviewBody =
      'شخص من فريقنا سيتأكد بنفسه. سنُشعرك خلال ساعات.';

  // What the screen says while it is working, and what it says when the
  // face is there but the shot is not usable yet. Coaching, not verdicts:
  // the user can act on "move the phone back", and cannot act on "failed".
  static const captureOpening = 'نفتح الكاميرا…';
  static const captureChecking = 'نتحقق الآن…';
  static const captureNoCamera =
      'لم نتمكّن من فتح الكاميرا. تأكد من السماح للتطبيق باستخدامها من الإعدادات.';

  static const coachNoFace = 'لا نرى وجهك — اجعله داخل الدائرة';
  static const coachTooFar = 'اقترب قليلاً من الكاميرا';
  static const coachTooClose = 'أبعد الهاتف قليلاً';
  static const coachSeveralFaces = 'يجب أن تكون وحدك في الصورة';

  // Demo build only. The camera step is real; the matching against the ID
  // and the photos happens on the server, so this build cannot do it.
  static const demoTitle = 'نسخة تجريبية';
  static const demoBody =
      'الكاميرا والحركات تعمل فعلياً على جهازك. المطابقة مع الهوية والصور '
      'تتم على الخادم، فاختر هنا أي نتيجة تريد رؤيتها بعد انتهاء التصوير.';

  static const reverifyTitle = 'تحقق سريع بالكاميرا';
  static const reverifyBody =
      'نطلب هذا من حين لآخر للتأكد أن الحساب ما زال لصاحبه. أقل من دقيقة.';

  static const pledgeMarriage = 'أبحث عن الزواج، لا عن غيره.';
  static const pledgeFree = 'أنا حرّ شرعاً وقانوناً للزواج.';
  static const pledgePhotos = 'الصور التي رفعتها لي أنا.';
  static const pledgeHonest = 'أعلم أن أي معلومة كاذبة تعني إغلاق حسابي نهائياً.';

  // ---------------------------------------------------------------- //
  // Review
  // ---------------------------------------------------------------- //
  static const underReview = 'طلبك قيد المراجعة';
  static const underReviewBody =
      'شخص من فريقنا يراجع طلبك الآن. عادةً تستغرق المراجعة بضع ساعات، ولا '
      'تتجاوز 12 ساعة. سنُشعرك فور الانتهاء.';
  static const reviewStepReceived = 'تم استلام طلبك';
  static const reviewStepLiveness = 'تم التحقق من الصورة الحيّة';
  static const reviewStepHuman = 'مراجعة بشرية';
  static const whyReview = 'لماذا هذه المراجعة؟';
  static const whyReviewBody =
      'لأن كل ملف هنا يمرّ بالمراجعة نفسها. هذا هو السبب الذي يجعل من تقابله حقيقياً.';

  static const rejected = 'لم نتمكن من قبول طلبك';
  static const appeal = 'تقديم اعتراض';
  static const reuploadPhotos = 'إعادة رفع الصور';

  static const admitted = 'أهلاً بك';
  static const admittedBody = 'تم قبول ملفك. ستصلك أول مجموعة من الأشخاص المقترحين غداً صباحاً.';

  // ---------------------------------------------------------------- //
  // Discovery
  // ---------------------------------------------------------------- //
  static const today = 'اليوم';
  static const remaining = 'متبقّون';
  static const interested = 'مهتم';
  static const notInterested = 'لا، شكراً';
  static const doneForToday = 'انتهيت لليوم';
  static const doneForTodayBody =
      'نرسل لك مجموعة جديدة كل صباح. العدد قليل عن قصد — حتى تقرأ الملفات فعلاً.';

  static const readiness = 'جاهزيته للزواج';
  static const inHisWords = 'بكلماته';
  static const inHerWords = 'بكلماتها';
  static const agreeDisagree = 'أين تتفقان وأين تختلفان';
  static const reportProfile = 'الإبلاغ عن هذا الملف';

  static const hasWali = 'هناك وليّ';
  static const familyKnows = 'العائلة على علم';
  static const willRelocate = 'مستعد للانتقال';
  static const prefersToStay = 'يفضّل البقاء';

  // ---------------------------------------------------------------- //
  // Photos — request, approve, revoke
  // ---------------------------------------------------------------- //
  static const photosBlurred = 'الصور مموّهة';
  static const requestToSeePhotos = 'طلب رؤية الصور';
  static const requestSent = 'أُرسل طلبك';
  static const requestPending = 'طلبك قيد المراجعة';
  static const requestPendingBody =
      'يمرّ الطلب على إدارتنا أولاً، ثم يصل صاحب الصور. لن نُعلمك بأي تفاصيل '
      'أخرى، وقد لا يصلك ردّ.';
  static const requestNote = 'كلمة قصيرة مع الطلب';
  static const requestNoteHint = 'تعريف بنفسك أو بعائلتك — سطران يكفيان';
  static const requestLimitReached = 'وصلت إلى الحد اليومي للطلبات';
  static const withdrawRequest = 'سحب الطلب';

  static const photoInbox = 'طلبات رؤية صورك';
  static const photoInboxEmpty = 'لا توجد طلبات حالياً';
  static const wantsToSeePhotos = 'يطلب رؤية صورك';
  static const photoRequestReviewed = 'راجعت الإدارة هذا الطلب قبل أن يصلك.';
  static const approvePhotos = 'أسمح برؤية صوري';
  static const rejectPhotos = 'لا أسمح';
  static const photoDecisionPrivate =
      'قرارك لا يُبلَّغ له بأي تفصيل. لا داعي لتبرير الرفض.';

  static const photoAccessGranted = 'سمحتَ برؤية الصور';
  static const photoAccessFor = 'لمدة 14 يوماً';
  static const whoCanSee = 'من يرى صوري';
  static const whoCanSeeEmpty = 'لا أحد يرى صورك الآن';
  static const revoke = 'سحب الإذن';
  static const revokeAll = 'سحب كل الأذونات';
  static const revokeNoReason = 'لا حاجة لسبب، والسحب فوري.';
  static const viewedTimes = 'شاهدها';
  static const times = 'مرة';
  static const lastViewed = 'آخر مشاهدة';
  // ---------------------------------------------------------------- //
  // Screenshot protection
  //
  // The copy differs by platform because the protection does. Saying
  // "screenshots are blocked" on iOS, where they cannot be, would be a
  // promise the product breaks the first time someone takes one.
  // ---------------------------------------------------------------- //
  static const screenshotWarning = 'لقطات الشاشة ممنوعة على هذه الشاشة، ونُشعر صاحب الصور بأي محاولة.';
  static const screenshotWarningIos =
      'لا يستطيع أي تطبيق منع لقطة الشاشة على الآيفون. لكننا نرصدها، ونُخبر صاحب الصور '
      'باسم من التقطها، ونسحب إذنه تلقائياً عند المحاولة الثانية.';
  static const screenshotBlockedAndroid = 'محاولات التقاط الشاشة محجوبة على هذا الجهاز.';

  static const screenshotDetected = 'رصدنا لقطة شاشة';
  static const screenshotDetectedBody =
      'أُبلغ صاحب الصور بأنك التقطت لقطة شاشة، مع الوقت واسمك. '
      'عند المحاولة الثانية يُسحب إذنك تلقائياً.\n\n'
      'كل صورة تراها تحمل علامة تعريف باسمك، فإن انتشرت عُرف مصدرها.';
  static const understood = 'فهمت';

  static const recordingBlocked = 'تسجيل الشاشة قيد التشغيل';
  static const recordingBlockedBody =
      'أخفينا المحتوى ما دام التسجيل شغّالاً. أوقف التسجيل ليعود الظهور.';

  static const screenshotAlertTitle = 'التقط أحدهم لقطة لصورك';
  static const screenshotAlertBody = 'يمكنك سحب إذنه الآن.';
  static const accessAutoRevoked = 'سُحب الإذن تلقائياً';
  static const accessAutoRevokedBody =
      'حاول الاطّلاع بلقطة شاشة مرتين، فسُحب إذنه دون انتظار قرارك.';
  static const watermarkNote =
      'كل صورة تُعرض تحمل علامة تعريف للشخص الذي يراها، فإن تسرّبت عُرف مصدرها.';

  // ---------------------------------------------------------------- //
  // Chat
  // ---------------------------------------------------------------- //
  static const typeMessage = 'اكتب رسالة';
  static const waliWatching = 'الوليّ يطّلع على المحادثة';
  static const videoCallFirst = 'مكالمة مرئية داخل التطبيق قبل تبادل أي وسيلة تواصل.';
  static const startCall = 'ابدأ';
  static const contactBlocked =
      'لا يمكن إرسال أرقام أو حسابات قبل المكالمة المرئية. '
      'معظم عمليات النصب تبدأ بالانتقال إلى تطبيق آخر.';
  static const contactRemoved = 'حُذفت وسيلة تواصل من هذه الرسالة';
  static const safety = 'الأمان';
  static const reportPerson = 'الإبلاغ عن هذا الشخص';
  static const reportReasons = 'متزوج · طلب مالاً · مضايقة · ملف مزيّف';
  static const blockAndUnmatch = 'حظر وإنهاء التوافق';

  // ---------------------------------------------------------------- //
  // Office meetings
  // ---------------------------------------------------------------- //
  static const officeMeeting = 'لقاء في المكتب';
  static const proposeMeeting = 'اقترح لقاءً في المكتب';
  static const meetingExplainer =
      'اللقاء يكون في أحد مكاتبنا، في غرفة مستقلة، وبحضور موظّف من فريقنا. '
      'أهل الطرفين مرحّب بهم.';
  static const meetingWhyHere =
      'نرتّب اللقاء الأول عندنا لأن هذا ما توافق عليه العائلات، ولأنه يُجنّب '
      'الطرفين أخطر لحظة في أي تعارف: موعد في مكان لا يعرفه أحد.';
  static const bringFamily = 'سأحضر مع أحد من عائلتي';
  static const meetingNote = 'كلمة مع الاقتراح';
  static const meetingProposed = 'اقترحتَ لقاءً';
  static const meetingAwaitingOther = 'بانتظار ردّ الطرف الآخر';
  static const meetingInvited = 'دُعيت إلى لقاء في المكتب';
  static const acceptMeeting = 'أوافق على اللقاء';
  static const declineMeeting = 'ليس الآن';
  static const meetingScheduling = 'نرتّب لكما موعداً';
  static const meetingSchedulingBody =
      'وافق الطرفان. فريقنا يحجز الغرفة ويتواصل معكما بالموعد خلال يوم عمل.';
  static const meetingScheduled = 'الموعد مؤكد';
  static const meetingCancel = 'إلغاء اللقاء';
  static const meetingOffice = 'المكتب';
  static const meetingWhen = 'الموعد';
  static const meetingRoom = 'الغرفة';
  static const meetingStaff = 'الموظّف المسؤول';
  static const meetingDirections = 'الوصول';
  static const meetingBeforeYouCome = 'قبل أن تأتي';
  static const meetingChecklist1 = 'احضر قبل الموعد بعشر دقائق';
  static const meetingChecklist2 = 'أحضِر هويتك';
  static const meetingChecklist3 = 'إن تأخرت أو اعتذرت، أخبرنا من التطبيق';
  static const meetingNoShowNote =
      'نسجّل الحضور. عدم الحضور دون إشعار يُسجَّل في ملفك.';

  // ---------------------------------------------------------------- //
  // Wali
  // ---------------------------------------------------------------- //
  static const wali = 'الوليّ';
  static const waliInvite = 'دعوة وليّ';
  static const waliName = 'الاسم';
  static const waliRelation = 'صلة القرابة';
  static const waliPhone = 'رقم الهاتف';
  static const waliLevel = 'ما الذي يراه';
  static const waliOff = 'لا شيء';
  static const waliNotified = 'يُعلَم بالتوافق ويرى الملف';
  static const waliChaperoned = 'يطّلع على المحادثة';
  static const waliGated = 'موافقته شرط لبدء المحادثة';
  static const waliRevoke = 'إلغاء الوليّ';
  static const waliYours =
      'أنت من يختار الوليّ ومستوى اطّلاعه، وأنت من يلغيه متى شئت.';

  // ---------------------------------------------------------------- //
  // Settings
  // ---------------------------------------------------------------- //
  static const settings = 'الإعدادات';
  static const myPhotos = 'صوري';
  static const pauseAccount = 'إيقاف الحساب مؤقتاً';
  static const deleteAccount = 'حذف الحساب';
  static const deleteAccountBody = 'يُحذف حسابك وكل بياناتك خلال 30 يوماً.';
  static const privacyPolicy = 'سياسة الخصوصية';
  static const terms = 'الشروط';
  static const support = 'الدعم';

  // ---------------------------------------------------------------- //
  // Outcomes
  // ---------------------------------------------------------------- //
  static const outcomeTitle = 'ما الذي حدث؟';
  static const outcomeMarried = 'تزوجنا';
  static const outcomeEngaged = 'خطبنا';
  static const outcomeNotCompatible = 'لم نتوافق';
  static const outcomeEnded = 'انتهى الأمر';
  static const outcomeCongrats = 'مبارك. نغلق حسابك، وندعو لكما بالتوفيق.';
}
