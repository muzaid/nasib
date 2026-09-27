import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../l10n/strings_ar.dart';

/// Photo access: asking, deciding, and taking it back.
///
/// Three screens that together make one promise: a face on this platform is
/// never browsable. It is blurred for everyone, and the only way past that
/// is its owner saying yes to one named person, for a limited time, with
/// the right to change her mind at any moment and without explaining.
///
/// The interface reflects that. Approving is a decision with a named person
/// attached; refusing needs no reason and offers none; revoking is one tap
/// and is never softened with a confirmation that asks why.

// ===================================================================== //
// The viewer's side: a blurred gallery, and one way to ask.
// ===================================================================== //

class BlurredGallery extends StatelessWidget {
  const BlurredGallery({
    super.key,
    required this.photoCount,
    required this.revealed,
    required this.requestState,
    this.onRequest,
    this.onWithdraw,
  });

  final int photoCount;
  final bool revealed;

  /// null when nothing has been asked yet.
  final String? requestState;

  final VoidCallback? onRequest;
  final VoidCallback? onWithdraw;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          height: 196,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: photoCount,
            separatorBuilder: (_, __) => const SizedBox(width: 10),
            itemBuilder: (_, i) => _Frame(revealed: revealed, index: i),
          ),
        ),
        const SizedBox(height: 14),
        if (revealed)
          _Granted()
        else
          switch (requestState) {
            null => _AskButton(onPressed: onRequest),
            // Blocked requests read identically to pending ones. Telling a
            // rejected requester that a reviewer stopped him invites him to
            // work out why, and to try again around it.
            'pending_admin' || 'pending_owner' || 'blocked_by_admin' =>
              _Pending(onWithdraw: onWithdraw),
            'rejected_by_owner' || 'expired' => const _Quiet(),
            _ => _AskButton(onPressed: onRequest),
          },
      ],
    );
  }
}

class _Frame extends StatelessWidget {
  const _Frame({required this.revealed, required this.index});
  final bool revealed;
  final int index;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 150,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: NasibTheme.line),
        color: NasibTheme.panel,
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        fit: StackFit.expand,
        children: [
          // A warm veil, not a grey placeholder. The distinction matters:
          // grey reads as a photo that failed to load, and this photo has
          // not failed — it is deliberately covered, and the frame should
          // look like a decision rather than an error.
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topRight,
                end: Alignment.bottomLeft,
                colors: [Color(0xFFDCE6ED), Color(0xFFC2D2DE)],
              ),
            ),
          ),
          if (!revealed)
            const Center(child: StarMark(size: 34, color: Color(0x5914527A))),
          if (revealed)
            Positioned(
              bottom: 8,
              right: 10,
              // Drawn over every revealed photo, carrying the viewer's own
              // token. A leaked screenshot names its source.
              child: Text(
                'NSB·${index.toString().padLeft(2, '0')}',
                style: const TextStyle(
                  fontFamily: NasibTheme.fontFamily,
                  fontSize: 10,
                  color: Color(0x99FFFFFF),
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _AskButton extends StatelessWidget {
  const _AskButton({this.onPressed});
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          OutlinedButton.icon(
            onPressed: onPressed,
            icon: const Icon(Icons.visibility_outlined, size: 18),
            label: const Text(Ar.requestToSeePhotos),
            style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          ),
          const SizedBox(height: 8),
          Text(Ar.photosAlwaysBlurred, style: Theme.of(context).textTheme.bodyMedium),
        ],
      );
}

class _Pending extends StatelessWidget {
  const _Pending({this.onWithdraw});
  final VoidCallback? onWithdraw;

  @override
  Widget build(BuildContext context) => Panel(
        tint: NasibTheme.tealSoft,
        accent: NasibTheme.teal,
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(Ar.requestPending, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 6),
            Text(Ar.requestPendingBody, style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 4),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton(onPressed: onWithdraw, child: const Text(Ar.withdrawRequest)),
            ),
          ],
        ),
      );
}

/// After a refusal the app says nothing further and offers no second
/// attempt. A "try again" button here would turn a no into a negotiation.
class _Quiet extends StatelessWidget {
  const _Quiet();

