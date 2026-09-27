import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate {

    private var screenGuard: ScreenGuard?

    override func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        GeneratedPluginRegistrant.register(with: self)

        if let controller = window?.rootViewController as? FlutterViewController {
            // Held for the life of the app: it owns the notification
            // observers and the backgrounding overlay.
            screenGuard = ScreenGuard(messenger: controller.binaryMessenger, window: window)
        }

        return super.application(application, didFinishLaunchingWithOptions: launchOptions)
    }
}
