import 'package:supabase_flutter/supabase_flutter.dart';

import 'models.dart';

/// Data access.
///
/// The client talks to Postgres directly through Supabase, so row-level
/// security is the authorisation layer — not a convenience on top of one.
/// Nothing here may be trusted to enforce access; every query below is
/// already constrained by a policy in `0002_rls.sql`.
///
/// The verification service is a separate host with its own token, because
/// biometric data must stay out of the main database's blast radius.
class NasibApi {
  NasibApi(this._db);

  final SupabaseClient _db;

  String get _uid => _db.auth.currentUser!.id;

  // ------------------------------------------------------------------ //
  // Account state
  // ------------------------------------------------------------------ //

  Future<AccountStatus> accountStatus() async {
    final row = await _db.from('users').select('status').eq('id', _uid).single();
    return AccountStatus.parse(row['status'] as String);
  }

  /// Polled while an application is under review. The user is told a person
  /// is looking at it and roughly how long that takes — silence is what
  /// makes a gated app feel broken.
  Stream<AccountStatus> watchAccountStatus() => _db
      .from('users')
      .stream(primaryKey: ['id'])
      .eq('id', _uid)
      .map((rows) => AccountStatus.parse(rows.first['status'] as String));

  // ------------------------------------------------------------------ //
  // Application
  // ------------------------------------------------------------------ //

  Future<void> saveProfile(Map<String, dynamic> fields) =>
      _db.from('profiles').upsert({'user_id': _uid, ...fields});

  Future<void> savePreferences(Map<String, dynamic> fields) =>
      _db.from('match_preferences').upsert({'user_id': _uid, ...fields});

  Future<void> answerCompatibility(String key, String answer) =>
      _db.from('compatibility_answers').upsert({
        'user_id': _uid,
        'question_key': key,
        'answer': answer,
      });

  /// Photos are uploaded through the verification service, which writes the
  /// original to a private bucket the app can never read and generates the
  /// blurred derivative that everyone sees. The client never holds a clear
  /// image of anyone but itself.
  Future<void> uploadPhoto(String localPath, {required int ordinal}) =>
      _db.functions.invoke('upload-photo', body: {'ordinal': ordinal, 'path': localPath});

  // ------------------------------------------------------------------ //
  // Photo access
  //
  // Every photo on this platform is blurred. There is no visibility
  // setting and no tier that un-blurs one; the only route is a request the
  // owner approves, time-limited and revocable. These methods are the
  // whole of that route.
  // ------------------------------------------------------------------ //

  /// Blurred images plus a `revealed` flag. Never carries the original path.
  Future<List<Map<String, dynamic>>> gallery(String ownerId) async =>
      (await _db.from('photo_gallery').select().eq('user_id', ownerId))
          .cast<Map<String, dynamic>>();

  /// The clear image, one photo at a time, only while a grant is live. What
  /// comes back is a watermarked copy carrying the viewer's own token, so a
  /// leaked screenshot names its source.
  Future<String> revealedPhotoUrl(String photoId) async {
    final objectPath = await _db.rpc('reveal_photo', params: {'photo_id': photoId}) as String;
    return _db.storage.from('photo-reveals').createSignedUrl(objectPath, 60 * 5);
  }

  Future<String> requestPhotoAccess(String ownerId, {String? note}) async =>
      await _db.rpc('request_photo_access', params: {'owner': ownerId, 'note': note}) as String;

  Future<void> withdrawPhotoRequest(String requestId) =>
      _db.rpc('withdraw_photo_request', params: {'request_id': requestId});

  /// Requests waiting on the user. Requests a reviewer blocked never appear
  /// here at all — she is not troubled by them.
  Future<List<Map<String, dynamic>>> incomingPhotoRequests() async =>
      (await _db
              .from('photo_access_requests')
              .select()
              .eq('owner_id', _uid)
              .eq('state', 'pending_owner')
              .order('created_at'))
          .cast<Map<String, dynamic>>();

  Future<void> respondToPhotoRequest(String requestId, {required bool approve}) =>
      _db.rpc('respond_to_photo_request',
          params: {'request_id': requestId, 'approve': approve});

  /// Who can see her photos, with what each of them did: views, the last
  /// view, and any screenshot we detected. The view carries no contact
  /// details for the viewer — only the name already on his profile.
  Future<List<Map<String, dynamic>>> myPhotoGrants() async =>
      (await _db
              .from('my_photo_grants')
              .select()
              .isFilter('revoked_at', null)
              .order('granted_at', ascending: false))
          .cast<Map<String, dynamic>>();

  /// No reason required, effective immediately.
  Future<void> revokePhotoAccess(String grantId) =>
      _db.rpc('revoke_photo_access', params: {'owner_or_viewer_grant': grantId});

  Future<int> revokeAllPhotoAccess() async =>
      await _db.rpc('revoke_all_photo_access') as int;

  /// Reported by the client when the OS signals a capture.
  ///
  /// Returns what to tell the viewer: `warned` on a first screenshot,
  /// `revoked` when this one crossed the threshold and their access has
  /// just been withdrawn, `noted` for a recording or a plain view.
  ///
  /// The events table is not writable directly — everything goes through
  /// this function, which is where the ownership check and the threshold
  /// live. A client cannot run up someone else's count.
  Future<String> recordScreenEvent(String grantId, String kind) async =>
      await _db.rpc('record_screen_event',
          params: {'p_grant_id': grantId, 'p_kind': kind}) as String;

  Future<String> reportScreenshot(String grantId) =>
      recordScreenEvent(grantId, 'screenshot_attempt');

  Future<String> reportScreenRecording(String grantId) =>
      recordScreenEvent(grantId, 'screen_recording');

