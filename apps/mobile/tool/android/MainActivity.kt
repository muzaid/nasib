package app.nasib

import android.os.Build
import android.view.WindowManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel

/**
 * Screenshot protection, Android side.
 *
 * FLAG_SECURE is real prevention, not a deterrent: the OS refuses to put
 * the window into a screenshot, refuses to include it in a screen
 * recording, and shows a blank card for the app in the recents switcher.
 * There is no app-level workaround on a non-rooted device.
 *
 * It is applied per screen rather than for the whole app session, because
 * the recents-switcher blanking is disorienting when it is always on — the
 * user flips away and comes back to a black card with no idea what it was.
 */
class MainActivity : FlutterActivity() {

    private var events: EventChannel.EventSink? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "enable" -> {
                        runOnUiThread {
                            window.setFlags(
                                WindowManager.LayoutParams.FLAG_SECURE,
                                WindowManager.LayoutParams.FLAG_SECURE,
                            )
                        }
                        result.success(null)
                    }
                    "disable" -> {
                        runOnUiThread {
                            window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                        }
                        result.success(null)
                    }
                    // Android has no "a screenshot just happened" callback,
                    // and it does not need one: the capture never succeeds.
                    // Reported so the Dart side can tell the user honestly
                    // what protection they have on this device.
                    "capabilities" -> result.success(
                        mapOf("canBlock" to true, "canDetectScreenshot" to false)
                    )
                    else -> result.notImplemented()
                }
            }

        EventChannel(flutterEngine.dartExecutor.binaryMessenger, EVENTS)
            .setStreamHandler(object : EventChannel.StreamHandler {
                override fun onListen(args: Any?, sink: EventChannel.EventSink?) {
                    events = sink
                    registerScreenCaptureCallback()
                }

                override fun onCancel(args: Any?) {
                    events = null
                }
            })
    }

    /**
     * Android 14 (API 34) added a callback that fires when the user takes a
     * screenshot of this app. With FLAG_SECURE set the capture is blocked
     * anyway, so this only matters on screens we deliberately leave
     * unprotected — it lets us log the attempt rather than guess.
     */
    private fun registerScreenCaptureCallback() {
        if (Build.VERSION.SDK_INT < 34) return
        runCatching {
            registerScreenCaptureCallback(mainExecutor) {
                events?.success("screenshot")
            }
        }
    }

    companion object {
        private const val CHANNEL = "nasib/screen_guard"
        private const val EVENTS = "nasib/screen_guard/events"
    }
}
