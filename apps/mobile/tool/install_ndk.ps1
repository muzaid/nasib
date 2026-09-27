# Install the Android NDK.
#
#   powershell -ExecutionPolicy Bypass -File tool\install_ndk.ps1
#
# Why this is needed even though this project has no native code: one of
# the Flutter plugins sets ndkVersion in its own Gradle file, so the
# Android Gradle plugin insists on provisioning that exact NDK before it
# will configure the app. Removing our own ndkVersion line was not enough.
#
# AGP provisions it by running `sdkmanager ndk;28.2.x`, and cmdline-tools
# 23 splits at the semicolon, looks for packages called "ndk" and
# "28.2.13676358", finds neither, and dies with a stack overrun. So we
# install it here, with the spelling that works: a slash, and no
# --sdk_root flag (the root goes in ANDROID_HOME).
#
# About a gigabyte. Once.

param(
  [string]$SdkRoot = "$env:LOCALAPPDATA\Android\Sdk",
  [string]$Version = "28.2.13676358"
)

$ErrorActionPreference = "Continue"

$sdkmanager = Join-Path $SdkRoot "cmdline-tools\latest\bin\sdkmanager.bat"
if (-not (Test-Path $sdkmanager)) {
  Write-Host "sdkmanager not found at $sdkmanager" -ForegroundColor Red
  exit 1
}

$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot

# A corporate proxy name resolves at the office and nowhere else.
$rawProxy = $env:HTTPS_PROXY
if (-not $rawProxy) { $rawProxy = $env:HTTP_PROXY }
if ($rawProxy -and $rawProxy -match '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?(?<host>[^:/]+)') {
  try { [System.Net.Dns]::GetHostEntry($matches['host']) | Out-Null }
  catch {
    Write-Host "==> proxy does not resolve here; going direct" -ForegroundColor Yellow
    $env:HTTP_PROXY = ""
    $env:HTTPS_PROXY = ""
  }
}

$target = Join-Path $SdkRoot "ndk\$Version"
if (Test-Path $target) {
  Write-Host "NDK $Version is already installed." -ForegroundColor Green
  exit 0
}

Write-Host "==> accepting licences" -ForegroundColor Cyan
("y`n" * 40) | & $sdkmanager --licenses 2>&1 | Out-Null

Write-Host "==> installing ndk/$Version (about 1 GB, this takes a while)" -ForegroundColor Cyan
& $sdkmanager "ndk/$Version" 2>&1 | ForEach-Object { "$_" }

if (-not (Test-Path $target)) {
  Write-Host ""
  Write-Host "The NDK did not land at $target" -ForegroundColor Red
  Write-Host "Installed NDK versions:" -ForegroundColor Red
  $ndkDir = Join-Path $SdkRoot "ndk"
  if (Test-Path $ndkDir) { Get-ChildItem $ndkDir -Name | ForEach-Object { "  $_" } }
  else { Write-Host "  (no ndk directory at all)" }
  exit 1
}

Write-Host ""
Write-Host "NDK $Version installed at $target" -ForegroundColor Green
Write-Host "Now build:  powershell -ExecutionPolicy Bypass -File tool\build_android.ps1"
