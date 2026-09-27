import 'dart:async';
import 'dart:io' show Platform;

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/verification_api.dart';
import '../../l10n/strings_ar.dart';
import 'capture_engine.dart';
import 'face_tracker.dart';

/// The camera step.
///
/// The user looks at the camera and follows a short sequence of
/// instructions. That sequence is issued by the server, randomised per
/// session, and expires in ninety seconds — which is the whole point, since
/// a pre-recorded video cannot satisfy an order it was filmed before.
///
/// Three things govern the design of this screen, and all three are about
/// the honest user rather than the fraudster:
///
///   * **One instruction at a time, very large.** A list of five steps
///     read in advance is a list nobody follows. The screen shows the
///     current instruction and nothing else.
///   * **Never say "failed".** A capture that does not work is almost
///     always bad light, a smudged lens, or a phone held too close. The
///     copy names the likely cause and offers a retake; the word failure
///     belongs to the review desk, not to a woman in her kitchen at night.
///   * **A way out of the spoken step.** Speaking digits defeats a silent
///     video replay, but it excludes anyone who cannot speak, or is
///     somewhere they cannot. There is always an alternative.
class LiveCaptureScreen extends StatefulWidget {
  const LiveCaptureScreen({super.key, required this.api, this.onDone});

  final VerificationApi api;
  final void Function(CaptureVerdict verdict)? onDone;

  @override
  State<LiveCaptureScreen> createState() => _LiveCaptureScreenState();
}

enum _Phase { intro, starting, capturing, submitting, result }

class _LiveCaptureScreenState extends State<LiveCaptureScreen> with WidgetsBindingObserver {
  CameraController? _camera;
  FaceTracker? _tracker;
  CaptureEngine? _engine;
  Challenge? _challenge;

  _Phase _phase = _Phase.intro;
  CaptureVerdict? _verdict;
  String? _cameraError;
  Timer? _deadline;

