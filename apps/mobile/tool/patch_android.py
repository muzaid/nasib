#!/usr/bin/env python3
"""Apply this project's changes to the generated Android scaffolding.

`flutter create` writes a correct, version-matched `android/` directory —
correct for whichever Flutter SDK is doing the generating, which is exactly
why this repository does not keep a hand-written copy of it. A checked-in
Gradle file is a file that is wrong one SDK release later, and wrong in a
way that costs an afternoon.

So the build is: generate, then apply the handful of things that are ours.
There are four, and each is here because the app does not work without it:

  * the camera permission, and the camera declared optional so the store
    listing does not exclude every device without a front camera
  * the Arabic app label
  * our MainActivity, which is where FLAG_SECURE lives
  * a minSdk floor of 21, which is what ML Kit's face detector needs
  * removing the generated smoke test, which refers to a `MyApp` this
    project does not have — a red analyzer error on every clean build
  * removing `ndkVersion`, which makes Gradle download a native toolchain
    this project has no native code for
  * telling Gradle about the HTTP proxy, which it does not learn from the
    environment the way every other tool here does

Idempotent: run it as many times as you like.
"""

from __future__ import annotations

import os
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
ANDROID = ROOT / "android"
WIDGET_TEST = ROOT / "test/widget_test.dart"
MANIFEST = ANDROID / "app/src/main/AndroidManifest.xml"
KOTLIN = ANDROID / "app/src/main/kotlin/app/nasib/MainActivity.kt"
OURS = ROOT / "tool/android/MainActivity.kt"

LABEL = "نصيب"

PERMISSIONS = """    <!-- The camera step. Nothing else in the app needs a permission:
         no location, no contacts, no microphone until the spoken
         challenge ships, and each one you ask for costs installs. -->
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <uses-feature android:name="android.hardware.camera.front" android:required="false" />
"""


def fail(msg: str) -> None:
    print(f"patch_android: {msg}", file=sys.stderr)
    raise SystemExit(1)


def patch_manifest() -> None:
    if not MANIFEST.exists():
        fail(f"{MANIFEST} not found — run `flutter create --platforms=android .` first")

    text = MANIFEST.read_text(encoding="utf-8")

    if "android.permission.CAMERA" not in text:
        text = text.replace("    <application", PERMISSIONS + "    <application", 1)

    # The generated label is the project name. It is the name under the
    # icon, so it is Arabic like everything else.
    text = re.sub(r'android:label="[^"]*"', f'android:label="{LABEL}"', text, count=1)

    MANIFEST.write_text(text, encoding="utf-8")
    print(f"patched {MANIFEST.relative_to(ROOT)}")


def patch_main_activity() -> None:
    if not OURS.exists():
        fail(f"{OURS} is missing")
    KOTLIN.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(OURS, KOTLIN)
    print(f"installed {KOTLIN.relative_to(ROOT)}")

    # `flutter create` may have left a MainActivity under a different
    # package path (it derives one from --org). Two activities compile, and
    # then the wrong one runs.
    for stray in (ANDROID / "app/src/main/kotlin").rglob("MainActivity.kt"):
        if stray != KOTLIN:
            stray.unlink()
            print(f"removed stray {stray.relative_to(ROOT)}")


def patch_min_sdk() -> None:
    gradle = next(
        (p for p in [ANDROID / "app/build.gradle.kts", ANDROID / "app/build.gradle"] if p.exists()),
        None,
    )
    if gradle is None:
        fail("android/app/build.gradle[.kts] not found")

    text = gradle.read_text(encoding="utf-8")
    original = text

    # Recent templates write `minSdk = flutter.minSdkVersion`, which is
    # already 21+. Older ones write a literal. Only the literal needs help.
    def bump(match: re.Match[str]) -> str:
        value = match.group(2)
        if value.isdigit() and int(value) < 21:
            return f"{match.group(1)}21"
        return match.group(0)

    text = re.sub(r"(minSdk(?:Version)?\s*=?\s*)(\S+)", bump, text)

    if text != original:
        gradle.write_text(text, encoding="utf-8")
        print(f"patched {gradle.relative_to(ROOT)} (minSdk 21)")
    else:
        print(f"{gradle.relative_to(ROOT)}: minSdk already fine")


