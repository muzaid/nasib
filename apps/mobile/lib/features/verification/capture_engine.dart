import 'dart:math' as math;

import 'face_tracker.dart';

/// The steps the server can ask for. The wire values match
/// `ChallengeStep` in the verification service.
enum CaptureStep {
  lookStraight('look_straight'),
  turnLeft('turn_left'),
  turnRight('turn_right'),
  lookUp('look_up'),
  blink('blink'),
  smile('smile'),
  speakDigits('speak_digits');

  const CaptureStep(this.wire);
  final String wire;

  static CaptureStep fromWire(String w) =>
      CaptureStep.values.firstWhere((s) => s.wire == w, orElse: () => CaptureStep.lookStraight);
}

/// What the user is doing wrong *right now*, so the screen can say it
/// instead of leaving them staring at an instruction that will not clear.
enum CaptureCoaching { none, noFace, tooFar, tooClose, severalFaces }

/// One recorded frame. These are the fields the server's `LiveFrame` model
/// reads; the image itself is captured separately and uploaded with them.
class CapturedFrame {
  CapturedFrame({
    required this.step,
    required this.capturedAtMs,
    required this.yaw,
    required this.pitch,
    required this.eyesOpen,
  });

  final CaptureStep step;
  final int capturedAtMs;
  final double yaw;
  final double pitch;
  final bool eyesOpen;

  Map<String, dynamic> toJson() => {
        'step': step.wire,
        'captured_at_ms': capturedAtMs,
        'yaw': yaw,
        'pitch': pitch,
        'eyes_open': eyesOpen,
      };
}

/// Drives the challenge: one step at a time, each completed by the face
/// actually doing the thing.
///
/// Two numbers matter and both are about the honest user. [_holdMs] is how
/// long a pose must be held — long enough that a face swinging past the
/// target does not count, short enough that nobody has to pose. And the
/// thresholds are generous: a challenge that a genuine person fails twice
/// is not a security control, it is an abandoned signup. The server, which
/// can see the whole sequence at once, is where strictness belongs.
class CaptureEngine {
  CaptureEngine({
    required this.steps,
    required this.mirrored,
    this.onStepComplete,
    this.onFinished,
  });

  /// Issued by the server, in order.
  final List<CaptureStep> steps;

  /// True for a front camera: the preview is mirrored, so "turn left" as
  /// the user experiences it is the opposite sign in the sensor's frame.
  final bool mirrored;

  final void Function(int index)? onStepComplete;
  final void Function(List<CapturedFrame> frames)? onFinished;

  static const _holdMs = 420;
  static const _yawTarget = 22.0;
  static const _pitchTarget = 12.0;

  /// The two things to check on the first real device.
  ///
  /// The sign of ML Kit's angles depends on the sensor, on the rotation the
  /// frame was handed over with, and on whether the preview is mirrored.
  /// The combination below is the usual one, but it cannot be settled
  /// without holding a phone: if "turn left" completes when you turn
  /// **right**, flip the first; if "look up" completes when you look
  /// **down**, flip the second. Either is correct everywhere once set.
  static const flipYaw = false;
  static const flipPitch = false;

  final List<CapturedFrame> frames = [];
  final Stopwatch _clock = Stopwatch()..start();

  int _index = 0;

  /// Null rather than zero: the clock genuinely reads zero for a moment,
  /// and a sentinel that collides with a real value is a bug waiting for
  /// the one device fast enough to hit it.
  int? _satisfiedSince;
  bool _blinkSawOpenEyes = false;
  bool _done = false;

  CaptureCoaching coaching = CaptureCoaching.none;

  int get index => _index;
  bool get finished => _done;
  CaptureStep? get current => _index < steps.length ? steps[_index] : null;

  /// Progress within the current step, 0..1 — the ring fills with it, which
  /// is what tells someone holding a pose that it is being registered.
  double get hold {
    final since = _satisfiedSince;
    if (since == null) return 0;
    return math.min(1, (_clock.elapsedMilliseconds - since) / _holdMs);
  }

  /// True while the step in progress needs every frame it can get. A blink
  /// lasts about a tenth of a second; a throttled detector misses it, and
  /// the user blinks at a ring that never moves.
  bool get wantsEveryFrame => current == CaptureStep.blink;

