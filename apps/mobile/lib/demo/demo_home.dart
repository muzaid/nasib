import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../core/verification_api.dart';
import '../features/chat/chat_screen.dart';
import '../features/discovery/daily_candidates_screen.dart';
import '../features/meetings/office_meeting.dart';
import '../features/onboarding/application_screen.dart';
import '../features/photos/photo_access.dart';
import '../features/verification/live_capture_screen.dart';
import '../features/verification/pending_review_screen.dart';
import '../l10n/strings_ar.dart';
import '../core/models.dart';
import 'demo_data.dart';

/// The test build's front door.
///
/// The real app routes by account status and nobody ever sees this list —
/// see `_Gate` in main.dart. It exists so that a build you install on a
/// phone can reach every screen in any order, instead of making you sign
/// up seven times to look at the seventh screen.
class DemoHome extends StatelessWidget {
  const DemoHome({super.key, required this.api});

  final VerificationApi api;

  @override
  Widget build(BuildContext context) {
    final entries = <_Entry>[
      _Entry(
        Icons.photo_camera_front_outlined,
        Ar.liveCaptureTitle,
        'الكاميرا تعمل فعلياً: اتبع الحركات وسترى التقدّم',
        (_) => LiveCaptureScreen(api: api),
        primary: true,
      ),
      _Entry(Icons.assignment_outlined, 'طلب الانضمام', 'سبع خطوات',
          (_) => const ApplicationScreen()),
      _Entry(Icons.hourglass_empty_rounded, 'قيد المراجعة', 'ما يراه المتقدّم بعد الإرسال',
          (_) => const PendingReviewScreen(status: AccountStatus.pendingReview)),
      _Entry(Icons.people_alt_outlined, 'مرشّحو اليوم', 'ملفّان كاملان',
          (_) => DailyCandidatesScreen(candidates: Demo.candidates)),
      _Entry(Icons.mark_email_unread_outlined, 'طلبات رؤية الصور', 'قرار الموافقة أو الرفض',
          (_) => PhotoRequestInbox(requests: Demo.photoRequests, onDecide: (_, __) {})),
      _Entry(Icons.visibility_outlined, 'من يرى صوري', 'سحب الإذن، وتنبيه لقطة الشاشة',
          (_) => WhoCanSeeMyPhotos(
                grants: Demo.grants,
                onRevoke: (_) {},
                onRevokeAll: () {},
              )),
      _Entry(Icons.chat_bubble_outline_rounded, 'المحادثة', 'الحجب قبل المكالمة المرئية',
          (_) => ChatScreen(match: Demo.match, messages: Demo.messages, myId: 'me')),
      _Entry(Icons.meeting_room_outlined, 'لقاء المكتب', 'الموعد المؤكد',
          (_) => const _MeetingDemo()),
    ];

    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(22, 26, 22, 30),
          children: [
            const Center(child: StarMark(size: 28)),
            const SizedBox(height: 16),
            Center(
              child: Text(Ar.appName, style: Theme.of(context).textTheme.displaySmall),
            ),
            const SizedBox(height: 4),
            Center(
              child: Text(Ar.demoTitle,
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(color: NasibTheme.inkSoft)),
            ),
            const SizedBox(height: 22),
            for (final e in entries) ...[
              _Tile(entry: e),
              const SizedBox(height: 10),
            ],
            const SizedBox(height: 10),
            Text(
              'هذه النسخة تعمل بلا خادم: البيانات ثابتة، والمطابقة مع الهوية والصور '
              'تتم على الخادم في النسخة الحقيقية.',
              style: Theme.of(context).textTheme.bodyMedium,
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

class _Entry {
  _Entry(this.icon, this.title, this.subtitle, this.build, {this.primary = false});

  final IconData icon;
  final String title;
  final String subtitle;
  final WidgetBuilder build;
  final bool primary;
}

class _Tile extends StatelessWidget {
  const _Tile({required this.entry});

  final _Entry entry;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: entry.primary ? NasibTheme.tealSoft : NasibTheme.panel,
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: entry.build)),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
          child: Row(
            children: [
              Icon(entry.icon, color: NasibTheme.teal, size: 24),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(entry.title,
                        style: Theme.of(context)
                            .textTheme
                            .titleMedium
                            ?.copyWith(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 2),
                    Text(entry.subtitle,
                        style: Theme.of(context).textTheme.bodyMedium),
                  ],
                ),
              ),
              const Icon(Icons.chevron_left_rounded, color: NasibTheme.muted),
            ],
          ),
        ),
      ),
    );
  }
}

class _MeetingDemo extends StatelessWidget {
  const _MeetingDemo();

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text(Ar.officeMeeting)),
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: MeetingCard(
            state: MeetingState.scheduled,
            otherName: Demo.yousef.displayName,
            appointment: Demo.appointment,
            onCancel: () {},
          ),
        ),
      );
}
