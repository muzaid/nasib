/// Client-side mirrors of the database enums and rows.
///
/// These are deliberately close to the SQL: when a value can only be one of
/// a fixed set, it is an enum here too, so a typo cannot reach Postgres and
/// a new option cannot be silently ignored by the UI.
library;

enum AccountStatus {
  applying, pendingReview, admitted, rejected,
  shadowLimited, suspended, banned, paused, closed;

  static AccountStatus parse(String v) => switch (v) {
        'applying' => applying,
        'pending_review' => pendingReview,
        'admitted' => admitted,
        'rejected' => rejected,
        'shadow_limited' => shadowLimited,
        'suspended' => suspended,
        'banned' => banned,
        'paused' => paused,
        _ => closed,
      };
}

enum Gender { male, female }

enum MaritalStatus { neverMarried, divorced, widowed }

enum PracticeLevel { practicing, moderatelyPracticing, cultural, preferNotToSay }

enum MarriageTimeline { withinSixMonths, withinOneYear, withinTwoYears, whenRightPerson }

/// How much of a conversation the guardian sees. The user chooses this,
/// and can revoke it — it is a tool for her, not a control over her.
enum WaliLevel {
  off('off'),
  notified('notified'),
  chaperoned('chaperoned'),
  gated('gated');

  const WaliLevel(this.wire);
  final String wire;
}

/// There is no photo-visibility setting, and that is the point. Every photo
/// is served blurred to everyone; the only way past it is a request the
/// owner approves, for a limited time, revocable at any moment. A setting
/// that could un-blur a photo would be a code path we do not want to exist.
///
/// See [PhotoRequestState] and [PhotoGrant].
enum PhotoRequestState {
  pendingAdmin,
  blockedByAdmin,
  pendingOwner,
  approved,
  rejectedByOwner,
  withdrawn,
  expired;

  static PhotoRequestState parse(String v) => switch (v) {
        'pending_admin' => pendingAdmin,
        'blocked_by_admin' => blockedByAdmin,
        'pending_owner' => pendingOwner,
        'approved' => approved,
        'rejected_by_owner' => rejectedByOwner,
        'withdrawn' => withdrawn,
        _ => expired,
      };

  /// What the requester is shown. A blocked request is deliberately
  /// indistinguishable from one still being screened: telling a rejected
  /// requester that a reviewer stopped him invites him to work around it.
  bool get looksPendingToRequester =>
      this == pendingAdmin || this == pendingOwner || this == blockedByAdmin;
}

class PhotoGrant {
  const PhotoGrant({
    required this.id,
    required this.viewerId,
    required this.viewerName,
    required this.expiresAt,
    required this.viewCount,
    this.lastViewedAt,
  });

  final String id;
  final String viewerId;
  final String viewerName;
  final DateTime expiresAt;
  final int viewCount;
  final DateTime? lastViewedAt;

  bool get live => expiresAt.isAfter(DateTime.now());
}

enum MeetingStateDb {
  proposed, declined, pendingScheduling, scheduled, completed, cancelled, noShow;

  static MeetingStateDb parse(String v) => switch (v) {
        'proposed' => proposed,
        'declined' => declined,
        'pending_scheduling' => pendingScheduling,
        'scheduled' => scheduled,
        'completed' => completed,
        'cancelled' => cancelled,
        _ => noShow,
      };
}

class Profile {
  Profile({
    required this.userId,
    required this.displayName,
    required this.age,
    required this.city,
    required this.country,
    required this.maritalStatus,
    required this.childrenCount,
    required this.practiceLevel,
    required this.timeline,
    required this.willingToRelocate,
    required this.familyAware,
    required this.hasWali,
    required this.documentVerified,
    required this.identityConfidence,
    this.bio,
    this.occupation,
    this.education,
    this.photoUrls = const [],
  });

  final String userId;
  final String displayName;
  final int age;
  final String city;
  final String country;
  final MaritalStatus maritalStatus;
  final int childrenCount;
  final PracticeLevel practiceLevel;
  final MarriageTimeline timeline;
  final bool willingToRelocate;
  final bool familyAware;
  final bool hasWali;
  final bool documentVerified;
  final int identityConfidence;
  final String? bio;
  final String? occupation;
  final String? education;
  final List<String> photoUrls;

  factory Profile.fromRow(Map<String, dynamic> row) => Profile(
        userId: row['user_id'] as String,
        displayName: row['display_name'] as String,
        age: row['age'] as int,
        city: (row['city'] ?? '') as String,
        country: (row['country_code'] ?? '') as String,
        maritalStatus: switch (row['marital_status']) {
          'divorced' => MaritalStatus.divorced,
          'widowed' => MaritalStatus.widowed,
          _ => MaritalStatus.neverMarried,
        },
        childrenCount: (row['children_count'] ?? 0) as int,
        practiceLevel: switch (row['practice_level']) {
          'practicing' => PracticeLevel.practicing,
          'moderately_practicing' => PracticeLevel.moderatelyPracticing,
          'cultural' => PracticeLevel.cultural,
          _ => PracticeLevel.preferNotToSay,
        },
        timeline: switch (row['timeline']) {
          'within_6_months' => MarriageTimeline.withinSixMonths,
          'within_1_year' => MarriageTimeline.withinOneYear,
          'within_2_years' => MarriageTimeline.withinTwoYears,
          _ => MarriageTimeline.whenRightPerson,
        },
        willingToRelocate: (row['willing_to_relocate'] ?? false) as bool,
        familyAware: (row['family_aware'] ?? false) as bool,
        hasWali: (row['has_wali'] ?? false) as bool,
        documentVerified: (row['document_verified'] ?? false) as bool,
        identityConfidence: (row['identity_confidence'] ?? 0) as int,
        bio: row['bio'] as String?,
        occupation: row['occupation'] as String?,
        education: row['education'] as String?,
        photoUrls: ((row['photo_urls'] ?? const []) as List).cast<String>(),
      );
}

class Candidate {
  Candidate({required this.profile, required this.agreements, required this.disagreements});

  final Profile profile;

  /// Shown before the first message. Surfacing a deal-breaker early is a
  /// feature, not a lost match.
  final List<String> agreements;
  final List<String> disagreements;
}

class Match {
  Match({
    required this.id,
    required this.other,
    required this.videoCallDone,
    required this.contactUnlocked,
    required this.waliPresent,
  });

  final String id;
  final Profile other;
  final bool videoCallDone;
  final bool contactUnlocked;
  final bool waliPresent;
}

class Message {
  Message({
    required this.id,
    required this.senderId,
    required this.body,
    required this.sentAt,
    this.redacted = false,
  });

  final String id;
  final String senderId;
  final String body;
  final DateTime sentAt;

  /// True when contact details were stripped because the two have not yet
  /// had their in-app video call.
  final bool redacted;
}
