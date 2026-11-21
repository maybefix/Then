# OS input for QA (SendInput), DPI-aware. One action per call.
#   -Pid <then pid> -Info                       window client origin (physical px) and foreground check
#   -Pid <pid> -Focus                           bring Then to the front
#   -Pid <pid> -ClickCss "x,y" -Dpr 1.25        left click at CSS px of the webview (client origin + css*dpr)
#   -Text "..."                                 type Unicode text
#   -Keys "CTRL+S,END,RETURN"                   virtual keys, CTRL+ / SHIFT+ prefixes
#   -Pid <pid> -Shot <png>                      capture the Then window only, and only if it is the foreground window
#   -Pid <pid> -DblClickCss "x,y" -Dpr 1.25     double click at CSS px
#   -Pid <pid> -DragCss "x1,y1;x2,y2" -Dpr 1.25  press at the first point, move there in steps, release at the second
#   -Pid <pid> -Move "x,y,w,h"                   place and size the window (physical px)
#   -Title "Then - Idea Board" ...               target the top-level window with this exact title instead of the main window
#                                               (all actions above work with -Title in place of -Pid)
param([int]$WindowPid = 0, [string]$Title = "", [switch]$Info, [switch]$Focus, [string]$ClickCss = "", [string]$DblClickCss = "", [string]$DragCss = "", [string]$Move = "", [double]$Dpr = 1, [string]$Text = "", [string]$Keys = "", [string]$Shot = "")
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Os {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION u; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hgt, bool repaint);
  public static uint Button(int x, int y, uint flags) {
    SetCursorPos(x, y);
    var d = new INPUT { type = 0 }; d.u.mi.dwFlags = flags;
    return Send(new[] { d });
  }
  static uint Send(INPUT[] a) { return SendInput((uint)a.Length, a, Marshal.SizeOf(typeof(INPUT))); }
  public static uint Click(int x, int y) {
    SetCursorPos(x, y);
    var d = new INPUT { type = 0 }; d.u.mi.dwFlags = 2;
    var u = new INPUT { type = 0 }; u.u.mi.dwFlags = 4;
    return Send(new[] { d, u });
  }
  public static uint Key(ushort vk, ushort scan, uint flags, bool up) {
    var k = new INPUT { type = 1 }; k.u.ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags | (up ? 2u : 0u) };
    return Send(new[] { k });
  }
}
"@
[Os]::SetProcessDPIAware() | Out-Null
$hwnd = [IntPtr]::Zero
if ($WindowPid -ne 0) { $hwnd = (Get-Process -Id $WindowPid).MainWindowHandle }
# FindWindow needs a real null class name: PowerShell turns $null into "" for string parameters.
if ($Title) { $hwnd = [Os]::FindWindow([NullString]::Value, $Title); if ($hwnd -eq [IntPtr]::Zero) { "window not found: $Title"; exit 4 } }
function Origin { $p = New-Object Os+POINT; [Os]::ClientToScreen($hwnd, [ref]$p) | Out-Null; $p }
$sent = 0
if ($Info) { $o = Origin; "client origin $($o.X),$($o.Y); foreground=$([Os]::GetForegroundWindow() -eq $hwnd)" }
if ($Focus) {
  # Windows lets a process take the foreground only right after it sent input: tap a key first.
  # F24, not ALT: a lone ALT tap opened Then's window menu, which holds the page until it closes (2026-11-21).
  [Os]::Key(0x87, 0, 0, $false) | Out-Null; [Os]::Key(0x87, 0, 0, $true) | Out-Null
  [Os]::ShowWindow($hwnd, 9) | Out-Null; [Os]::SetForegroundWindow($hwnd) | Out-Null; Start-Sleep -Milliseconds 300; "foreground=$([Os]::GetForegroundWindow() -eq $hwnd)" }
