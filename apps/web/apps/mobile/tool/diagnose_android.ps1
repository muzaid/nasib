# Dump everything that decides "is there an Android SDK" into one file.
# Run it, then tell Claude it is done - it reads the file itself.
#
#   powershell -ExecutionPolicy Bypass -File tool\diagnose_android.ps1

$out = "$env:USERPROFILE\Downloads\nasib-diag.txt"

& {
  "=== flutter config ==="
  flutter config

  "`n=== flutter doctor -v ==="
  flutter doctor -v

  "`n=== environment ==="
  "ANDROID_HOME     = $env:ANDROID_HOME"
  "ANDROID_SDK_ROOT = $env:ANDROID_SDK_ROOT"
  "JAVA_HOME        = $env:JAVA_HOME"

  "`n=== candidate sdk directories ==="
  foreach ($c in @("$env:LOCALAPPDATA\Android\Sdk", "C:\Android\Sdk",
                   "$env:ProgramFiles\Android\android-sdk",
                   "${env:ProgramFiles(x86)}\Android\android-sdk",
                   $env:ANDROID_HOME, $env:ANDROID_SDK_ROOT)) {
    if (-not $c) { continue }
    if (Test-Path $c) {
      "--- $c"
      Get-ChildItem $c -Name | ForEach-Object { "    $_" }
      foreach ($sub in @("platforms", "build-tools", "platform-tools", "cmdline-tools")) {
        $p = Join-Path $c $sub
        if (Test-Path $p) {
          "    $sub contains:"
          Get-ChildItem $p -Name | ForEach-Object { "      $_" }
        } else {
          "    $sub : MISSING"
        }
      }
    } else {
      "--- $c : does not exist"
    }
  }

  "`n=== java ==="
  if (Get-Command java -ErrorAction SilentlyContinue) { java -version } else { "java not on PATH" }
} *>&1 | Out-File -Encoding utf8 $out

Write-Host "Wrote $out" -ForegroundColor Green
Write-Host "Tell Claude it is ready."
