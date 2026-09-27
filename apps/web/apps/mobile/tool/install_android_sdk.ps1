# Install a minimal Android SDK, without Android Studio.
#
#   powershell -ExecutionPolicy Bypass -File tool\install_android_sdk.ps1
#
# Installs into %LOCALAPPDATA%\Android\Sdk, which needs no administrator
# rights and is the first place Flutter looks. About 700 MB.
#
# Android Studio is the usual route and it works, but it is a 1 GB IDE
# installed to obtain a command-line toolchain. This fetches the command
# line tools, asks them which platform and build-tools are current, and
# installs those. The package URL is read from Google's own repository
# index rather than hardcoded, so it does not rot.

param([string]$SdkRoot = "$env:LOCALAPPDATA\Android\Sdk")

$ErrorActionPreference = "Stop"
$repo = "https://dl.google.com/android/repository"

# The proxy. Three separate traps, each with its own failure text:
#
#   * PowerShell's -Proxy wants a URI and HTTP_PROXY here is a bare
#     host:port, so it reads the hostname as a scheme and says so.
#   * A corporate proxy name resolves on the office network and NOWHERE
#     else. The same variable that is correct at a desk makes every
#     download fail from home, with "the remote name could not be
#     resolved". Off the network the honest move is to ignore it.
#   * Java ignores HTTP_PROXY entirely, so sdkmanager is told separately.
$rawProxy = $env:HTTPS_PROXY
if (-not $rawProxy) { $rawProxy = $env:HTTP_PROXY }

$proxyHost = $null
$proxyPort = $null
$proxyUri = $null
if ($rawProxy -and $rawProxy -match '^(?:(?<scheme>[a-zA-Z][a-zA-Z0-9+.-]*)://)?(?<host>[^:/]+)(?::(?<port>\d+))?') {
  $proxyHost = $matches['host']
  $proxyPort = $matches['port']
  $proxyUri = "http://$proxyHost"
  if ($proxyPort) { $proxyUri = "$proxyUri`:$proxyPort" }
}

$proxyUsable = $false
if ($proxyHost) {
  try {
    [System.Net.Dns]::GetHostEntry($proxyHost) | Out-Null
    $proxyUsable = $true
  } catch { }
}

if ($proxyUsable) {
  Write-Host "==> proxy: $proxyUri" -ForegroundColor Cyan
} elseif ($proxyHost) {
  Write-Host "==> proxy $proxyHost does not resolve from this network" -ForegroundColor Yellow
  Write-Host "    going direct, and clearing it for this session only" -ForegroundColor Yellow
  # Dart and Flutter DO read these variables, so a dead proxy would break
  # `flutter pub get` in exactly the same way a minute from now. Cleared
  # for this process only - your system settings are untouched.
  $env:HTTP_PROXY = ""
  $env:HTTPS_PROXY = ""
  $proxyUri = $null
}

