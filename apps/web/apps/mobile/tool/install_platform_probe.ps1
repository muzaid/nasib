# Work out how cmdline-tools 23's Android CLI wants to be asked, then use
# it. Everything it prints is saved, so if none of the attempts work the
# help text is there to read rather than guess from.
#
#   powershell -ExecutionPolicy Bypass -File tool\install_platform_probe.ps1

param([string]$SdkRoot = "$env:LOCALAPPDATA\Android\Sdk")

$ErrorActionPreference = "Continue"
$log = "$env:USERPROFILE\Downloads\nasib-cli-probe.txt"
if (Test-Path $log) { Remove-Item $log -Force }

function Log([string]$text) {
  $text | Out-File -Append -Encoding utf8 $log
  Write-Host $text
}

$bin = Join-Path $SdkRoot "cmdline-tools\latest\bin"
$sdkmanager = Join-Path $bin "sdkmanager.bat"
$androidBat = Join-Path $bin "android.bat"

# The new CLI reads these; --sdk_root may not survive the rewrite.
$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot

# Clear a proxy that does not resolve from this network.
$rawProxy = $env:HTTPS_PROXY
if (-not $rawProxy) { $rawProxy = $env:HTTP_PROXY }
if ($rawProxy -and $rawProxy -match '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?(?<host>[^:/]+)') {
  try { [System.Net.Dns]::GetHostEntry($matches['host']) | Out-Null }
  catch { $env:HTTP_PROXY = ""; $env:HTTPS_PROXY = "" }
}

Log "=== what is in cmdline-tools\latest\bin ==="
Get-ChildItem $bin -Name | ForEach-Object { Log "  $_" }

# ---- the help text, which is the point of this script ----------------- #

function Dump([string]$label, [string]$exe, [string[]]$a) {
  if (-not (Test-Path $exe)) { Log "`n=== $label : $exe not present ==="; return }
  Log "`n=== $label ==="
  (& $exe @a 2>&1 | Out-String) | ForEach-Object { Log $_ }
}

Dump "sdkmanager --help" $sdkmanager @("--help")
Dump "android --help"    $androidBat @("--help")
Dump "android sdk --help" $androidBat @("sdk", "--help")
Dump "android sdk install --help" $androidBat @("sdk", "install", "--help")

# ---- then try, and check the disk after each -------------------------- #

function PlatformCount {
  $d = Join-Path $SdkRoot "platforms"
  if (-not (Test-Path $d)) { return 0 }
  return (Get-ChildItem $d -ErrorAction SilentlyContinue | Measure-Object).Count
}

$attempts = @(
  @{ n = "android sdk install platforms/android-36"; e = $androidBat;  a = @("sdk", "install", "platforms/android-36") },
  @{ n = "android sdk install android-36";           e = $androidBat;  a = @("sdk", "install", "android-36") },
  @{ n = "android sdk install --package platforms/android-36"; e = $androidBat; a = @("sdk", "install", "--package", "platforms/android-36") },
  @{ n = "android install platforms/android-36";     e = $androidBat;  a = @("install", "platforms/android-36") },
  @{ n = "sdkmanager platforms/android-36 (env root)"; e = $sdkmanager; a = @("platforms/android-36") },
  @{ n = "sdkmanager platforms;android-36 (env root)"; e = $sdkmanager; a = @("platforms;android-36") }
)

$winner = $null
foreach ($try in $attempts) {
  if (-not (Test-Path $try.e)) { continue }
  Log "`n=== trying: $($try.n) ==="
  (& $try.e @($try.a) 2>&1 | Out-String) | ForEach-Object { Log $_ }
  if ((PlatformCount) -gt 0) {
    $winner = $try.n
    Log "`n*** WORKED: $($try.n) ***"
    break
  }
}

Log "`n=== platforms directory now ==="
$d = Join-Path $SdkRoot "platforms"
if (Test-Path $d) { Get-ChildItem $d -Name | ForEach-Object { Log "  $_" } } else { Log "  missing" }

Write-Host ""
if ($winner) {
  Write-Host "Worked: $winner" -ForegroundColor Green
  Write-Host "Tell Claude - it will finish the build-tools the same way."
} else {
  Write-Host "None worked. The help text is in:" -ForegroundColor Red
  Write-Host "  $log"
  Write-Host "Tell Claude it is ready and it will read it."
}
