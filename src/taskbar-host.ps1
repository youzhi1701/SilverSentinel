param(
  [Parameter(Mandatory=$true)][long]$ChildHandle,
  [int]$PreferredWidth = 360
)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class TaskbarHostNative {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string className, string title);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string title);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hwnd, int index, int value);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hwnd, int x, int y, int width, int height, bool repaint);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
}
'@
$taskbar = [TaskbarHostNative]::FindWindow('Shell_TrayWnd', $null)
if ($taskbar -eq [IntPtr]::Zero) { throw '找不到 Windows 任务栏窗口' }
$child = [IntPtr]$ChildHandle
$taskRect = New-Object TaskbarHostNative+RECT
if (-not [TaskbarHostNative]::GetWindowRect($taskbar, [ref]$taskRect)) { throw '无法读取任务栏尺寸' }
$tray = [TaskbarHostNative]::FindWindowEx($taskbar, [IntPtr]::Zero, 'TrayNotifyWnd', $null)
$trayRect = New-Object TaskbarHostNative+RECT
$hasTray = $tray -ne [IntPtr]::Zero -and [TaskbarHostNative]::GetWindowRect($tray, [ref]$trayRect)
$taskWidth = $taskRect.Right - $taskRect.Left
$taskHeight = $taskRect.Bottom - $taskRect.Top
$horizontal = $taskWidth -ge $taskHeight
if (-not $horizontal) { throw '当前为竖向任务栏，暂时无法容纳横向报价文字' }
$height = [Math]::Max(30, $taskHeight)
$width = [Math]::Min([Math]::Max(300, $PreferredWidth), [Math]::Max(300, $taskWidth - 260))
$rightEdge = if ($hasTray) { $trayRect.Left - $taskRect.Left - 8 } else { $taskWidth - 220 }
$x = [Math]::Max(120, $rightEdge - $width)
$GWL_STYLE = -16
$WS_CHILD = 0x40000000
$WS_POPUP = [unchecked]([int]0x80000000)
$WS_CAPTION = 0x00C00000
$WS_THICKFRAME = 0x00040000
$style = [TaskbarHostNative]::GetWindowLong($child, $GWL_STYLE)
$style = ($style -bor $WS_CHILD) -band (-bnot $WS_POPUP) -band (-bnot $WS_CAPTION) -band (-bnot $WS_THICKFRAME)
[void][TaskbarHostNative]::SetWindowLong($child, $GWL_STYLE, $style)
[void][TaskbarHostNative]::SetParent($child, $taskbar)
if (-not [TaskbarHostNative]::MoveWindow($child, $x, 0, $width, $height, $true)) { throw '无法把价格条放入任务栏' }
[void][TaskbarHostNative]::SetWindowPos($child, [IntPtr]::Zero, $x, 0, $width, $height, 0x0040)
[void][TaskbarHostNative]::ShowWindow($child, 8)
[pscustomobject]@{ ok=$true; x=$x; y=0; width=$width; height=$height } | ConvertTo-Json -Compress
