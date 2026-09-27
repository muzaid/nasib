import 'dart:io' show Platform;
import 'dart:typed_data';
import 'dart:ui' show Size;

import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart' show WriteBuffer;
import 'package:flutter/services.dart' show DeviceOrientation;
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';

/// One reading of the face in front of the lens.
///
/// Everything the challenge needs is here and nothing else. In particular
/// there is no face *embedding* on the device: recognising whether this is
/// the same person as the ID happens on the server, because an app that can
/// answer that question locally is an app whose answer can be patched out.
class FaceReading {
  const FaceReading({
    required this.hasFace,
    required this.faces,
    this.yaw = 0,
    this.pitch = 0,
    this.leftEyeOpen,
    this.rightEyeOpen,
    this.smiling,
    this.boxFraction = 0,
  });

  /// Nothing in frame, or more than one person.
  const FaceReading.none() : this(hasFace: false, faces: 0);

  final bool hasFace;
  final int faces;

  /// Degrees. Positive yaw = the head has turned toward the user's own left
  /// once mirroring is accounted for; [CaptureEngine] does that accounting.
  final double yaw;
  final double pitch;

  final double? leftEyeOpen;
  final double? rightEyeOpen;
  final double? smiling;

  /// How much of the frame's shorter side the face fills. Distance, in the
  /// only unit that survives different sensors and resolutions.
  final double boxFraction;

  bool get eyesOpen {
    final l = leftEyeOpen, r = rightEyeOpen;
    if (l == null || r == null) return true; // unknown is not a blink
    return l > 0.4 || r > 0.4;
  }

  /// Deliberately the mirror of [eyesOpen] rather than a stricter band.
  /// With a gap between the two tests, a fast blink lands in neither and
  /// the user blinks repeatedly at a ring that never moves.
  bool get eyesClosed {
    final l = leftEyeOpen, r = rightEyeOpen;
    if (l == null || r == null) return false;
    return l < 0.4 && r < 0.4;
  }
}

/// Wraps ML Kit's face detector and the camera-frame conversion around it.
///
/// The conversion is the part that quietly breaks: a frame handed over with
/// the wrong rotation yields a detector that finds no face at all, on one
/// device, in portrait only. The orientation table below is the canonical
/// mapping and is worth leaving alone.
class FaceTracker {
  FaceTracker()
      : _detector = FaceDetector(
          options: FaceDetectorOptions(
            // Classification gives eye-open and smiling probabilities,
            // which are two of the challenge steps.
            enableClassification: true,
            enableTracking: true,
            performanceMode: FaceDetectorMode.fast,
            minFaceSize: 0.15,
          ),
        );

  final FaceDetector _detector;
  bool _busy = false;
  bool _closed = false;
  final Stopwatch _since = Stopwatch()..start();

  /// Roughly fourteen readings a second, which is more than the challenge
  /// needs. Without it the detector runs as fast as it can and every frame
  /// costs a copy of a half-megabyte buffer across the platform channel —
  /// about fourteen megabytes a second, which the user feels as a
  /// stuttering preview and a warm phone.
  static const _minIntervalMs = 70;

  static const _orientations = <DeviceOrientation, int>{
    DeviceOrientation.portraitUp: 0,
    DeviceOrientation.landscapeLeft: 90,
    DeviceOrientation.portraitDown: 180,
    DeviceOrientation.landscapeRight: 270,
  };

  /// Returns null when a previous frame is still being processed. Dropping
  /// frames is correct here: the detector runs slower than the camera, and
  /// queueing frames would make the instruction lag behind the face.
  Future<FaceReading?> read(
    CameraImage image,
    CameraController controller, {
    bool everyFrame = false,
  }) async {
    if (_busy || _closed) return null;
    if (!everyFrame && _since.elapsedMilliseconds < _minIntervalMs) return null;
    _since.reset();
    _busy = true;
    try {
      final input = _toInputImage(image, controller);
      if (input == null) return const FaceReading.none();

      final faces = await _detector.processImage(input);
      if (faces.isEmpty) return const FaceReading.none();
      if (faces.length > 1) {
        // Two faces is a fail for a reason that is not fraud: a capture
        // with someone else in it is one the owner did not consent to.
        return FaceReading(hasFace: false, faces: faces.length);
      }

      final f = faces.first;
      final shortSide = image.width < image.height ? image.width : image.height;
      return FaceReading(
        hasFace: true,
        faces: 1,
        yaw: f.headEulerAngleY ?? 0,
        pitch: f.headEulerAngleX ?? 0,
        leftEyeOpen: f.leftEyeOpenProbability,
        rightEyeOpen: f.rightEyeOpenProbability,
        smiling: f.smilingProbability,
        boxFraction: shortSide == 0 ? 0 : f.boundingBox.width / shortSide,
      );
    } catch (_) {
      // A dropped frame is never an error the user should see.
      return null;
    } finally {
      _busy = false;
    }
  }

  Future<void> dispose() async {
    if (_closed) return;
    _closed = true;
    _since.stop();
    await _detector.close();
  }

  InputImage? _toInputImage(CameraImage image, CameraController controller) {
    final camera = controller.description;
    final sensor = camera.sensorOrientation;

    InputImageRotation? rotation;
    if (Platform.isIOS) {
      rotation = InputImageRotationValue.fromRawValue(sensor);
    } else {
      final device = _orientations[controller.value.deviceOrientation];
      if (device == null) return null;
      final compensated = camera.lensDirection == CameraLensDirection.front
          ? (sensor + device) % 360
          : (sensor - device + 360) % 360;
      rotation = InputImageRotationValue.fromRawValue(compensated);
    }
    if (rotation == null) return null;

    final raw = image.format.raw;
    final format = raw is int ? InputImageFormatValue.fromRawValue(raw) : null;
    if (format == null) return null;

    // nv21 on Android, bgra8888 on iOS — both arrive as a single plane,
    // which is why the controller requests those formats explicitly.
    final Uint8List bytes;
    if (image.planes.length == 1) {
      bytes = image.planes.first.bytes;
    } else {
      final buffer = WriteBuffer();
      for (final plane in image.planes) {
        buffer.putUint8List(plane.bytes);
      }
      bytes = buffer.done().buffer.asUint8List();
    }

    return InputImage.fromBytes(
      bytes: bytes,
      metadata: InputImageMetadata(
        size: Size(image.width.toDouble(), image.height.toDouble()),
        rotation: rotation,
        format: format,
        bytesPerRow: image.planes.first.bytesPerRow,
      ),
    );
  }
}