  @override
  Widget build(BuildContext context) =>
      Text(Ar.photosBlurred, style: Theme.of(context).textTheme.bodyMedium);
}

class _Granted extends StatelessWidget {
  @override
  Widget build(BuildContext context) => Row(
        children: [
          const Icon(Icons.check_circle_outline, size: 18, color: NasibTheme.verified),
          const SizedBox(width: 8),
          Expanded(child: Text(Ar.watermarkNote, style: Theme.of(context).textTheme.bodyMedium)),
        ],
      );
}

// ===================================================================== //
// Asking
// ===================================================================== //

class RequestPhotosSheet extends StatefulWidget {
  const RequestPhotosSheet({super.key, required this.personName, required this.onSend});

  final String personName;
  final void Function(String? note) onSend;

  @override
  State<RequestPhotosSheet> createState() => _RequestPhotosSheetState();
}

class _RequestPhotosSheetState extends State<RequestPhotosSheet> {
  final _note = TextEditingController();

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.fromLTRB(
            20, 20, 20, MediaQuery.viewInsetsOf(context).bottom + 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(Ar.requestToSeePhotos, style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 10),
            Text(Ar.requestPendingBody, style: Theme.of(context).textTheme.bodyLarge),
            const SizedBox(height: 18),
            Text(Ar.requestNote, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            TextField(
              controller: _note,
              maxLines: 3,
              maxLength: 200,
              decoration: const InputDecoration(hintText: Ar.requestNoteHint),
            ),
            const SizedBox(height: 4),
            FilledButton(
              onPressed: () {
                widget.onSend(_note.text.trim().isEmpty ? null : _note.text.trim());
                Navigator.of(context).pop();
              },
              child: const Text(Ar.send),
            ),
          ],
        ),
      );
}

// ===================================================================== //
// The owner's side: the inbox
// ===================================================================== //

class PhotoRequestInbox extends StatelessWidget {
  const PhotoRequestInbox({super.key, required this.requests, required this.onDecide});

  final List<PhotoRequestView> requests;
  final void Function(String requestId, bool approve) onDecide;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text(Ar.photoInbox)),
      body: requests.isEmpty
          ? Center(
              child: Text(Ar.photoInboxEmpty, style: Theme.of(context).textTheme.bodyLarge))
          : ListView.separated(
              padding: const EdgeInsets.all(20),
              itemCount: requests.length,
              separatorBuilder: (_, __) => const SizedBox(height: 14),
              itemBuilder: (_, i) => _RequestCard(
                request: requests[i],
                onDecide: onDecide,
              ),
            ),
    );
  }
}

class PhotoRequestView {
  const PhotoRequestView({
    required this.id,
    required this.name,
    required this.age,
    required this.city,
    required this.documentVerified,
    this.note,
  });

  final String id;
  final String name;
  final int age;
  final String city;
  final bool documentVerified;
  final String? note;
}

class _RequestCard extends StatelessWidget {
  const _RequestCard({required this.request, required this.onDecide});

  final PhotoRequestView request;
  final void Function(String, bool) onDecide;

  @override
  Widget build(BuildContext context) {
    // A Panel rather than a Card: the panel is this app's surface — white,
    // hairline, no shadow — and it costs nothing to say so directly. It
    // also keeps the theme free of `cardTheme`, whose type changed under
    // us between Flutter releases and broke a build for no benefit.
    return Panel(
      padding: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text('${request.name}، ${request.age}',
                      style: Theme.of(context).textTheme.titleMedium),
                ),
                BadgeChip(request.documentVerified
                    ? VerificationBadge.idVerified
                    : VerificationBadge.photoVerified),
              ],
            ),
            const SizedBox(height: 2),
            Text('${request.city} · ${Ar.wantsToSeePhotos}',
                style: Theme.of(context).textTheme.bodyMedium),

            if (request.note != null) ...[
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: NasibTheme.page,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(request.note!, style: Theme.of(context).textTheme.bodyLarge),
              ),
            ],

            const SizedBox(height: 12),
            Row(
              children: [
                const Icon(Icons.verified_user_outlined, size: 16, color: NasibTheme.muted),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(Ar.photoRequestReviewed,
                      style: Theme.of(context).textTheme.bodyMedium),
                ),
              ],
            ),

            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => onDecide(request.id, false),
                    child: const Text(Ar.rejectPhotos),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton(
                    onPressed: () => onDecide(request.id, true),
                    child: const Text(Ar.approvePhotos),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(Ar.photoDecisionPrivate, style: Theme.of(context).textTheme.bodyMedium),
          ],
        ),
      ),
    );
  }
}

