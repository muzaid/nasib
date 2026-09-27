import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Screenshot and screen-recording protection.
///
/// Be clear about what this can and cannot do, because the product makes a
/// promise to users about their photos and that promise has to be true.
///
/// **Android** can genuinely prevent it. `FLAG_SECURE` on the window blocks
/// screenshots, blocks screen recording, and blanks the app in the recents
/// switcher. The OS enforces it; there is no app-level workaround.
///
/// **iOS cannot.** Apple exposes no API to block a screenshot, and anything
/// claiming otherwise is either the private `isSecureTextEntry` canvas trick
/// (undocumented, breaks between releases) or marketing. What iOS does give
/// us is honest and still useful:
///   * `userDidTakeScreenshotNotification` — fires *after* the capture
///   * `UIScreen.isCaptured` — true while recording or mirroring is active
///
/// So the behaviour differs by platform and the app says so rather than
/// implying a protection it does not have:
///   * Android: capture is blocked outright.
///   * iOS: recording is detected *before* it can capture anything, so the
///     photo is covered while it runs; a screenshot is detected after the
///     fact, the owner is told who did it, and the second attempt revokes
///     that person's access automatically.
///
/// A determined person can always photograph the screen with another phone.
/// Nothing stops that, which is why the deterrent that actually matters is
/// the per-viewer watermark: a leaked image names its source.
class ScreenGuard {
  ScreenGuard._();

  static const _channel = MethodChannel('nasib/screen_guard');
  static const _events = EventChannel('nasib/screen_guard/events');

  static StreamSubscription<dynamic>? _sub;
  static bool _secure = false;

  /// True while the OS is mirroring or recording the screen. On iOS this is
  /// known *before* any frame is captured, so sensitive content can be
  /// covered in time. On Android `FLAG_SECURE` already blacks it out.
  static final ValueNotifier<bool> isBeingCaptured = ValueNotifier(false);

  /// Fires when the user takes a screenshot (iOS: after the fact; Android:
  /// should never fire while secure mode is on).
  static final _screenshots = StreamController<void>.broadcast();
  static Stream<void> get onScreenshot => _screenshots.stream;

  /// Turn protection on. Called when a screen that shows someone else's
  /// photos, or a conversation, comes into view.
  static Future<void> enable() async {
    if (_secure) return;
    _secure = true;
    await _channel.invokeMethod<void>('enable');
    _listen();
  }

  /// Turn it off again. Worth doing on screens that do not need it: on
  /// Android `FLAG_SECURE` also blanks the app in the recents switcher,
  /// which is disorienting if it applies to the whole app all the time.
  static Future<void> disable() async {
    if (!_secure) return;
    _secure = false;
    await _channel.invokeMethod<void>('disable');
  }

  static void _listen() {
    _sub ??= _events.receiveBroadcastStream().listen((event) {
      switch (event) {
        case 'screenshot':
          _screenshots.add(null);
        case 'capture_started':
          isBeingCaptured.value = true;
        case 'capture_ended':
          isBeingCaptured.value = false;
      }
    });
  }

  static Future<void> dispose() async {
    await _sub?.cancel();
    _sub = null;
  }
}