# Old PowerShell defaults to TLS 1.0, which Google's servers refuse.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Get-Web([string]$url, [string]$out) {
  # Each route tried in turn. Direct only, when there is no usable proxy.
  $routes = @()
  if ($proxyUri) { $routes += "proxy" }
  $routes += "direct"

  foreach ($route in $routes) {
    try {
      if ($route -eq "proxy") {
        Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing `
          -Proxy $proxyUri -ProxyUseDefaultCredentials
      } else {
        Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing
      }
      if (Test-Path $out) { return }
    } catch {
      Write-Host "    $route via Invoke-WebRequest failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }

    # curl.exe ships with Windows 10 and later. No NTLM flag here: the
    # libcurl Microsoft ships is built without that support, and asking
    # for it makes curl exit 2 before it tries anything at all.
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
      Write-Host "    retrying $route with curl.exe" -ForegroundColor Yellow
      if ($route -eq "proxy") {
        & $curl.Path -fsSL -x $proxyUri -o $out $url
      } else {
        & $curl.Path -fsSL --noproxy "*" -o $out $url
      }
      if ($LASTEXITCODE -eq 0 -and (Test-Path $out)) { return }
    }
  }

  throw "could not download $url by any route"
}

# ---- 1. find the current command-line tools package ------------------- #

Write-Host "==> asking Google which command-line tools are current" -ForegroundColor Cyan
$url = $null
try {
  $xmlPath = Join-Path $env:TEMP "android-repository2-1.xml"
  Get-Web "$repo/repository2-1.xml" $xmlPath
  [xml]$xml = Get-Content $xmlPath
  foreach ($pkg in $xml.GetElementsByTagName("remotePackage")) {
    if ($pkg.path -ne "cmdline-tools;latest") { continue }
    foreach ($archive in $pkg.GetElementsByTagName("archive")) {
      $os = $archive.GetElementsByTagName("host-os")
      if ($os.Count -gt 0 -and $os[0].InnerText -eq "windows") {
        $u = $archive.GetElementsByTagName("url")
        if ($u.Count -gt 0) { $url = "$repo/" + $u[0].InnerText }
      }
    }
  }
} catch {
  Write-Host "    could not read the index: $($_.Exception.Message)" -ForegroundColor Yellow
}

if (-not $url) {
  $url = "$repo/commandlinetools-win-11076708_latest.zip"
  Write-Host "    falling back to a known package" -ForegroundColor Yellow
}
Write-Host "    $url"

# ---- 2. unpack it into the layout sdkmanager insists on --------------- #

$zip = Join-Path $env:TEMP "android-cmdline-tools.zip"
Write-Host "==> downloading" -ForegroundColor Cyan
Get-Web $url $zip

$staging = Join-Path $env:TEMP "android-cmdline-staging"
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $staging -Force

# The zip contains a folder called cmdline-tools; it has to end up at
# <sdk>\cmdline-tools\latest or sdkmanager refuses to run.
$dest = Join-Path $SdkRoot "cmdline-tools\latest"
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Copy-Item (Join-Path $staging "cmdline-tools\*") $dest -Recurse -Force

$sdkmanager = Join-Path $dest "bin\sdkmanager.bat"
if (-not (Test-Path $sdkmanager)) {
  Write-Host "sdkmanager is not where it should be: $sdkmanager" -ForegroundColor Red
  exit 1
}

# ---- 3. proxy arguments ----------------------------------------------- #

$sdkArgs = @("--sdk_root=$SdkRoot")
if ($proxyUsable) {
  $sdkArgs += "--proxy=http"
  $sdkArgs += "--proxy_host=$proxyHost"
  if ($proxyPort) { $sdkArgs += "--proxy_port=$proxyPort" }

  # Belt and braces: sdkmanager is a Gradle-style batch script, so the JVM
  # can also be told directly. One of the two always takes.
  $jvm = "-Dhttp.proxyHost=$proxyHost -Dhttps.proxyHost=$proxyHost"
  if ($proxyPort) { $jvm = "$jvm -Dhttp.proxyPort=$proxyPort -Dhttps.proxyPort=$proxyPort" }
  $env:JAVA_OPTS = $jvm
}

# ---- 4. ask which platform and build-tools are current ---------------- #

# From here on every command is a native .bat, and native tools write
# perfectly ordinary notices to stderr. With ErrorActionPreference set to
# Stop, PowerShell promotes any of them to a terminating error and the
# script dies on a deprecation warning. Exit codes are the real signal.
$ErrorActionPreference = "Continue"

Write-Host "==> listing available packages" -ForegroundColor Cyan
$list = (& $sdkmanager @sdkArgs --list 2>&1 | Out-String)

function Latest-Platform([string]$text) {
  $ns = [regex]::Matches($text, 'platforms;android-(\d+)[\s|]') |
        ForEach-Object { [int]$_.Groups[1].Value } |
        Sort-Object -Descending
  if ($ns.Count -gt 0) { return $ns[0] }
  return $null
}

function Latest-BuildTools([string]$text) {
  $vs = [regex]::Matches($text, 'build-tools;(\d+\.\d+\.\d+)[\s|]') |
        ForEach-Object { $_.Groups[1].Value } |
        Where-Object { $_ } |
        Sort-Object { [version]$_ } -Descending
  if ($vs.Count -gt 0) { return $vs[0] }
  return $null
}

$platform = Latest-Platform $list
$buildTools = Latest-BuildTools $list

$packages = @("platform-tools")
if ($platform)   { $packages += "platforms;android-$platform" }
if ($buildTools) { $packages += "build-tools;$buildTools" }

if ($platform -and $buildTools) {
  Write-Host "    platform android-$platform, build-tools $buildTools"
} else {
  # Not fatal. With the licences accepted, the Android Gradle plugin
  # downloads whichever platform and build-tools the project asks for.
  # Guessing a version here would be worse than letting it choose.
  Write-Host "    could not read versions from the listing; installing" -ForegroundColor Yellow
  Write-Host "    platform-tools only and letting Gradle fetch the rest" -ForegroundColor Yellow
}

# ---- 5. licences, then the packages ----------------------------------- #

Write-Host "==> accepting licences" -ForegroundColor Cyan
$yes = ("y`n" * 40)
$yes | & $sdkmanager @sdkArgs --licenses 2>&1 | Out-Null

Write-Host "==> installing: $($packages -join ', ')" -ForegroundColor Cyan
Write-Host "    (this is the long part)"
& $sdkmanager @sdkArgs @packages 2>&1 | ForEach-Object { "$_" }

# ---- 6. did it actually work? ----------------------------------------- #

$ok = (Test-Path (Join-Path $SdkRoot "platform-tools")) -and
      ((Test-Path (Join-Path $SdkRoot "platforms")) -or -not $platform)

if (-not $ok) {
  Write-Host ""
  Write-Host "The install did not leave an SDK behind at $SdkRoot" -ForegroundColor Red
  Write-Host "Contents:" -ForegroundColor Red
  if (Test-Path $SdkRoot) { Get-ChildItem $SdkRoot -Name | ForEach-Object { "  $_" } }
  exit 1
}

# ---- 7. tell Flutter where it went ------------------------------------ #

if (Get-Command flutter -ErrorAction SilentlyContinue) {
  flutter config --android-sdk "$SdkRoot" | Out-Null
  Write-Host ""
  Write-Host "==> flutter doctor" -ForegroundColor Cyan
  flutter doctor
}

Write-Host ""
Write-Host "Android SDK: $SdkRoot" -ForegroundColor Green
Write-Host "Now build:  powershell -ExecutionPolicy Bypass -File tool\build_android.ps1"
