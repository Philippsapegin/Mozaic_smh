param([string]$Shortcut, [string]$WorkingDirectory)
Start-Process -FilePath $Shortcut -WorkingDirectory $WorkingDirectory -WindowStyle Hidden
