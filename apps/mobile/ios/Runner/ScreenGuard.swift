import Flutter
import UIKit

/// Screenshot protection, iOS side.
///
/// The honest position first: **iOS provides no way to block a screenshot.**
/// Any library that claims to do so is using the undocumented
/// `isSecureTextEntry` canvas trick, which Apple has changed the behaviour
/// of more than once and which can stop working in a point release. We do
/// not build a user-facing safety promise on that.
///
/// What iOS does give us is real, and we use all of it:
///
///   * `UIScreen.isCaptured` is true while the screen is being recorded or
///     mirrored, and it flips *before* the first frame is captured. So a
///     recording is caught in time: the app covers the photo while it runs.
///     This is the one case where iOS protection is genuinely preventive.
///
///   * `userDidTakeScreenshotNotification` fires after a screenshot was
///     taken. Nothing can be undone, but the owner of the photos learns who
///     did it within seconds, and a second attempt revokes that viewer's
///     access automatically. For a consent feature, an enforced consequence
///     is worth more than an unreliable block.
///
///   * The app snapshot iOS takes when backgrounding an app — visible in the
///     task switcher and written to disk — is covered here too, since that
///     snapshot is a copy of someone's photos sitting in a cache.
class ScreenGuard: NSObject, FlutterStreamHandler {

    private var sink: FlutterEventSink?
    private var privacyOverlay: UIView?
    private weak var window: UIWindow?
    private var enabled = false

    init(messenger: FlutterBinaryMessenger, window: UIWindow?) {
        self.window = window
        super.init()

        FlutterMethodChannel(name: "nasib/screen_guard", binaryMessenger: messenger)
            .setMethodCallHandler { [weak self] call, result in
                guard let self else { return }
                switch call.method {
                case "enable":
                    self.enabled = true
                    self.reportCaptureState()
                    result(nil)
                case "disable":
                    self.enabled = false
                    result(nil)
                case "capabilities":
                    // Said plainly, so the Dart side can tell the user what
                    // they actually have rather than implying a block.
                    result(["canBlock": false, "canDetectScreenshot": true])
                default:
                    result(FlutterMethodNotImplemented)
                }
            }

        FlutterEventChannel(name: "nasib/screen_guard/events", binaryMessenger: messenger)
            .setStreamHandler(self)

        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(didTakeScreenshot),
                       name: UIApplication.userDidTakeScreenshotNotification, object: nil)
        nc.addObserver(self, selector: #selector(captureDidChange),
                       name: UIScreen.capturedDidChangeNotification, object: nil)
        nc.addObserver(self, selector: #selector(willResignActive),
                       name: UIApplication.willResignActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(didBecomeActive),
                       name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    // MARK: - events

    @objc private func didTakeScreenshot() {
        guard enabled else { return }
        sink?("screenshot")
    }

    @objc private func captureDidChange() {
        reportCaptureState()
    }

    private func reportCaptureState() {
        guard enabled else { return }
        sink?(UIScreen.main.isCaptured ? "capture_started" : "capture_ended")
    }

    // MARK: - the backgrounding snapshot

    /// iOS photographs the app as it goes to the background and keeps that
    /// image on disk for the task switcher. On a screen showing someone
    /// else's photos that snapshot is a copy of them in a cache, so the
    /// content is covered before the system takes it.
    @objc private func willResignActive() {
        guard enabled, let window, privacyOverlay == nil else { return }

        let overlay = UIView(frame: window.bounds)
        overlay.backgroundColor = UIColor(red: 0.96, green: 0.98, blue: 0.99, alpha: 1)
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]

        let label = UILabel()
        label.text = "نصيب"
        label.font = .systemFont(ofSize: 34, weight: .bold)
        label.textColor = UIColor(red: 0.06, green: 0.13, blue: 0.20, alpha: 1)
        label.translatesAutoresizingMaskIntoConstraints = false
        overlay.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: overlay.centerYAnchor),
        ])

        window.addSubview(overlay)
        privacyOverlay = overlay
    }

    @objc private func didBecomeActive() {
        privacyOverlay?.removeFromSuperview()
        privacyOverlay = nil
    }

    // MARK: - FlutterStreamHandler

    func onListen(withArguments _: Any?, eventSink: @escaping FlutterEventSink) -> FlutterError? {
        sink = eventSink
        reportCaptureState()
        return nil
    }

    func onCancel(withArguments _: Any?) -> FlutterError? {
        sink = nil
        return nil
    }
}