  /// Two things can end a capture at once — the deadline firing while the
  /// last step completes — and each would show a different verdict. First
  /// one wins.
  bool _finished = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _teardown();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Leaving the app mid-capture ends the attempt rather than resuming it:
    // a sequence paused, edited and resumed is not one sequence.
    //
    // `paused` and `detached` only. `inactive` arrives for a notification
    // peeking in, the shade pulled an inch, a fingerprint sensor waking —
    // all of them near-certain during a minute of holding still, and none
    // of them a reason to throw the attempt away.
    if (_phase != _Phase.capturing) return;
    if (state == AppLifecycleState.paused || state == AppLifecycleState.detached) {
      _finish(CaptureVerdict.retake);
    }
  }

  /// Safe to call from anywhere, twice, concurrently. Every handle is taken
  /// and cleared *before* the first await, so a second call cannot find the
  /// same detector and close it again — which ML Kit answers with an
  /// exception nobody is waiting to catch.
  Future<void> _teardown() async {
    _deadline?.cancel();
    _deadline = null;

    final camera = _camera;
    final tracker = _tracker;
    final engine = _engine;
    _camera = null;
    _tracker = null;
    _engine = null;

    try {
      if (camera != null && camera.value.isStreamingImages) {
        await camera.stopImageStream();
      }
      await camera?.dispose();
    } catch (_) {/* already gone */}
    try {
      await tracker?.dispose();
    } catch (_) {/* already closed */}
    engine?.dispose();
  }

  // ------------------------------------------------------------------ //

  Future<void> _start() async {
    // The button survives one more frame after the tap, so two taps in a
    // single vsync open two cameras — and the second gets CAMERA_IN_USE,
    // permanently, until the app is force-stopped.
    if (_phase == _Phase.starting || _phase == _Phase.capturing) return;

    setState(() {
      _phase = _Phase.starting;
      _cameraError = null;
      _finished = false;
    });

    try {
      final challenge = await widget.api.startCapture();

      final cameras = await availableCameras();
      final front = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.front,
        orElse: () => cameras.first,
      );

      final controller = CameraController(
        front,
        ResolutionPreset.medium,
        enableAudio: false,
        // One plane per frame on both platforms, which is what the
        // detector wants and what keeps the conversion honest. The
        // platforms disagree about which format that is, and asking iOS
        // for nv21 yields frames ML Kit cannot read — a capture screen
        // that sits forever on "we can't see your face".
        imageFormatGroup:
            Platform.isAndroid ? ImageFormatGroup.nv21 : ImageFormatGroup.bgra8888,
      );
      await controller.initialize();

      final tracker = FaceTracker();
      final engine = CaptureEngine(
        steps: challenge.steps,
        mirrored: front.lensDirection == CameraLensDirection.front,
        onStepComplete: (_) => setState(() {}),
        onFinished: _submit,
      );

      if (!mounted) {
        await controller.dispose();
        await tracker.dispose();
        return;
      }

      setState(() {
        _challenge = challenge;
        _camera = controller;
        _tracker = tracker;
        _engine = engine;
        _phase = _Phase.capturing;
      });

      await controller.startImageStream(_onFrame);

      // Armed only once frames are actually flowing, and never before the
      // camera is known good — a timer left running over a failed start is
      // a retake screen that appears ninety seconds later, out of nowhere.
      //
      // The session dies on its own: a challenge with no deadline is a
      // challenge someone can take away and answer at leisure.
      _deadline = Timer(const Duration(seconds: 90), () {
        if (_phase == _Phase.capturing) _finish(CaptureVerdict.retake);
      });
    } catch (_) {
      // Whatever failed, the camera and the detector may already be open.
      // Leaving them open holds the device camera for the rest of the
      // session, and every later attempt then fails with CAMERA_IN_USE.
      await _teardown();
      if (!mounted) return;
      setState(() {
        _phase = _Phase.intro;
        _cameraError = Ar.captureNoCamera;
      });
    }
  }

  void _onFrame(CameraImage image) async {
    final tracker = _tracker, camera = _camera, engine = _engine;
    if (tracker == null || camera == null || engine == null || engine.finished) return;

    final reading = await tracker.read(image, camera, everyFrame: engine.wantsEveryFrame);
    if (reading == null || !mounted) return;

    // The capture can have ended during that await — the deadline, or the
    // user backgrounding the app. Without this, a frame in flight completes
    // the last step after a verdict is already on screen, and the screen
    // flips to a second, different one.
    if (_phase != _Phase.capturing || !identical(_engine, engine)) return;

    if (engine.accept(reading)) setState(() {});
  }

  Future<void> _submit(List<CapturedFrame> frames) async {
    final challenge = _challenge;
    if (challenge == null || _finished || _phase == _Phase.submitting) return;
    if (!mounted) return;

    setState(() => _phase = _Phase.submitting);
    await _teardown();

    final verdict = await widget.api.submitCapture(challenge.sessionId, frames);
    _finish(verdict);
  }

  void _finish(CaptureVerdict verdict) {
    if (_finished) return;
    _finished = true;
    _teardown();
    if (!mounted) return;
    setState(() {
      _verdict = verdict;
      _phase = _Phase.result;
    });
    widget.onDone?.call(verdict);
  }

  // ------------------------------------------------------------------ //

  @override
  Widget build(BuildContext context) {
    if (_phase == _Phase.result && _verdict != null) {
      return _Result(
        verdict: _verdict!,
        onRetake: () => setState(() {
          _verdict = null;
          _challenge = null;
          _cameraError = null;
          _finished = false;
          _phase = _Phase.intro;
        }),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text(Ar.liveCaptureTitle)),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 20),
          child: switch (_phase) {
            _Phase.capturing => _capturing(context),
            _Phase.submitting => _waiting(context, Ar.captureChecking),
            _Phase.starting => _waiting(context, Ar.captureOpening),
            _ => _intro(context),
          },
        ),
      ),
    );
  }

  Widget _waiting(BuildContext context, String label) => Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const CircularProgressIndicator(color: NasibTheme.teal),
          const SizedBox(height: 22),
          Text(label, style: Theme.of(context).textTheme.bodyLarge),
        ],
      );

  Widget _intro(BuildContext context) => ListView(
        children: [
          const SizedBox(height: 12),
          const Center(child: _CameraRing()),
          const SizedBox(height: 28),
          Text(Ar.liveCaptureIntroTitle,
              textAlign: TextAlign.center, style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 12),
          Text(Ar.liveCaptureIntroBody,
              textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyLarge),
          const SizedBox(height: 22),
          const Panel(
            padding: EdgeInsets.fromLTRB(18, 6, 18, 6),
            child: Column(
              children: [
                _Hint(Icons.wb_sunny_outlined, Ar.liveCaptureHintLight),
                _Hint(Icons.no_accounts_outlined, Ar.liveCaptureHintAlone),
                _Hint(Icons.visibility_off_outlined, Ar.liveCaptureHintPrivate, last: true),
              ],
            ),
          ),
          if (_cameraError != null) ...[
            const SizedBox(height: 16),
            Text(_cameraError!,
                textAlign: TextAlign.center,
                style: Theme.of(context)
                    .textTheme
                    .bodyLarge
                    ?.copyWith(color: NasibTheme.danger)),
          ],
          const SizedBox(height: 26),
          FilledButton(onPressed: _start, child: const Text(Ar.liveCaptureStart)),
          const SizedBox(height: 10),
          Center(
            child: Text(Ar.liveCaptureSeconds, style: Theme.of(context).textTheme.bodyMedium),
          ),
          if (widget.api is DemoVerificationApi) ...[
            const SizedBox(height: 26),
            _DemoStrip(api: widget.api as DemoVerificationApi, onChanged: () => setState(() {})),
          ],
        ],
      );

  Widget _capturing(BuildContext context) {
    final engine = _engine!;
    final camera = _camera!;
    final step = engine.current ?? CaptureStep.lookStraight;
    final coaching = switch (engine.coaching) {
      CaptureCoaching.noFace => Ar.coachNoFace,
      CaptureCoaching.tooFar => Ar.coachTooFar,
      CaptureCoaching.tooClose => Ar.coachTooClose,
      CaptureCoaching.severalFaces => Ar.coachSeveralFaces,
      CaptureCoaching.none => null,
    };

    return Column(
      children: [
        // Progress by dots rather than a bar: a bar invites the user to
        // watch it instead of the camera.
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            for (var i = 0; i < engine.steps.length; i++)
              AnimatedContainer(
                duration: const Duration(milliseconds: 220),
                width: i == engine.index ? 22 : 8,
                height: 8,
                margin: const EdgeInsets.symmetric(horizontal: 3),
                decoration: BoxDecoration(
                  color: i <= engine.index ? NasibTheme.teal : NasibTheme.line,
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
          ],
        ),
        const SizedBox(height: 22),

        _CameraRing(controller: camera, hold: engine.hold, warn: coaching != null),

        const SizedBox(height: 26),
        Icon(_iconFor(step), size: 32, color: NasibTheme.teal),
        const SizedBox(height: 12),

        // One instruction, very large. A list read in advance is a list
        // nobody follows.
        Text(
          coaching ?? _instructionFor(step),
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                fontSize: 26,
                color: coaching != null ? NasibTheme.caution : null,
              ),
        ),

        if (step == CaptureStep.speakDigits && _challenge?.spokenDigits != null) ...[
          const SizedBox(height: 14),
          // Forced left-to-right, and never split into space-separated
          // digits. Inside an RTL screen, "4 7 1 9" is four separate
          // numbers and bidi hands them back as 9 1 7 4 — a spoken
          // challenge the honest user then reads out wrong and fails.
          Text(
            _arabicDigits(_challenge!.spokenDigits!),
            textDirection: TextDirection.ltr,
            style: Theme.of(context).textTheme.displaySmall?.copyWith(
                  color: NasibTheme.teal,
                  letterSpacing: 9,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
          ),
          TextButton(
            // Always a way past the spoken step. It excludes anyone who
            // cannot speak, or is somewhere they cannot.
            onPressed: () => setState(engine.skipCurrent),
            child: const Text(Ar.liveCaptureCannotSpeak),
          ),
        ],

        const Spacer(),
        Text(Ar.liveCaptureHoldStill,
            textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyMedium),
      ],
    );
  }
}