// ===================================================================== //
// Taking it back
// ===================================================================== //

class GrantView {
  const GrantView({
    required this.id,
    required this.name,
    required this.expiresAt,
    required this.viewCount,
    this.lastViewedAt,
    this.screenshotCount = 0,
    this.lastScreenshotAt,
  });

  final String id;
  final String name;
  final DateTime expiresAt;
  final int viewCount;
  final DateTime? lastViewedAt;

  /// Detected screenshots. Two of them revoke the grant on their own, so a
  /// count of one here is a person who has had their warning.
  final int screenshotCount;
  final DateTime? lastScreenshotAt;
}

class WhoCanSeeMyPhotos extends StatelessWidget {
  const WhoCanSeeMyPhotos({
    super.key,
    required this.grants,
    required this.onRevoke,
    required this.onRevokeAll,
  });

  final List<GrantView> grants;
  final void Function(String grantId) onRevoke;
  final VoidCallback onRevokeAll;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text(Ar.whoCanSee)),
      body: grants.isEmpty
          ? Center(
              child: Text(Ar.whoCanSeeEmpty, style: Theme.of(context).textTheme.bodyLarge))
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                for (final g in grants) ...[
                  Panel(
                    padding: const EdgeInsets.fromLTRB(16, 12, 10, 12),
                    accent: g.screenshotCount > 0 ? NasibTheme.danger : null,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(g.name,
                                      style: Theme.of(context).textTheme.titleMedium),
                                  Text(
                                    '${Ar.viewedTimes} ${g.viewCount} ${Ar.times} · '
                                    '${_daysLeft(g.expiresAt)}',
                                    style: Theme.of(context).textTheme.bodyMedium,
                                  ),
                                ],
                              ),
                            ),
                            // One tap, no dialog asking why. Requiring a
                            // reason to withdraw consent defeats the point
                            // of having asked for it.
                            TextButton(
                              onPressed: () => onRevoke(g.id),
                              style: TextButton.styleFrom(foregroundColor: NasibTheme.danger),
                              child: const Text(Ar.revoke),
                            ),
                          ],
                        ),
                        // Surfaced prominently and never buried in a log.
                        // Finding out weeks later that someone kept a copy
                        // of your face is the thing this feature exists to
                        // prevent.
                        if (g.screenshotCount > 0) ...[
                          const SizedBox(height: 10),
                          Row(
                            children: [
                              const Icon(Icons.warning_amber_rounded,
                                  size: 18, color: NasibTheme.danger),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  Ar.screenshotAlertTitle,
                                  style: Theme.of(context)
                                      .textTheme
                                      .bodyMedium
                                      ?.copyWith(color: NasibTheme.danger),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                ],
                const SizedBox(height: 10),
                Text(Ar.revokeNoReason, style: Theme.of(context).textTheme.bodyMedium),
                const SizedBox(height: 4),
                Text(Ar.screenshotWarning, style: Theme.of(context).textTheme.bodyMedium),
                const SizedBox(height: 20),
                OutlinedButton(
                  onPressed: onRevokeAll,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: NasibTheme.danger,
                    minimumSize: const Size.fromHeight(48),
                  ),
                  child: const Text(Ar.revokeAll),
                ),
              ],
            ),
    );
  }

  static String _daysLeft(DateTime expires) {
    final days = expires.difference(DateTime.now()).inDays;
    return days <= 0 ? 'ينتهي اليوم' : 'يتبقى $days يوماً';
  }
}
