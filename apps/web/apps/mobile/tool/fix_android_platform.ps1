# Finish the SDK: install build-tools the way that actually works.
#
#   powershell -ExecutionPolicy Bypass -File tool\fix_android_platform.ps1
#
# The recipe, learned the hard way from tool\install_platform_probe.ps1:
#
#   * package names use SLASHES in cmdline-tools 23 - platforms/android-36,
#     not platforms;android-36. The semicolon form is split at the
#     semicolon and reported as two packages that do not exist.
#   * do NOT pass --sdk_root. That was the real culprit: with it, every
#     package name is rejected. The root goes in ANDROID_HOME instead.
#   * proxy arguments are ignored now; the CLI uses the system proxy.
#
# None of this fails loudly. Get it wrong and you get a cheerful run and
# an empty directory, which is why every step here is verified by
# counting files on disk.

param([string]$SdkRoot = "$env:LOCALAPPDATA\Android\Sdk")

$ErrorActionPreference = "Continue"

$sdkmanager = Join-Path $SdkRoot "cmdline-tools\latest\bin\sdkmanager.bat"
if (-not (Test-Path $sdkmanager)) {
  Write-Host "sdkmanager not found at $sdkmanager" -ForegroundColor Red
  Write-Host "Run tool\install_android_sdk.ps1 first."
  exit 1
}

# This is how the root is passed now.
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

function Count-In([string]$sub) {
  $d = Join-Path $SdkRoot $sub
  if (-not (Test-Path $d)) { return 0 }
  return (Get-ChildItem $d -ErrorAction SilentlyContinue | Measure-Object).Count
}

function Install-One([string]$package, [string]$verifySub) {
  $before = Count-In $verifySub
  Write-Host "==> installing $package" -ForegroundColor Cyan
  & $sdkmanager $package 2>&1 | ForEach-Object { "$_" }
  if ((Count-In $verifySub) -gt $before) {
    Write-Host "    installed" -ForegroundColor Green
    return $true
  }
  Write-Host "    nothing appeared on disk" -ForegroundColor Yellow
  return $false
}

# A platform may already be there from the probe run.
if ((Count-In "platforms") -eq 0) {
  foreach ($n in @(36, 37, 35)) {
    if (Install-One "platforms/android-$n" "platforms") { break }
  }
}

# Build-tools matched to the platform, newest first among what exists.
if ((Count-In "build-tools") -eq 0) {
  foreach ($v in @("36.0.0", "36.1.0", "37.0.0", "35.0.1")) {
    if (Install-One "build-tools/$v" "build-tools") { break }
  }
}

Write-Host ""
Write-Host "==> what is on disk" -ForegroundColor Cyan
foreach ($sub in @("platform-tools", "platforms", "build-tools", "cmdline-tools")) {
  $d = Join-Path $SdkRoot $sub
  if (Test-Path $d) {
    $items = Get-ChildItem $d -Name
    if ($items) { Write-Host "  $sub : $($items -join ', ')" }
    else        { Write-Host "  $sub : EMPTY" -ForegroundColor Yellow }
  } else {
    Write-Host "  $sub : missing" -ForegroundColor Yellow
  }
}

if ((Count-In "platforms") -eq 0 -or (Count-In "build-tools") -eq 0) {
  Write-Host ""
  Write-Host "Still incomplete - tell Claude what is listed above." -ForegroundColor Red
  exit 1
}

if (Get-Command flutter -ErrorAction SilentlyContinue) {
  flutter config --android-sdk "$SdkRoot" | Out-Null
  Write-Host ""
  flutter doctor
}

Write-Host ""
Write-Host "Now build:  powershell -ExecutionPolicy Bypass -File tool\build_android.ps1" -ForegroundColor Green