String _instructionFor(CaptureStep s) => switch (s) {
      CaptureStep.lookStraight => Ar.stepLookStraight,
      CaptureStep.turnLeft => Ar.stepTurnLeft,
      CaptureStep.turnRight => Ar.stepTurnRight,
      CaptureStep.lookUp => Ar.stepLookUp,
      CaptureStep.blink => Ar.stepBlink,
      CaptureStep.smile => Ar.stepSmile,
      CaptureStep.speakDigits => Ar.stepSpeakDigits,
    };

IconData _iconFor(CaptureStep s) => switch (s) {
      CaptureStep.lookStraight => Icons.center_focus_strong_outlined,
      CaptureStep.turnLeft => Icons.turn_left_rounded,
      CaptureStep.turnRight => Icons.turn_right_rounded,
      CaptureStep.lookUp => Icons.keyboard_arrow_up_rounded,
      CaptureStep.blink => Icons.remove_red_eye_outlined,
      CaptureStep.smile => Icons.sentiment_satisfied_alt_outlined,
      CaptureStep.speakDigits => Icons.mic_none_rounded,
    };

/// Western digits to Arabic-Indic. The rest of the app numbers itself this
/// way, and a challenge is the last place to make someone translate.
String _arabicDigits(String s) {
  const eastern = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return s.split('').map((c) {
    final d = int.tryParse(c);
    return d == null ? c : eastern[d];
  }).join();
}