def patch_proxy() -> None:
    """Write the proxy into android/gradle.properties.

    Gradle does not read HTTP_PROXY. Not "prefers not to" — it ignores it
    entirely and looks only at `systemProp.http.proxyHost` and friends. On
    a corporate network where external names resolve only through the
    proxy, that produces a spectacular failure: eighty lines of "Could not
    download …: No such host is known" for every artifact in the Android
    Gradle plugin, which reads like the internet is down rather than like
    one tool missing one setting.

    The environment is the source of truth here, and the caller is
    expected to have cleared HTTP_PROXY already if the proxy does not
    resolve — `tool/build_android.ps1` does exactly that. So: proxy in the
    environment means write it; nothing there means strip any stale
    settings, otherwise the file left over from the office breaks the
    build at home.
    """
    props = ANDROID / "gradle.properties"
    if not props.exists():
        return

    raw = os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY") or ""
    parsed = urlparse(raw if "://" in raw else f"http://{raw}") if raw.strip() else None

    # Everything this function has ever written is marked, so removing it
    # again is exact. Filtering only on `systemProp.` left the comment
    # block behind, and it accumulated one copy per run.
    marker = "# nasib-proxy"
    keep = [
        line for line in props.read_text(encoding="utf-8").splitlines()
        if not line.startswith("systemProp.http") and not line.startswith(marker)
    ]
    while keep and not keep[-1].strip():
        keep.pop()

    if parsed and parsed.hostname:
        port = parsed.port or 8080
        keep += [
            "",
            f"{marker}: written by tool/patch_android.py from HTTP_PROXY.",
            f"{marker}: Gradle does not read that variable itself, and without",
            f"{marker}: these lines every artifact download fails with",
            f"{marker}: \"No such host is known\" on a network where external",
            f"{marker}: names only resolve through the proxy.",
            f"systemProp.http.proxyHost={parsed.hostname}",
            f"systemProp.http.proxyPort={port}",
            f"systemProp.https.proxyHost={parsed.hostname}",
            f"systemProp.https.proxyPort={port}",
            "systemProp.http.nonProxyHosts=localhost|127.0.0.1|10.0.2.2",
            "systemProp.https.nonProxyHosts=localhost|127.0.0.1|10.0.2.2",
        ]
        print(f"patched {props.relative_to(ROOT)} (proxy {parsed.hostname}:{port})")
    else:
        print(f"{props.name}: no proxy in the environment, any stale settings removed")

    props.write_text("\n".join(keep).rstrip() + "\n", encoding="utf-8")


def patch_ndk() -> None:
    """Drop `ndkVersion` from the generated app/build.gradle.kts.

    The Flutter template sets it unconditionally, and setting it makes the
    Android Gradle plugin *provision* that exact NDK — roughly a gigabyte
    of C++ toolchain. This project has no native code: `camera` and
    `google_mlkit_face_detection` both ship prebuilt archives, so nothing
    is ever compiled that needs it.

    It is not only wasted download. AGP provisions the NDK by shelling out
    to `sdkmanager ndk;28.2.x`, and cmdline-tools 23 splits that semicolon
    into two package names, finds neither, and dies with a stack overrun
    (NTSTATUS 0xC0000409) nine minutes into the build.

    If a plugin is added later that genuinely needs the NDK, the fix is to
    install it — `sdkmanager "ndk/<version>"`, slash not semicolon — and
    delete this function, not to let AGP download it silently.
    """
    gradle = next(
        (p for p in [ANDROID / "app/build.gradle.kts", ANDROID / "app/build.gradle"] if p.exists()),
        None,
    )
    if gradle is None:
        return

    text = gradle.read_text(encoding="utf-8")
    if "ndkVersion" not in text or "// ndkVersion" in text:
        print(f"{gradle.name}: ndkVersion already handled")
        return

    text = re.sub(
        r"^(\s*)ndkVersion\s*=.*$",
        r"\1// ndkVersion removed by tool/patch_android.py: no native code here,\n"
        r"\1// and provisioning it breaks on cmdline-tools 23. See that file.",
        text,
        count=1,
        flags=re.MULTILINE,
    )
    gradle.write_text(text, encoding="utf-8")
    print(f"patched {gradle.relative_to(ROOT)} (removed ndkVersion)")


def patch_widget_test() -> None:
    """`flutter create` writes a test against a `MyApp` widget from the
    template. This project's root widget is `NasibApp` and takes an
    argument, so the generated test does not compile — and it is the only
    analyzer *error* in an otherwise clean tree, which trains everyone to
    ignore the analyzer. The repository carries its own test; this only
    has to clear a stale generated one.
    """
    if not WIDGET_TEST.exists():
        return
    if "MyApp" in WIDGET_TEST.read_text(encoding="utf-8"):
        WIDGET_TEST.unlink()
        print(f"removed generated {WIDGET_TEST.relative_to(ROOT)} (referred to MyApp)")
        print("  -> restore this project's own test from the repository")
    else:
        print("test/widget_test.dart: this project's own, left alone")


if __name__ == "__main__":
    patch_manifest()
    patch_main_activity()
    patch_min_sdk()
    patch_proxy()
    patch_ndk()
    patch_widget_test()
    print("android scaffolding patched")
