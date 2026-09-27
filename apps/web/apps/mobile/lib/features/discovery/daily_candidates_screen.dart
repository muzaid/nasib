import 'package:flutter/material.dart';

import '../../core/models.dart';
import '../../core/protected_screen.dart';
import '../../core/theme.dart';
import '../../l10n/strings_ar.dart';
import '../photos/photo_access.dart';

/// Today's candidates.
///
/// No swipe deck. Five to eight people a day, each shown as a full profile
/// that has to be accepted or declined deliberately. When candidates are
/// scarce people read profiles instead of rating faces, and the
/// conversation that follows starts from something real.
///
/// There is no "who liked you", no boost, no super-like. Those monetise
/// anxiety, which is the wrong business to be in here.
class DailyCandidatesScreen extends StatefulWidget {
  const DailyCandidatesScreen({super.key, required this.candidates});

  final List<Candidate> candidates;

  @override
  State<DailyCandidatesScreen> createState() => _DailyCandidatesScreenState();
}

class _DailyCandidatesScreenState extends State<DailyCandidatesScreen> {
  int _index = 0;

  void _decide(bool interested) {
    // Interest is one-directional and private: a declined person is never
    // told, and the user is never told they were declined either.
    setState(() => _index++);
  }

  @override
  Widget build(BuildContext context) {
    if (_index >= widget.candidates.length) return const _SlateFinished();

    final candidate = widget.candidates[_index];
    final remaining = widget.candidates.length - _index;

    // Someone else's photos are on this screen, blurred or revealed. On
    // Android the window is FLAG_SECURE from here; on iOS a recording is
    // caught before it captures a frame and a screenshot is reported to
    // the person whose face it was.
    return ProtectedScreen(
      onScreenshot: () async {
        // api.reportScreenshot(grantId) — 'revoked' means this viewer has
        // just lost access and the screen should fall back to blurred.
      },
      child: Scaffold(
      appBar: AppBar(
        title: const Text(Ar.today),
        actions: [
          Padding(
            padding: const EdgeInsets.only(left: 16),
            child: Center(
              child: Text('$remaining ${Ar.remaining}',
                  style: Theme.of(context).textTheme.bodyMedium),
            ),
          ),
        ],
      ),
      body: _CandidateCard(candidate: candidate),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
          child: Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _decide(false),
                  style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                  child: const Text(Ar.notInterested),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                flex: 2,
                child: FilledButton(
                  onPressed: () => _decide(true),
                  child: const Text(Ar.interested),
                ),
              ),
            ],
          ),
        ),
      ),
      ),
    );
  }
}

class _CandidateCard extends StatelessWidget {
  const _CandidateCard({required this.candidate});

  final Candidate candidate;

  @override
  Widget build(BuildContext context) {
    final p = candidate.profile;

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
      children: [
        Row(
          children: [
            Expanded(
              child: Text('${p.displayName}، ${p.age}',
                  style: Theme.of(context).textTheme.headlineSmall),
            ),
            BadgeChip(p.documentVerified
                ? VerificationBadge.idVerified
                : p.identityConfidence >= 75
                    ? VerificationBadge.photoVerified
                    : VerificationBadge.unverified),
          ],
        ),
        const SizedBox(height: 4),
        Text('${p.city} · ${p.occupation ?? ""}',
            style: Theme.of(context).textTheme.bodyMedium),

        const SizedBox(height: 18),
        // Blurred is the normal state, not a placeholder for a photo that
        // failed to load. Seeing a face requires asking, and the owner
        // saying yes.
        BlurredGallery(
          photoCount: p.photoUrls.isEmpty ? 3 : p.photoUrls.length,
          revealed: false,
          requestState: null,
          onRequest: () => showModalBottomSheet<void>(
            context: context,
            isScrollControlled: true,
            builder: (_) => RequestPhotosSheet(
              personName: p.displayName,
              onSend: (note) {},
            ),
          ),
        ),

        const SizedBox(height: 22),
        _Section(
          title: Ar.readiness,
          child: Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _Fact(_timelineLabel(p.timeline)),
              _Fact(_maritalLabel(p.maritalStatus, p.childrenCount)),
              if (p.familyAware) const _Fact(Ar.familyKnows),
              if (p.hasWali) const _Fact(Ar.hasWali),
              _Fact(p.willingToRelocate ? Ar.willRelocate : Ar.prefersToStay),
            ],
          ),
        ),

        if (p.bio != null) ...[
          const SizedBox(height: 22),
          _Section(
            title: Ar.inHisWords,
            child: Text(p.bio!, style: Theme.of(context).textTheme.bodyLarge),
          ),
        ],

        const SizedBox(height: 22),
        // Agreement and disagreement are both shown *before* the first
        // message. Surfacing a deal-breaker early is a feature, not a lost
        // match — it is the single biggest time-saver for serious users.
        _Section(
          title: Ar.agreeDisagree,
          child: Column(
            children: [
              for (final a in candidate.agreements)
                _Agreement(a, agree: true),
              for (final d in candidate.disagreements)
                _Agreement(d, agree: false),
            ],
          ),
        ),

        const SizedBox(height: 28),
        Center(
          child: TextButton.icon(
            onPressed: () {},
            icon: const Icon(Icons.flag_outlined, size: 18),
            label: const Text(Ar.reportProfile),
            style: TextButton.styleFrom(foregroundColor: NasibTheme.muted),
          ),
        ),
      ],
    );
  }

  static String _timelineLabel(MarriageTimeline t) => switch (t) {
        MarriageTimeline.withinSixMonths => 'يريد الزواج خلال 6 شهور',
        MarriageTimeline.withinOneYear => 'خلال سنة',
        MarriageTimeline.withinTwoYears => 'خلال سنتين',
        MarriageTimeline.whenRightPerson => 'عند الشخص المناسب',
      };

  static String _maritalLabel(MaritalStatus s, int children) {
    final base = switch (s) {
      MaritalStatus.neverMarried => 'أعزب',
      MaritalStatus.divorced => 'مطلّق',
      MaritalStatus.widowed => 'أرمل',
    };
    return children == 0 ? base : '$base · $children من الأبناء';
  }
}

class _SlateFinished extends StatelessWidget {
  const _SlateFinished();

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.done_all_rounded, size: 48, color: NasibTheme.teal),
                const SizedBox(height: 16),
                Text(Ar.doneForToday, style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 10),
                // No "unlock more" button. The limit is the product.
                Text(
                  Ar.doneForTodayBody,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
              ],
            ),
          ),
        ),
      );
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 10),
          child,
        ],
      );
}

class _Fact extends StatelessWidget {
  const _Fact(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: NasibTheme.ink.withValues(alpha: 0.10)),
        ),
        child: Text(text, style: const TextStyle(fontSize: 13.5)),
      );
}

class _Agreement extends StatelessWidget {
  const _Agreement(this.text, {required this.agree});
  final String text;
  final bool agree;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              agree ? Icons.check_circle_outline : Icons.remove_circle_outline,
              size: 18,
              color: agree ? NasibTheme.verified : NasibTheme.caution,
            ),
            const SizedBox(width: 10),
            Expanded(child: Text(text, style: Theme.of(context).textTheme.bodyLarge)),
          ],
        ),
      );
}
