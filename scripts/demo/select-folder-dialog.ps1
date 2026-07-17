param(
  [Parameter(Mandatory = $true)]
  [string]$Path,
  [int]$OwnerProcessId = 0,
  [int]$TimeoutSeconds = 15
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ThenDemoNativeWindow {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  public delegate bool EnumChildProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumChildProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
}
"@

$resolved = (Resolve-Path -LiteralPath $Path).Path
$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
$dialog = [IntPtr]::Zero

while ([DateTime]::UtcNow -lt $deadline -and $dialog -eq [IntPtr]::Zero) {
  [ThenDemoNativeWindow]::EnumWindows({
    param([IntPtr]$handle, [IntPtr]$unused)
    if (-not [ThenDemoNativeWindow]::IsWindowVisible($handle)) { return $true }
    $className = New-Object System.Text.StringBuilder 128
    [void][ThenDemoNativeWindow]::GetClassName($handle, $className, $className.Capacity)
    if ($className.ToString() -eq "#32770") {
      [uint32]$windowProcessId = 0
      [void][ThenDemoNativeWindow]::GetWindowThreadProcessId($handle, [ref]$windowProcessId)
      if ($OwnerProcessId -gt 0 -and $windowProcessId -ne $OwnerProcessId) { return $true }
      $script:dialog = $handle
      return $false
    }
    return $true
  }, [IntPtr]::Zero) | Out-Null
  if ($dialog -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 200 }
}

if ($dialog -eq [IntPtr]::Zero) {
  throw "The folder picker was not found within ${TimeoutSeconds} seconds."
}

[void][ThenDemoNativeWindow]::SetForegroundWindow($dialog)
Start-Sleep -Milliseconds 350
[System.Windows.Forms.SendKeys]::SendWait("^l")
Start-Sleep -Milliseconds 200
$sendKeysPath = -join ($resolved.ToCharArray() | ForEach-Object {
  if ("+^%~()[]{}".Contains($_)) { "{$_}" } else { $_ }
})
[System.Windows.Forms.SendKeys]::SendWait($sendKeysPath)
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 1000

$confirmHandle = [IntPtr]::Zero
$nativeButtonNames = @(
  "フォルダーの選択",
  "フォルダーの選択(&S)",
  "このフォルダーを選択",
  "Select Folder",
  "Select folder",
  "Select"
)
[ThenDemoNativeWindow]::EnumChildWindows($dialog, {
  param([IntPtr]$handle, [IntPtr]$unused)
  $className = New-Object System.Text.StringBuilder 64
  [void][ThenDemoNativeWindow]::GetClassName($handle, $className, $className.Capacity)
  if ($className.ToString() -ne "Button" -or -not [ThenDemoNativeWindow]::IsWindowEnabled($handle)) { return $true }
  $caption = New-Object System.Text.StringBuilder 256
  [void][ThenDemoNativeWindow]::GetWindowText($handle, $caption, $caption.Capacity)
  if ($nativeButtonNames -contains $caption.ToString()) {
    $script:confirmHandle = $handle
    return $false
  }
  return $true
}, [IntPtr]::Zero) | Out-Null

if ($confirmHandle -ne [IntPtr]::Zero) {
  # BM_CLICK works even when keyboard focus remains in the address bar.
  [void][ThenDemoNativeWindow]::SendMessage($confirmHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
  exit 0
}

$root = [System.Windows.Automation.AutomationElement]::FromHandle($dialog)
$buttonCondition = [System.Windows.Automation.PropertyCondition]::new(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Button
)
$buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
$preferredNames = @(
  "フォルダーの選択",
  "フォルダーの選択(&S)",
  "フォルダーの選択(S)",
  "このフォルダーを選択",
  "Select Folder",
  "Select folder",
  "Select"
)
$confirm = $null

foreach ($name in $preferredNames) {
  foreach ($button in $buttons) {
    if ($button.Current.Name -eq $name -and $button.Current.IsEnabled) {
      $confirm = $button
      break
    }
  }
  if ($confirm) { break }
}

if (-not $confirm) {
  foreach ($button in $buttons) {
    if ($button.Current.AutomationId -eq "1" -and $button.Current.IsEnabled) {
      $confirm = $button
      break
    }
  }
}

if (-not $confirm) {
  $buttonNames = @($buttons | ForEach-Object { $_.Current.Name }) -join ", "
  throw "The folder picker confirm button was not found. Buttons: $buttonNames"
}

$invoke = $confirm.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
$invoke.Invoke()
