# NOTE ON ENCODING: this file is ASCII with a UTF-8 BOM, on purpose.
# Windows PowerShell 5.1 reads a .ps1 as ANSI unless it finds a BOM, so one
# stray em dash in a comment becomes three bytes and the parser reports an
# unterminated string forty lines later. Keep it ASCII.
# Build an installable debug APK on Windows.
#
#   cd apps\mobile
#   powershell -ExecutionPolicy Bypass -File tool\build_android.ps1
#   powershell -ExecutionPolicy Bypass -File tool\build_android.ps1 -Release
#
# Same three steps as the bash version: generate the android project from
# your own Flutter SDK, apply this project's changes to it, build. The
# android/ directory is not in the repository because a checked-in Gradle
# file is wrong one SDK release later.

param([switch]$Release)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$mode = if ($Release) { "release" } else { "debug" }

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Host "$cmd was not found on PATH." -ForegroundColor Red
    Write-Host $hint
    exit 1
  }
}

# ---------------------------------------------------------------------- #
# A proxy that is not there.
#
# HTTP_PROXY on this machine names a corporate proxy. That name resolves
# at the office and nowhere else, so off the network every download here
# fails with "the remote name could not be resolved" - and Dart reads
# these variables, so `flutter pub get` fails the same way. If the proxy
# cannot be resolved, it is cleared FOR THIS PROCESS ONLY; nothing about
# your system settings changes.
# ---------------------------------------------------------------------- #

$rawProxy = $env:HTTPS_PROXY
if (-not $rawProxy) { $rawProxy = $env:HTTP_PROXY }
if ($rawProxy -and $rawProxy -match '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?(?<host>[^:/]+)') {
  $ph = $matches['host']
  $alive = $false
  try { [System.Net.Dns]::GetHostEntry($ph) | Out-Null; $alive = $true } catch { }
  if ($alive) {
    Write-Host "==> proxy: $rawProxy" -ForegroundColor Cyan
  } else {
    Write-Host "==> proxy $ph does not resolve here; going direct this run" -ForegroundColor Yellow
    $env:HTTP_PROXY = ""
    $env:HTTPS_PROXY = ""
  }
}

Need "flutter" "Install it from https://docs.flutter.dev/get-started/install/windows and reopen the terminal."
Need "python"  "Install Python 3 from python.org, or run the three steps below by hand."

# ---------------------------------------------------------------------- #
# Find the Android SDK.
#
# Flutter stores its own copy of this path and does not read ANDROID_HOME
# reliably, which is why "No Android SDK found" survives setting that
# variable. `flutter config --android-sdk` is what actually sticks.
# ---------------------------------------------------------------------- #

function Find-AndroidSdk {
  $seen = @()
  if ($env:ANDROID_HOME)     { $seen += $env:ANDROID_HOME }
  if ($env:ANDROID_SDK_ROOT) { $seen += $env:ANDROID_SDK_ROOT }
  $seen += "$env:LOCALAPPDATA\Android\Sdk"
  $seen += "$env:USERPROFILE\AppData\Local\Android\Sdk"
  $seen += "C:\Android\Sdk"
  $seen += "C:\Android\android-sdk"
  $seen += "$env:ProgramFiles\Android\android-sdk"
  $seen += "${env:ProgramFiles(x86)}\Android\android-sdk"

  foreach ($c in $seen) {
    if (-not $c) { continue }
    # An SDK is a directory with platform-tools or platforms under it.
    # A bare .android folder in your home is config, not the SDK.
    if ((Test-Path (Join-Path $c "platform-tools")) -or (Test-Path (Join-Path $c "platforms"))) {
      return (Resolve-Path $c).Path
    }
  }
  return $null
}

$sdk = Find-AndroidSdk
if ($sdk) {
  Write-Host "==> android sdk: $sdk" -ForegroundColor Cyan
  flutter config --android-sdk "$sdk" | Out-Null
  $env:ANDROID_HOME = $sdk
  $env:ANDROID_SDK_ROOT = $sdk
} else {
  Write-Host ""
  Write-Host "No Android SDK found. Looked in:" -ForegroundColor Red
  foreach ($c in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, "$env:LOCALAPPDATA\Android\Sdk",
                   "C:\Android\Sdk", "$env:ProgramFiles\Android\android-sdk")) {
    if ($c) { Write-Host "  $c" }
  }
  Write-Host ""
  Write-Host "You have the Gradle and Maven caches but not the SDK itself."
  Write-Host "Quickest fix: install Android Studio and let its setup wizard"
  Write-Host "install the platform and build-tools; this script finds it after."
  Write-Host ""
  Write-Host "If it IS installed somewhere unusual, point Flutter at it:"
  Write-Host "  flutter config --android-sdk ""D:\path\to\Sdk"""
  exit 1
}

Write-Host "==> flutter doctor" -ForegroundColor Cyan
# Reported, not enforced: doctor complains about Chrome and Visual Studio,
# neither of which an Android build needs. What matters is that the
# "Android toolchain" line is a tick.
flutter doctor

Write-Host "==> generating the android project" -ForegroundColor Cyan
Copy-Item pubspec.yaml "$env:TEMP\nasib-pubspec.bak" -Force
flutter create --platforms=android --org app --project-name nasib . | Out-Null
Copy-Item "$env:TEMP\nasib-pubspec.bak" pubspec.yaml -Force

Write-Host "==> applying this project's changes" -ForegroundColor Cyan
python tool\patch_android.py

Write-Host "==> resolving packages" -ForegroundColor Cyan
flutter pub get

Write-Host "==> analyze (informational)" -ForegroundColor Cyan
# A lint should never stand between you and an APK you are trying to put
# on a phone, so a failure here does not stop the build.
flutter analyze --no-fatal-infos --no-fatal-warnings
$global:LASTEXITCODE = 0

Write-Host "==> building $mode apk" -ForegroundColor Cyan
flutter build apk "--$mode"

$apk = "build\app\outputs\flutter-apk\app-$mode.apk"
if (Test-Path $apk) {
  Write-Host ""
  Write-Host "APK: $((Resolve-Path $apk).Path)" -ForegroundColor Green
  Write-Host "Install it over USB with:  adb install -r $apk"
  Write-Host "Or copy it to the phone and open it (allow unknown sources once)."
} else {
  Write-Host "The build finished but $apk is not there - read the output above." -ForegroundColor Red
  exit 1
}
