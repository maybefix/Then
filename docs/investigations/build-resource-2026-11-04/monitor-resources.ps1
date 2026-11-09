$ErrorActionPreference='SilentlyContinue'
$dest='C:\Users\uest\Documents\then\docs\investigations\build-resource-2026-11-04\resource-samples.jsonl'
for($i=0;$i -lt 900;$i++) {
 $p=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -match '^(cargo|rustc|link)\.exe$'})
 $os=Get-CimInstance Win32_OperatingSystem
 [pscustomobject]@{time=[datetime]::UtcNow.ToString('o');freeKiB=$os.FreePhysicalMemory;freeCommitKiB=$os.FreeVirtualMemory;processes=@($p | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,PrivatePageCount,PeakWorkingSetSize,PeakPageFileUsage)} | ConvertTo-Json -Depth 4 -Compress | Add-Content -LiteralPath $dest
 if($p.Count -eq 0){break}
 Start-Sleep -Seconds 2
}
