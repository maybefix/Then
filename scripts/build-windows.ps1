# Hold the same lock across Then worktrees in this Windows session.
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath
$lock = [System.Threading.Mutex]::new($false, 'Local\ThenInstallerBuild')
$acquired = $false
$exitCode = 1
try {
    try {
        $acquired = $lock.WaitOne(0)
    } catch [System.Threading.AbandonedMutexException] {
        $acquired = $true
    }
    if (-not $acquired) {
        throw 'A Then installer build is already running in this Windows session.'
    }

    $env:CARGO_BUILD_JOBS = '1'
    Push-Location -LiteralPath $workspace
    try {
        & node (Join-Path $workspace 'node_modules\@tauri-apps\cli\tauri.js') build @args
        $exitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
} finally {
    if ($acquired) { $lock.ReleaseMutex() }
    $lock.Dispose()
}
exit $exitCode