if ($ClickCss) {
  $c = $ClickCss.Split(","); $o = Origin
  $x = [int]($o.X + [double]$c[0] * $Dpr); $y = [int]($o.Y + [double]$c[1] * $Dpr)
  $sent = [Os]::Click($x, $y); "click screen $x,$y sent=$sent"
}
if ($DblClickCss) {
  $c = $DblClickCss.Split(","); $o = Origin
  $x = [int]($o.X + [double]$c[0] * $Dpr); $y = [int]($o.Y + [double]$c[1] * $Dpr)
  $sent = [Os]::Click($x, $y); Start-Sleep -Milliseconds 80; $sent += [Os]::Click($x, $y); "double click screen $x,$y sent=$sent"
}
if ($DragCss) {
  $pts = $DragCss.Split(";"); $a = $pts[0].Split(","); $b = $pts[1].Split(","); $o = Origin
  $x1 = [int]($o.X + [double]$a[0] * $Dpr); $y1 = [int]($o.Y + [double]$a[1] * $Dpr)
  $x2 = [int]($o.X + [double]$b[0] * $Dpr); $y2 = [int]($o.Y + [double]$b[1] * $Dpr)
  $sent = [Os]::Button($x1, $y1, 2); Start-Sleep -Milliseconds 120
  # Move in steps so pointermove thresholds and hover targets see the path, not a jump.
  for ($i = 1; $i -le 20; $i++) { $sent += [Os]::Button([int]($x1 + ($x2 - $x1) * $i / 20), [int]($y1 + ($y2 - $y1) * $i / 20), 1); Start-Sleep -Milliseconds 25 }
  Start-Sleep -Milliseconds 150; $sent += [Os]::Button($x2, $y2, 4); "drag screen $x1,$y1 -> $x2,$y2 sent=$sent"
}
if ($Move) {
  $m = $Move.Split(","); [Os]::MoveWindow($hwnd, [int]$m[0], [int]$m[1], [int]$m[2], [int]$m[3], $true) | Out-Null; Start-Sleep -Milliseconds 300
  $r = New-Object Os+RECT; [Os]::GetWindowRect($hwnd, [ref]$r) | Out-Null; "window $($r.Left),$($r.Top) $($r.Right - $r.Left)x$($r.Bottom - $r.Top)"
}
if ($Text) {
  foreach ($ch in $Text.ToCharArray()) { $sent += [Os]::Key(0, [uint16][char]$ch, 4, $false); $sent += [Os]::Key(0, [uint16][char]$ch, 4, $true); Start-Sleep -Milliseconds 30 }
  "typed $($Text.Length) chars sent=$sent"
}
if ($Keys) {
  $map = @{ END = 0x23; HOME = 0x24; RETURN = 0x0D; ESCAPE = 0x1B; BACK = 0x08; DELETE = 0x2E; S = 0x53; CTRL = 0x11; SHIFT = 0x10; ALT = 0x12; F4 = 0x73 }
  foreach ($k in $Keys.Split(",")) {
    $parts = $k.Split("+"); $mods = $parts[0..($parts.Length - 2)] | Where-Object { $_ -and $parts.Length -gt 1 }; $main = $parts[-1]
    foreach ($m in $mods) { $sent += [Os]::Key([uint16]$map[$m], 0, 0, $false) }
    $sent += [Os]::Key([uint16]$map[$main], 0, 0, $false); $sent += [Os]::Key([uint16]$map[$main], 0, 0, $true)
    foreach ($m in $mods) { $sent += [Os]::Key([uint16]$map[$m], 0, 0, $true) }
    Start-Sleep -Milliseconds 60
  }
  "keys $Keys sent=$sent"
}
if ($Shot) {
  if ([Os]::GetForegroundWindow() -ne $hwnd) { "shot skipped: Then is not the foreground window"; exit 3 }
  Add-Type -AssemblyName System.Drawing
  $r = New-Object Os+RECT; [Os]::GetWindowRect($hwnd, [ref]$r) | Out-Null
  $bmp = New-Object System.Drawing.Bitmap ($r.Right - $r.Left), ($r.Bottom - $r.Top)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
  $bmp.Save($Shot, [System.Drawing.Imaging.ImageFormat]::Png)
  "shot window $($r.Left),$($r.Top) $($bmp.Width)x$($bmp.Height)"
}
