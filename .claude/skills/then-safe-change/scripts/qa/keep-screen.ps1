# QA のあいだだけ、Windows に「画面を消さない」と頼む（動画の再生と同じ仕組み）。
# スクリーンセーバーや電源の設定は変えない。このプロセスが終われば、ふだんの動きに戻る。
#
# 使い方: powershell -NoProfile -File keep-screen.ps1 [-ParentPid <pid>] [-MaxMinutes 45] [-Check]
#   -Check      スクリーンセーバーが動いているかを読むだけ（動いていれば exit 2）。
#   -ParentPid  この pid のプロセスが終わったら止まる（qa-session.mjs が自分の pid を渡す）。
# 止まる条件: 親が終わった、MaxMinutes を過ぎた、このプロセスが止められた。
# 出力: スクリーンセーバーを閉じたら "screensaver-closed"、続けて "keeping"。
#       ロックされていれば "locked"（exit 2、何もしない。OS の入力と撮影はできないので CDP で代える）。
param([int]$ParentPid = 0, [int]$MaxMinutes = 45, [switch]$Check)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class QaScreen {
  [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint action, uint param, ref int value, uint ini);
  [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);
  public static bool SaverRunning() { int running = 0; SystemParametersInfo(0x0072, 0, ref running, 0); return running != 0; }
}
"@

if ($Check) { if ([QaScreen]::SaverRunning()) { "screensaver-running"; exit 2 } "screensaver-off"; exit 0 }

# 出ているスクリーンセーバーは、マウスを動かす入力では消せない（入力が拒まれる）。
# パスワードのいらない設定で、ロック画面も出ていないときだけ、その .scr のプロセスを閉じる
# （利用者が動かしたマウスで閉じるのと同じ結果になる）。ロックされていれば何もしない。
if ([QaScreen]::SaverRunning()) {
  $secure = (Get-ItemProperty "HKCU:\Control Panel\Desktop" -Name ScreenSaverIsSecure -ErrorAction SilentlyContinue).ScreenSaverIsSecure
  if ("$secure" -eq "1" -or (Get-Process LogonUI -ErrorAction SilentlyContinue)) { "locked"; exit 2 }
  $session = (Get-Process -Id $PID).SessionId
  Get-Process | Where-Object { $_.SessionId -eq $session -and $_.Path -like "*.scr" } | Stop-Process -Force -ErrorAction SilentlyContinue
  for ($i = 0; $i -lt 10 -and [QaScreen]::SaverRunning(); $i++) { Start-Sleep -Milliseconds 300 }
  if ([QaScreen]::SaverRunning()) { "screensaver-still-running"; exit 2 }
  "screensaver-closed"
}

# ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED。このスレッドが生きているあいだ有効。
[QaScreen]::SetThreadExecutionState([uint32]"0x80000003") | Out-Null
"keeping"
$until = (Get-Date).AddMinutes($MaxMinutes)
while ((Get-Date) -lt $until) {
  if ($ParentPid -ne 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Seconds 5
}
[QaScreen]::SetThreadExecutionState([uint32]"0x80000000") | Out-Null
"released"