  // ------------------------------------------------------------------ //
  // Office meetings
  // ------------------------------------------------------------------ //

  Future<String> proposeOfficeMeeting(String matchId,
          {bool bringsFamily = false, String? note}) async =>
      await _db.rpc('propose_office_meeting',
          params: {'p_match_id': matchId, 'brings_family': bringsFamily, 'note': note}) as String;

  Future<void> respondToMeeting(String meetingId,
          {required bool accept, bool bringsFamily = false}) =>
      _db.rpc('respond_to_meeting', params: {
        'p_meeting_id': meetingId,
        'accept': accept,
        'brings_family': bringsFamily,
      });

  Future<void> cancelMeeting(String meetingId, {String? reason}) =>
      _db.rpc('cancel_meeting', params: {'p_meeting_id': meetingId, 'reason': reason});

  Future<List<Map<String, dynamic>>> myMeetings() async =>
      (await _db.from('meetings').select().order('proposed_at', ascending: false))
          .cast<Map<String, dynamic>>();

  /// Users never pick their own slot — they agree to meet and we find the
  /// room. That keeps the office's real schedule private and means a person
  /// has looked at the pairing before the door opens. This is here only so
  /// the app can say when the next opening is.
  Future<List<Map<String, dynamic>>> openSlots({String? city}) async =>
      (await _db.rpc('open_slots', params: {'p_city': city})).cast<Map<String, dynamic>>();

  // ------------------------------------------------------------------ //
  // Discovery
  // ------------------------------------------------------------------ //

  /// Draws today's slate, or returns the one already drawn. Calling twice
  /// in a day does not produce more candidates — the limit is real, which
  /// is the whole point of the interaction model.
  Future<List<Candidate>> todaysCandidates() async {
    await _db.rpc('draw_daily_slate', params: {'viewer': _uid, 'slate_size': 6});
    final rows = await _db.rpc('todays_slate_view', params: {'viewer': _uid}) as List;
    return rows
        .cast<Map<String, dynamic>>()
        .map((r) => Candidate(
              profile: Profile.fromRow(r),
              agreements: ((r['agreements'] ?? const []) as List).cast<String>(),
              disagreements: ((r['disagreements'] ?? const []) as List).cast<String>(),
            ))
        .toList();
  }

  /// Returns a match id when the interest is reciprocated, null otherwise.
  /// The user is never told that someone declined them.
  Future<String?> expressInterest(String candidateId, {required bool interested, String? note}) async {
    final result = await _db.rpc('express_interest', params: {
      'viewer': _uid,
      'candidate': candidateId,
      'interested': interested,
      'note': note,
    });
    return result as String?;
  }

  // ------------------------------------------------------------------ //
  // Conversation
  // ------------------------------------------------------------------ //

  Stream<List<Message>> watchMessages(String matchId) => _db
      .from('messages')
      .stream(primaryKey: ['id'])
      .eq('match_id', matchId)
      .order('created_at')
      .map((rows) => rows
          .map((r) => Message(
                id: r['id'] as String,
                senderId: r['sender_id'] as String,
                body: r['body'] as String,
                sentAt: DateTime.parse(r['created_at'] as String),
                redacted: (r['redacted'] ?? false) as bool,
              ))
          .toList());

  /// The server redacts contact details again on write. Client-side
  /// redaction exists to show the user what will happen, not to enforce it.
  Future<void> sendMessage(String matchId, String body) =>
      _db.from('messages').insert({
        'match_id': matchId,
        'sender_id': _uid,
        'body': body,
      });

  Future<void> markVideoCallCompleted(String matchId) async {
    await _db.from('matches').update({'video_call_at': DateTime.now().toIso8601String()})
        .eq('id', matchId);
    await _db.rpc('unlock_contact', params: {'match_id': matchId});
  }

  // ------------------------------------------------------------------ //
  // Safety
  // ------------------------------------------------------------------ //

  /// A report on an active conversation reaches a human within minutes and
  /// silently limits the reported account pending review. The reported user
  /// is never told who reported them.
  Future<void> report(String userId, {required String reason, String? detail, String? matchId}) =>
      _db.from('reports').insert({
        'reporter_id': _uid,
        'reported_id': userId,
        'match_id': matchId,
        'reason': reason,
        'detail': detail,
      });

  Future<void> block(String userId) =>
      _db.from('blocks').insert({'blocker_id': _uid, 'blocked_id': userId});

  // ------------------------------------------------------------------ //
  // Wali
  // ------------------------------------------------------------------ //

  Future<void> inviteGuardian({
    required String fullName,
    required String relation,
    required String phone,
    required WaliLevel level,
  }) =>
      _db.from('guardians').insert({
        'user_id': _uid,
        'full_name': fullName,
        'relation': relation,
        'phone_e164': phone,
        'level': level.wire,
      });

  /// The guardian arrangement is always revocable by the user who made it.
  Future<void> revokeGuardian(String guardianId) => _db
      .from('guardians')
      .update({'revoked_at': DateTime.now().toIso8601String()})
      .eq('id', guardianId);

  // ------------------------------------------------------------------ //
  // Outcomes — the metric that matters
  // ------------------------------------------------------------------ //

  Future<void> recordOutcome(String? matchId, String kind, {String? note}) =>
      _db.from('outcomes').insert({
        'match_id': matchId,
        'user_id': _uid,
        'kind': kind,
        'note': note,
      });

  /// Deleting an account must actually delete it, and must be reachable
  /// from inside the app — both stores require this, and it is the right
  /// default regardless.
  Future<void> deleteAccount() => _db.rpc('request_account_deletion');
}
