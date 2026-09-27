import 'package:flutter/material.dart';

import '../../core/models.dart';
import '../../core/theme.dart';

/// What the applicant sees between submitting and being admitted.
///
/// Silence is what makes a gated app feel broken, so this screen always
/// says three things: that a person is looking at it, roughly how long that
/// takes, and what happens next. It never shows a score and never shows the
/// internal check names.
class PendingReviewScreen extends StatelessWidget {
  const PendingReviewScreen({super.key, required this.status, this.submittedAt});

  final AccountStatus status;
  final DateTime? submittedAt;

  @override
  Widget build(BuildContext context) {
    final body = switch (status) {
      AccountStatus.pendingReview => const _Waiting(),
      AccountStatus.rejected => const _Rejected(),
      AccountStatus.admitted => const _Admitted(),
      _ => const _Waiting(),
    };

    return Scaffold(
      body: SafeArea(child: Padding(padding: const EdgeInsets.all(24), child: body)),
    );
  }
}

class _Waiting extends StatelessWidget {
  const _Waiting();

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 40),
          const Icon(Icons.hourglass_empty_rounded, size: 52, color: NasibTheme.teal),
          const SizedBox(height: 20),
          Text('طلبك قيد المراجعة', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 12),
          Text(
            'شخص من فريقنا يراجع طلبك الآن. عادةً تستغرق المراجعة بضع ساعات، ولا تتجاوز 12 ساعة. '
            'سنُشعرك فور الانتهاء.',
            style: Theme.of(context).textTheme.bodyLarge,
          ),
          const SizedBox(height: 28),
          const _Step('تم استلام طلبك', done: true),
          const _Step('تم التحقق من الصورة الحيّة', done: true),
          const _Step('مراجعة بشرية', done: false),
          const Spacer(),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: NasibTheme.ink.withValues(alpha: 0.08)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('لماذا هذه المراجعة؟', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                Text(
                  'لأن كل ملف هنا يمرّ بالمراجعة نفسها. هذا هو السبب الذي يجعل من تقابله حقيقياً.',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ],
            ),
          ),
        ],
      );
}

class _Rejected extends StatelessWidget {
  const _Rejected();

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 40),
          const Icon(Icons.info_outline_rounded, size: 52, color: NasibTheme.caution),
          const SizedBox(height: 20),
          Text('لم نتمكن من قبول طلبك', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 12),
          // A specific reason, and one route to appeal. A rejection with no
          // stated reason cannot be appealed, and reads as an accusation.
          Text(
            'لم نستطع التأكد من أن الصور المرفوعة تعود لك. إن كان هذا خطأً، يمكنك تقديم اعتراض '
            'وسيراجعه شخص من الفريق.',
            style: Theme.of(context).textTheme.bodyLarge,
          ),
          const Spacer(),
          FilledButton(onPressed: () {}, child: const Text('تقديم اعتراض')),
          const SizedBox(height: 10),
          TextButton(onPressed: () {}, child: const Text('إعادة رفع الصور')),
        ],
      );
}

class _Admitted extends StatelessWidget {
  const _Admitted();

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 40),
          const Icon(Icons.verified_rounded, size: 52, color: NasibTheme.verified),
          const SizedBox(height: 20),
          Text('أهلاً بك', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 12),
          Text(
            'تم قبول ملفك. ستصلك أول مجموعة من الأشخاص المقترحين غداً صباحاً.',
            style: Theme.of(context).textTheme.bodyLarge,
          ),
          const Spacer(),
          FilledButton(onPressed: () {}, child: const Text('ابدأ')),
        ],
      );
}

class _Step extends StatelessWidget {
  const _Step(this.label, {required this.done});
  final String label;
  final bool done;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Row(
          children: [
            Icon(
              done ? Icons.check_circle_rounded : Icons.radio_button_unchecked,
              size: 20,
              color: done ? NasibTheme.verified : NasibTheme.muted,
            ),
            const SizedBox(width: 12),
            Text(label, style: Theme.of(context).textTheme.bodyLarge),
          ],
        ),
      );
}
