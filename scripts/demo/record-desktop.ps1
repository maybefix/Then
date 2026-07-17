param(
  [string]$Scenario = "scripts/demo/scenario.json",
  [string]$OutputDirectory = "artifacts/demo",
  [string]$AppPath = "",
  [string]$FFmpeg = "",
  [int]$FrameRate = 30,
  [int]$DebugPort = 9223,
  [switch]$SkipEdit,
  [switch]$KeepAppOpen
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
Set-Location $root

if (-not $FFmpeg) {
  if ($env:THEN_FFMPEG) { $FFmpeg = $env:THEN_FFMPEG }
  else {
    $command = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($command) { $FFmpeg = $command.Source }
  }
}
if (-not $FFmpeg -or -not (Test-Path -LiteralPath $FFmpeg)) {
  throw "FFmpeg was not found. Add it to PATH or set -FFmpeg / THEN_FFMPEG."
}

if (-not $AppPath) {
  $release = Join-Path $root "src-tauri/target/release/Then.exe"
  $debug = Join-Path $root "src-tauri/target/debug/Then.exe"
  if (Test-Path -LiteralPath $release) { $AppPath = $release }
  elseif (Test-Path -LiteralPath $debug) { $AppPath = $debug }
  else { throw "Then.exe was not found. Run npm run tauri:build first." }
}

$output = Join-Path $root $OutputDirectory
New-Item -ItemType Directory -Force -Path $output | Out-Null
$rawPath = Join-Path $output "then-demo-raw.mkv"
$timelinePath = Join-Path $output "timeline.json"
$finalPath = Join-Path $output "then-demo.mp4"
$scenarioPath = (Resolve-Path -LiteralPath (Join-Path $root $Scenario)).Path
$templateWorkspace = (Resolve-Path -LiteralPath (Join-Path $root "scripts/demo/sample-workspace")).Path
$demoWorkspace = Join-Path $output "workspace"
if (Test-Path -LiteralPath $demoWorkspace) { Remove-Item -LiteralPath $demoWorkspace -Recurse -Force }
Copy-Item -LiteralPath $templateWorkspace -Destination $demoWorkspace -Recurse

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ThenDemoWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
public static class ThenDemoDisplay {
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
  [DllImport("gdi32.dll")] public static extern int GetDeviceCaps(IntPtr hDC, int index);
}
"@

# gdigrab uses physical pixels. WinForms Screen.Bounds can be DPI-virtualized,
# which would crop the right and bottom edges on displays scaled above 100%.
$desktopDc = [ThenDemoDisplay]::GetDC([IntPtr]::Zero)
try {
  $captureWidth = [ThenDemoDisplay]::GetDeviceCaps($desktopDc, 118)  # DESKTOPHORZRES
  $captureHeight = [ThenDemoDisplay]::GetDeviceCaps($desktopDc, 117) # DESKTOPVERTRES
}
finally {
  [void][ThenDemoDisplay]::ReleaseDC([IntPtr]::Zero, $desktopDc)
}
if ($captureWidth -le 0 -or $captureHeight -le 0) {
  throw "The physical primary-display resolution could not be detected."
}

if (Get-Process Then -ErrorAction SilentlyContinue) {
  throw "Then is already running. Close it before recording to protect the active session."
}

$previousWebViewArgs = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$DebugPort"
$appStatePath = Join-Path $env:APPDATA "local.then\app-state.json"
$hadAppState = Test-Path -LiteralPath $appStatePath
$appStateBytes = if ($hadAppState) { [System.IO.File]::ReadAllBytes($appStatePath) } else { $null }
$app = $null
$recorder = $null
$clock = [System.Diagnostics.Stopwatch]::StartNew()

try {
  $app = Start-Process -FilePath $AppPath -WorkingDirectory $root -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds(25)
  while ([DateTime]::UtcNow -lt $deadline) {
    $app.Refresh()
    if ($app.MainWindowHandle -ne 0) { break }
    Start-Sleep -Milliseconds 250
  }
  if ($app.MainWindowHandle -eq 0) { throw "The Then main window did not open." }
  [void][ThenDemoWindow]::ShowWindowAsync($app.MainWindowHandle, 3)
  [void][ThenDemoWindow]::SetForegroundWindow($app.MainWindowHandle)
  Start-Sleep -Milliseconds 800

  $recorderInfo = New-Object System.Diagnostics.ProcessStartInfo
  $recorderInfo.FileName = $FFmpeg
  $recorderInfo.UseShellExecute = $false
  $recorderInfo.RedirectStandardInput = $true
  $recorderInfo.Arguments = @(
    "-y",
    "-f gdigrab",
    "-framerate $FrameRate",
    "-draw_mouse 1",
    "-offset_x 0",
    "-offset_y 0",
    "-video_size ${captureWidth}x${captureHeight}",
    "-i desktop",
    "-c:v libx264",
    "-preset ultrafast",
    "-crf 16",
    "-pix_fmt yuv420p",
    ('"' + $rawPath + '"')
  ) -join " "
  $recorder = New-Object System.Diagnostics.Process
  $recorder.StartInfo = $recorderInfo
  $clock.Restart()
  if (-not $recorder.Start()) { throw "FFmpeg could not start recording." }
  Start-Sleep -Milliseconds 900

  $env:THEN_CDP_PORT = "$DebugPort"
  $env:THEN_DEMO_WORKSPACE = $demoWorkspace
  $env:THEN_APP_PID = $app.Id.ToString()
  $env:THEN_CAPTURE_WIDTH = $captureWidth.ToString()
  $env:THEN_CAPTURE_HEIGHT = $captureHeight.ToString()
  $env:THEN_RECORDING_OFFSET_MS = [Math]::Round($clock.Elapsed.TotalMilliseconds).ToString()
  & node "scripts/demo/run-scenario.mjs" $scenarioPath $timelinePath
  if ($LASTEXITCODE -ne 0) { throw "The recording scenario failed." }
  Start-Sleep -Milliseconds 700
}
finally {
  if ($recorder -and -not $recorder.HasExited) {
    $recorder.StandardInput.WriteLine("q")
    if (-not $recorder.WaitForExit(10000)) { $recorder.Kill() }
  }
  if ($app -and -not $KeepAppOpen -and -not $app.HasExited) {
    [void]$app.CloseMainWindow()
    if (-not $app.WaitForExit(5000)) { $app.Kill() }
  }
  if (-not $KeepAppOpen) {
    if ($hadAppState) {
      [System.IO.File]::WriteAllBytes($appStatePath, $appStateBytes)
    } elseif (Test-Path -LiteralPath $appStatePath) {
      Remove-Item -LiteralPath $appStatePath -Force
    }
  }
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousWebViewArgs
}

if (-not $SkipEdit) {
  $env:THEN_FFMPEG = $FFmpeg
  & node "scripts/demo/edit-video.mjs" $rawPath $timelinePath $finalPath
  if ($LASTEXITCODE -ne 0) { throw "Video editing failed." }
  & node "scripts/demo/validate-demo.mjs" $rawPath $timelinePath $finalPath $demoWorkspace
  if ($LASTEXITCODE -ne 0) { throw "Video validation failed." }
}

Write-Host "Raw:      $rawPath"
Write-Host "Timeline: $timelinePath"
if (-not $SkipEdit) { Write-Host "Final:    $finalPath" }
