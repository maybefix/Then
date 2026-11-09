param(
  [Parameter(Mandatory)][ValidateSet('baseline','rlib','lowmem','split-initial','split-menu-only','final-label','final-menu-only','production')][string]$Label
)
$ErrorActionPreference='Stop'
$root = 'C:\Users\uest\Documents\then'
$lab = Join-Path $root 'tmp\build-resource-comparison-20261104'
$target = Join-Path $root 'src-tauri\target\release'
Set-Location -LiteralPath $root
$lock = [System.IO.File]::Open((Join-Path $lab 'build.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try {
  $env:CARGO_BUILD_JOBS = '1'
  $env:CARGO_NET_OFFLINE = 'true'
  $env:CI = 'true'
  $env:CARGO_PROFILE_RELEASE_STRIP = 'debuginfo'
  $out=Join-Path $lab "$Label.stdout.log"
  $err=Join-Path $lab "$Label.stderr.log"
  $samples=Join-Path $lab "$Label.samples.jsonl"
  $meta=Join-Path $lab "$Label.result.json"
  $existing = @(Get-Process cargo,rustc,link,makensis -ErrorAction SilentlyContinue)
  if ($existing.Count) {throw 'Another build is active'}
  $c = Get-PSDrive C
  if ($c.Free -lt 3GB) {throw 'Less than 3 GiB free for the comparison build'}
  $begin=[datetime]::UtcNow
  $prevFree=$c.Free
  $minFree=$prevFree
  $startBytes=(Get-ChildItem -LiteralPath $target -File -Recurse | Measure-Object Length -Sum).Sum
  $node=(Get-Command node.exe).Source
  $arguments=@('node_modules/@tauri-apps/cli/tauri.js','build','--ci','--bundles','nsis')
  if($Label -ne 'production'){$arguments+=@('--config','tmp/build-resource-comparison-20261104/qa-config.json')}
  if ($Label -in @('rlib','split-initial','split-menu-only','final-label','final-menu-only')) {
    $node=(Get-Command powershell.exe).Source
    $arguments=@('-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/build-windows.ps1')+@($arguments | Select-Object -Skip 2)
  }
  if ($Label -eq 'lowmem') {
    $arguments+=@('--','--config','profile.release.package.Then.opt-level=1')
  }
  if ($Label -match '^(split|final)-') { $arguments+=@('--','--verbose') }
  $build=Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
  do {
    $os=Get-CimInstance Win32_OperatingSystem
    $disk=(Get-PSDrive C).Free
    $minFree=[Math]::Min($minFree,$disk)
    $all=Get-Process ChatGPT,codex,node,cargo,rustc,link,makensis,Then,msedgewebview2 -ErrorAction SilentlyContinue
    $processes=@($all | Select-Object Id,Name,PrivateMemorySize64,WorkingSet64,PeakWorkingSet64,PeakPagedMemorySize64)
    [pscustomobject]@{time=[datetime]::UtcNow.ToString('o');freeRamKiB=$os.FreePhysicalMemory;freeCommitKiB=$os.FreeVirtualMemory;freeDisk=$disk;processes=$processes}|ConvertTo-Json -Depth 4 -Compress|Add-Content -LiteralPath $samples
    if(-not $build.HasExited){Start-Sleep -Milliseconds 1250}
  } until ($build.HasExited)
  $build.WaitForExit()
  $end=[datetime]::UtcNow
  $endBytes=(Get-ChildItem -LiteralPath $target -File -Recurse | Measure-Object Length -Sum).Sum
  $exitCode=$build.ExitCode
  $nsis=@(Get-ChildItem -LiteralPath (Join-Path $target 'bundle\nsis') -Filter '*.exe' | Where-Object {$_.LastWriteTimeUtc -ge $begin.AddSeconds(-1)})
  if($exitCode -eq 0 -and $nsis.Count -ne 1){throw "Expected one new installer, found $($nsis.Count)"}
  $artifact=$null
  if($exitCode -eq 0){
    $artifact=Join-Path $lab "$Label-installer.exe"
    Copy-Item -LiteralPath $nsis[0].FullName -Destination $artifact
  }
  $nativeArtifacts=@(Get-ChildItem -LiteralPath $target -File | Where-Object {$_.Name -match '^(lib)?brew_lib\.(rlib|lib|dll|pdb|dll\.(exp|lib))$' -and $_.LastWriteTimeUtc -ge $begin.AddSeconds(-1)} | Select-Object Name,Length)
  [pscustomobject]@{label=$Label;pid=$build.Id;exitCode=$exitCode;started=$begin;finished=$end;elapsedSeconds=($end-$begin).TotalSeconds;startingFreeBytes=$prevFree;minimumFreeBytes=$minFree;targetBeforeBytes=$startBytes;targetAfterBytes=$endBytes;nativeArtifacts=$nativeArtifacts;installer=$artifact} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $meta
} catch {
  $_ | Out-String | Set-Content -LiteralPath (Join-Path $lab "$Label.driver-error.log")
  throw
} finally {
  $lock.Dispose()
}