  /// Feed one reading. Returns true if the display should be rebuilt.
  bool accept(FaceReading r) {
    if (_done) return false;

    final before = (_index, coaching, hold);

    if (!r.hasFace) {
      coaching = r.faces > 1 ? CaptureCoaching.severalFaces : CaptureCoaching.noFace;
      _satisfiedSince = null;
    } else if (r.boxFraction < 0.20) {
      coaching = CaptureCoaching.tooFar;
      _satisfiedSince = null;
    } else if (r.boxFraction > 0.85) {
      coaching = CaptureCoaching.tooClose;
      _satisfiedSince = null;
    } else {
      coaching = CaptureCoaching.none;
      _evaluate(r);
    }

    return before != (_index, coaching, hold);
  }

  void _evaluate(FaceReading r) {
    final step = current;
    if (step == null) return;

    // Sign convention: after mirroring, positive yaw means the head turned
    // toward the user's own right.
    final yaw = (mirrored != flipYaw) ? -r.yaw : r.yaw;
    final pitch = flipPitch ? -r.pitch : r.pitch;

    final satisfied = switch (step) {
      // Wide on pitch on purpose. A phone held at chest height reads
      // fifteen or twenty degrees of downward pitch before the user has
      // done anything wrong, and a first step nobody can complete is a
      // signup nobody completes.
      CaptureStep.lookStraight => yaw.abs() < 15 && pitch.abs() < 20 && r.eyesOpen,
      CaptureStep.turnLeft => yaw < -_yawTarget,
      CaptureStep.turnRight => yaw > _yawTarget,
      CaptureStep.lookUp => pitch > _pitchTarget,
      // A blink is a transition, not a state: eyes must have been seen open
      // first, or a photograph of someone with their eyes shut passes.
      CaptureStep.blink => _blink(r),
      CaptureStep.smile => (r.smiling ?? 0) > 0.6,
      // Nothing in the face proves speech. The step is satisfied by a
      // steady, front-facing pose for its duration; the audio is what the
      // server checks, and the screen offers a way past it either way.
      CaptureStep.speakDigits => yaw.abs() < 20 && r.hasFace,
    };

    if (!satisfied) {
      _satisfiedSince = null;
      return;
    }

    _satisfiedSince ??= _clock.elapsedMilliseconds;

    // A blink is instantaneous — holding it would mean asking someone to
    // keep their eyes shut, which reads as an error.
    final needed = step == CaptureStep.blink ? 0 : _holdMs;
    if (_clock.elapsedMilliseconds - _satisfiedSince! >= needed) {
      _record(step, r, yaw, pitch);
    }
  }

  bool _blink(FaceReading r) {
    if (r.eyesOpen) {
      _blinkSawOpenEyes = true;
      return false;
    }
    return _blinkSawOpenEyes && r.eyesClosed;
  }

  void _record(CaptureStep step, FaceReading r, double yaw, double pitch) {
    frames.add(CapturedFrame(
      step: step,
      capturedAtMs: _clock.elapsedMilliseconds,
      yaw: yaw,
      pitch: pitch,
      eyesOpen: r.eyesOpen,
    ));
    onStepComplete?.call(_index);

    _index++;
    _satisfiedSince = null;
    _blinkSawOpenEyes = false;

    if (_index >= steps.length) {
      _done = true;
      onFinished?.call(List.unmodifiable(frames));
    }
  }

  /// The escape hatch for the spoken step: it is skipped, and the payload
  /// simply carries no frame for it rather than a frame that pretends
  /// otherwise. Someone who cannot speak is not a suspect.
  ///
  /// Guarded to the spoken step specifically. Without that guard two taps
  /// batched into one frame skip the step *after* it as well, and the user
  /// watches the dots jump past an instruction they were never shown.
  void skipCurrent() {
    if (_done || current != CaptureStep.speakDigits) return;
    onStepComplete?.call(_index);
    _index++;
    _satisfiedSince = null;
    _blinkSawOpenEyes = false;
    if (_index >= steps.length) {
      _done = true;
      onFinished?.call(List.unmodifiable(frames));
    }
  }

  void dispose() => _clock.stop();
}
