import 'dart:async';

import 'package:flutter/material.dart';

import 'screen_guard.dart';
import 'theme.dart';
import '../l10n/strings_ar.dart';

/// Wraps any screen that shows someone else's photos or a private
/// conversation.
///
/// Three jobs, in order of how much they are worth:
///
/// 1. **Cover the content while the screen is being recorded.** On iOS this
///    is known before the first frame is captured, so it is real prevention
///    rather than a notification after the loss. On Android FLAG_SECURE has
///    already blacked the recording out, but the cover is harmless and keeps
///    the two platforms behaving the same way to the user.
///
/// 2. **Report the attempt.** The owner of the photos learns who tried and
///    when. This is the part that actually deters — the viewer is named.
///
/// 3. **Tell the viewer, once, what the rules are.** Not a scolding. A
///    person who took a screenshot of a profile probably did not know it
///    was recorded, and saying so plainly is what stops the second one.
class ProtectedScreen extends StatefulWidget {
  const ProtectedScreen({
    super.key,
    required this.child,
    this.onScreenshot,
    this.onRecordingStarted,
  });

  final Widget child;

  /// Called when a screenshot is detected. Wire this to the API so the
  /// event reaches the owner and counts toward the auto-revoke rule.
  final Future<void> Function()? onScreenshot;

  final Future<void> Function()? onRecordingStarted;

  @override
  State<ProtectedScreen> createState() => _ProtectedScreenState();
}

class _ProtectedScreenState extends State<ProtectedScreen> with WidgetsBindingObserver {
  StreamSubscription<void>? _shots;
  bool _warned = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    ScreenGuard.enable();

    _shots = ScreenGuard.onScreenshot.listen((_) async {
      await widget.onScreenshot?.call();
      if (mounted && !_warned) {
        _warned = true;
        _showNotice(Ar.screenshotDetected, Ar.screenshotDetectedBody);
      }
    });

    ScreenGuard.isBeingCaptured.addListener(_onCaptureChanged);
  }

  void _onCaptureChanged() {
    if (ScreenGuard.isBeingCaptured.value) widget.onRecordingStarted?.call();
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _shots?.cancel();
    ScreenGuard.isBeingCaptured.removeListener(_onCaptureChanged);
    WidgetsBinding.instance.removeObserver(this);
    // Released on the way out: leaving FLAG_SECURE on for the whole app
    // blanks every card in the recents switcher, which is disorienting.
    ScreenGuard.disable();
    super.dispose();
  }

  void _showNotice(String title, String body) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: NasibTheme.panel,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: Text(title, style: Theme.of(ctx).textTheme.titleMedium),
        content: Text(body, style: Theme.of(ctx).textTheme.bodyLarge),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text(Ar.understood),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        widget.child,
        if (ScreenGuard.isBeingCaptured.value) const _CaptureCover(),
      ],
    );
  }
}

/// What replaces the screen while a recording or mirror is running. It says
/// why, because a screen that goes blank with no explanation reads as a bug
/// and the user force-quits instead of stopping the recording.
class _CaptureCover extends StatelessWidget {
  const _CaptureCover();

  @override
  Widget build(BuildContext context) {
    return Positioned.fill(
      child: ColoredBox(
        color: NasibTheme.page,
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(34),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const StarMark(size: 34),
                const SizedBox(height: 22),
                Text(
                  Ar.recordingBlocked,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 12),
                Text(
                  Ar.recordingBlockedBody,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
