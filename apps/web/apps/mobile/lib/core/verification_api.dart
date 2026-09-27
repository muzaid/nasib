import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;

import '../features/verification/capture_engine.dart';

/// What the server decided, in the user's terms rather than the pipeline's.
enum CaptureVerdict { matched, notYourPhotos, notYourId, retake, underReview }

class Challenge {
  const Challenge({required this.sessionId, required this.steps, this.spokenDigits});

  final String sessionId;
  final List<CaptureStep> steps;
  final String? spokenDigits;
}

/// The camera step's half of the API.
///
/// Note what the client is *not* trusted with. It does not choose the
/// challenge, it does not decide the verdict, and it never computes a face
/// embedding: all three are server work, because a client that answers its
/// own challenge has not been challenged.
abstract class VerificationApi {
  Future<Challenge> startCapture();
  Future<CaptureVerdict> submitCapture(String sessionId, List<CapturedFrame> frames);
}

class HttpVerificationApi implements VerificationApi {
  HttpVerificationApi({required this.baseUrl, required this.serviceToken, required this.userId});

  final String baseUrl;
  final String serviceToken;
  final String userId;

  Map<String, String> get _headers => {
        'authorization': 'Bearer $serviceToken',
        'content-type': 'application/json',
      };

  @override
  Future<Challenge> startCapture() async {
    final res = await http.post(
      Uri.parse('$baseUrl/v1/live-capture/challenge?user_id=$userId'),
      headers: _headers,
    );
    if (res.statusCode != 200) {
      throw Exception('challenge failed: ${res.statusCode}');
    }
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    return Challenge(
      sessionId: body['session_id'] as String,
      steps: (body['steps'] as List).map((s) => CaptureStep.fromWire(s as String)).toList(),
      spokenDigits: body['spoken_digits'] as String?,
    );
  }

  @override
  Future<CaptureVerdict> submitCapture(String sessionId, List<CapturedFrame> frames) async {
    final res = await http.post(
      Uri.parse('$baseUrl/v1/live-capture/submit'),
      headers: _headers,
      body: jsonEncode({
        'session_id': sessionId,
        'frames': frames.map((f) => f.toJson()).toList(),
        'applicant': {'user_id': userId},
      }),
    );
    if (res.statusCode != 200) {
      // An unreachable verification service is not the applicant's fault,
      // and must never read as a rejection.
      return CaptureVerdict.underReview;
    }
    final verdict = (jsonDecode(res.body) as Map<String, dynamic>)['verdict'] as String;
    return switch (verdict) {
      'matched' => CaptureVerdict.matched,
      'not_your_photos' => CaptureVerdict.notYourPhotos,
      'not_your_id' => CaptureVerdict.notYourId,
      'retake' => CaptureVerdict.retake,
      _ => CaptureVerdict.underReview,
    };
  }
}

/// The build you can install and try without a backend.
///
/// It issues a real randomised challenge — that part is pure logic and
/// matches `issue_challenge()` in the service — and then returns whichever
/// verdict [forcedVerdict] names, so all five outcome screens can be seen
/// on a device. It cannot compare anything to an ID, and it does not
/// pretend to: matching is server work.
class DemoVerificationApi implements VerificationApi {
  DemoVerificationApi({Random? random}) : _random = random ?? Random();

  final Random _random;

  /// Set from the demo strip on the capture screen.
  CaptureVerdict forcedVerdict = CaptureVerdict.matched;

  @override
  Future<Challenge> startCapture() async {
    await Future<void>.delayed(const Duration(milliseconds: 350));
    final movements = [
      CaptureStep.turnLeft,
      CaptureStep.turnRight,
      CaptureStep.lookUp,
      CaptureStep.blink,
      CaptureStep.smile,
    ]..shuffle(_random);

    final steps = <CaptureStep>[CaptureStep.lookStraight, ...movements.take(3)];
    String? digits;
    if (_random.nextDouble() < 0.35) {
      steps.add(CaptureStep.speakDigits);
      digits = List.generate(4, (_) => _random.nextInt(10)).join();
    }
    return Challenge(sessionId: 'demo-${_random.nextInt(1 << 32)}', steps: steps, spokenDigits: digits);
  }

  @override
  Future<CaptureVerdict> submitCapture(String sessionId, List<CapturedFrame> frames) async {
    await Future<void>.delayed(const Duration(milliseconds: 900));
    return forcedVerdict;
  }
}