// --------------------------------------------------------------------- //

/// The viewfinder: a circle, not a rectangle. A face at the right distance
/// fills a circle unambiguously, where a frame invites people to centre the
/// phone instead of their face. The ring fills as a pose is held, so
/// holding still visibly registers.
class _CameraRing extends StatelessWidget {
  const _CameraRing({this.controller, this.hold = 0, this.warn = false});

  final CameraController? controller;
  final double hold;
  final bool warn;

  @override
  Widget build(BuildContext context) {
    const size = 210.0;
    final colour = warn ? NasibTheme.caution : NasibTheme.teal;

    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          ClipOval(
            child: SizedBox(
              width: size - 16,
              height: size - 16,
              child: controller != null && controller!.value.isInitialized
                  ? FittedBox(
                      fit: BoxFit.cover,
                      child: SizedBox(
                        width: controller!.value.previewSize?.height ?? size,
                        height: controller!.value.previewSize?.width ?? size,
                        child: CameraPreview(controller!),
                      ),
                    )
                  : const ColoredBox(
                      color: NasibTheme.panelAlt,
                      child: Center(
                        child: Icon(Icons.photo_camera_front_outlined,
                            size: 56, color: NasibTheme.muted),
                      ),
                    ),
            ),
          ),
          SizedBox(
            width: size,
            height: size,
            child: CircularProgressIndicator(
              value: controller == null ? 0.0 : hold.clamp(0.02, 1.0).toDouble(),
              strokeWidth: 4,
              backgroundColor: NasibTheme.line,
              valueColor: AlwaysStoppedAnimation<Color>(colour),
            ),
          ),
        ],
      ),
    );
  }
}

class _Hint extends StatelessWidget {
  const _Hint(this.icon, this.text, {this.last = false});

