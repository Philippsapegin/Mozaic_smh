param([string]$Shortcut, [string]$Target)
$link = (New-Object -ComObject WScript.Shell).CreateShortcut($Shortcut)
$link.TargetPath = Join-Path 'C:\__Mozaic_Portable__' $Target
$link.WindowStyle = 7
$link.Save()
