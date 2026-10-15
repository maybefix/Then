param(
  [string]$Scenario = "scripts/guide/scenario.json",
  [string]$OutputDirectory = "artifacts/guide",
  [string]$AppPath = "",
  [string]$WorkspaceTemplate = "scripts/demo/sample-workspace",
  [int]$DebugPort = 9224,
  [switch]$KeepAppOpen
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
Set-Location $root

if (-not $AppPath) {
  $release = Join-Path $root "src-tauri/target/release/Then.exe"
  $debug = Join-Path $root "src-tauri/target/debug/Then.exe"
  if (Test-Path -LiteralPath $release) { $AppPath = $release }
  elseif (Test-Path -LiteralPath $debug) { $AppPath = $debug }
  else { throw "Then.exe was not found. Run npm run tauri:build or npm run tauri:dev first." }
}

$scenarioPath = (Resolve-Path -LiteralPath (Join-Path $root $Scenario)).Path
$output = Join-Path $root $OutputDirectory
New-Item -ItemType Directory -Force -Path $output | Out-Null

$templateWorkspace = (Resolve-Path -LiteralPath (Join-Path $root $WorkspaceTemplate)).Path
$guideWorkspace = Join-Path $output "workspace"
if (Test-Path -LiteralPath $guideWorkspace) {
  Remove-Item -LiteralPath $guideWorkspace -Recurse -Force
}
Copy-Item -LiteralPath $templateWorkspace -Destination $guideWorkspace -Recurse

if (Get-Process Then -ErrorAction SilentlyContinue) {
  throw "Then is already running. Close it before generating a guide so the active session is not modified."
}

$previousWebViewArgs = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$previousCdpPort = $env:THEN_CDP_PORT
$previousGuideWorkspace = $env:THEN_GUIDE_WORKSPACE
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$DebugPort"
$env:THEN_CDP_PORT = "$DebugPort"
$env:THEN_GUIDE_WORKSPACE = $guideWorkspace

$appStatePath = Join-Path $env:APPDATA "local.then\app-state.json"
$hadAppState = Test-Path -LiteralPath $appStatePath
$appStateBytes = if ($hadAppState) { [System.IO.File]::ReadAllBytes($appStatePath) } else { $null }
$app = $null

try {
  $app = Start-Process -FilePath $AppPath -WorkingDirectory $root -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds(25)
  while ([DateTime]::UtcNow -lt $deadline) {
    $app.Refresh()
    if ($app.MainWindowHandle -ne 0) { break }
    Start-Sleep -Milliseconds 250
  }
  if ($app.MainWindowHandle -eq 0) { throw "The Then main window did not open." }

  Start-Sleep -Milliseconds 900
  $env:THEN_APP_PID = $app.Id.ToString()

  & node "scripts/guide/run-guide.mjs" $scenarioPath $output
  if ($LASTEXITCODE -ne 0) { throw "Operation guide generation failed." }
}
finally {
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
  $env:THEN_CDP_PORT = $previousCdpPort
  $env:THEN_GUIDE_WORKSPACE = $previousGuideWorkspace
  Remove-Item Env:THEN_APP_PID -ErrorAction SilentlyContinue
}

Write-Host "Guide:       $(Join-Path $output 'guide.md')"
Write-Host "Steps:       $(Join-Path $output 'steps.json')"
Write-Host "Screenshots: $(Join-Path $output 'screenshots')"
Write-Host "Workspace:   $guideWorkspace"