  final IconData icon;
  final String text;
  final bool last;

  @override
  Widget build(BuildContext context) => Column(
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 13),
            child: Row(
              children: [
                Icon(icon, size: 20, color: NasibTheme.teal),
                const SizedBox(width: 13),
                Expanded(child: Text(text, style: Theme.of(context).textTheme.bodyLarge)),
              ],
            ),
          ),
          if (!last) const Divider(height: 1),
        ],
      );
}

/// Only in the demo build. The matching itself is server work, so this is
/// how all five outcome screens can be seen on a real device without one.
class _DemoStrip extends StatelessWidget {
  const _DemoStrip({required this.api, required this.onChanged});

  final DemoVerificationApi api;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) => Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Eyebrow(Ar.demoTitle),
            const SizedBox(height: 4),
            Text(Ar.demoBody, style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final v in CaptureVerdict.values)
                  ChoiceChip(
                    label: Text(_label(v)),
                    selected: api.forcedVerdict == v,
                    onSelected: (_) {
                      api.forcedVerdict = v;
                      onChanged();
                    },
                  ),
              ],
            ),
          ],
        ),
      );

  static String _label(CaptureVerdict v) => switch (v) {
        CaptureVerdict.matched => Ar.captureMatched,
        CaptureVerdict.notYourPhotos => Ar.captureNotYourPhotos,
        CaptureVerdict.notYourId => Ar.captureNotYourId,
        CaptureVerdict.retake => Ar.captureRetake,
        CaptureVerdict.underReview => Ar.captureUnderReview,
      };
}

/// The outcome, in the user's terms.
///
/// Note what is absent: a score, a percentage, and the word "failed". The
/// two genuine mismatches get a specific, actionable sentence, because
/// "your photos are of someone else" and "this is not your ID" have
/// different fixes and telling someone the wrong one wastes everyone's day.
class _Result extends StatelessWidget {
  const _Result({required this.verdict, required this.onRetake});

  final CaptureVerdict verdict;
  final VoidCallback onRetake;

  @override
  Widget build(BuildContext context) {
    final (icon, colour, title, body, retake) = switch (verdict) {
      CaptureVerdict.matched => (
          Icons.verified_rounded,
          NasibTheme.verified,
          Ar.captureMatched,
          Ar.captureMatchedBody,
          false,
        ),
      CaptureVerdict.notYourPhotos => (
          Icons.person_off_outlined,
          NasibTheme.danger,
          Ar.captureNotYourPhotos,
          Ar.captureNotYourPhotosBody,
          false,
        ),
      CaptureVerdict.notYourId => (
          Icons.badge_outlined,
          NasibTheme.danger,
          Ar.captureNotYourId,
          Ar.captureNotYourIdBody,
          false,
        ),
      CaptureVerdict.retake => (
          Icons.refresh_rounded,
          NasibTheme.caution,
          Ar.captureRetake,
          Ar.captureRetakeBody,
          true,
        ),
      CaptureVerdict.underReview => (
          Icons.hourglass_empty_rounded,
          NasibTheme.teal,
          Ar.captureUnderReview,
          Ar.captureUnderReviewBody,
          false,
        ),
    };

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(26),
          child: Column(
            children: [
              const SizedBox(height: 50),
              Icon(icon, size: 56, color: colour),
              const SizedBox(height: 22),
              Text(title,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 12),
              Text(body,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyLarge),
              const Spacer(),
              FilledButton(
                onPressed: () {
                  if (retake) {
                    onRetake();
                  } else {
                    Navigator.of(context).maybePop();
                  }
                },
                child: Text(retake ? Ar.captureRetakeAction : Ar.next),
              ),
              if (verdict == CaptureVerdict.notYourPhotos ||
                  verdict == CaptureVerdict.notYourId) ...[
                const SizedBox(height: 8),
                TextButton(onPressed: () {}, child: const Text(Ar.appeal)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
