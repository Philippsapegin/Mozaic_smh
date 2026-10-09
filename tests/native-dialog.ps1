param([Parameter(Mandatory=$true)][string]$WindowTitle, [string]$FilePath, [switch]$ConfirmOnly)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
using System.Threading;
public static class NativeDialogWindow {
    private delegate bool EnumWindowCallback(IntPtr handle, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindow(string className, string windowName);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumWindowCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr handle);
    [DllImport("user32.dll")] private static extern IntPtr GetDlgItem(IntPtr handle, int id);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr handle, StringBuilder name, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr SendMessage(IntPtr handle, uint message, IntPtr wparam, string text);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr handle, uint message, IntPtr wparam, IntPtr lparam);
    public static IntPtr Find(string title) { return FindWindow(null, title); }
    public static void FillAndSubmit(IntPtr dialog, string path) {
        IntPtr edit = IntPtr.Zero;
        var editControls = new List<string>();
        EnumChildWindows(dialog, (handle, parameter) => {
            var className = new StringBuilder(256);
            GetClassName(handle, className, 256);
            if (className.ToString().IndexOf("edit", StringComparison.OrdinalIgnoreCase) >= 0) editControls.Add(className + ":" + GetDlgCtrlID(handle));
            if (className.ToString() == "Edit" && GetDlgCtrlID(handle) == 1148) edit = handle;
            return true;
        }, IntPtr.Zero);
        if (!String.IsNullOrEmpty(path)) {
            if (edit == IntPtr.Zero) throw new Exception("File name Edit control 1148 not found: " + String.Join(", ", editControls));
            SendMessage(edit, 0x000C, IntPtr.Zero, path);
        }
        var button = GetDlgItem(dialog, 1);
        if (button == IntPtr.Zero) throw new Exception("Open/Save button not found");
        // Let the shell update the filename before sending IDOK to the dialog.
        Thread.Sleep(250);
        PostMessage(dialog, 0x0111, new IntPtr(1), button);
    }
}
'@
$handle = [IntPtr]::Zero
$deadline = [DateTime]::UtcNow.AddSeconds(20)
while ($handle -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline) {
    $handle = [NativeDialogWindow]::Find($WindowTitle)
    if ($handle -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 100 }
}
if ($handle -eq [IntPtr]::Zero) { throw "Native dialog not found: $WindowTitle" }
if (-not $ConfirmOnly -and -not $FilePath) { throw 'Pass FilePath or ConfirmOnly' }
$readyDeadline = [DateTime]::UtcNow.AddSeconds(5)
while ($true) {
    try { [NativeDialogWindow]::FillAndSubmit($handle, $FilePath); break }
    catch {
        if ([DateTime]::UtcNow -ge $readyDeadline -or $_.Exception.Message -notlike '*Edit control*not found*') { throw }
        Start-Sleep -Milliseconds 100
    }
}
