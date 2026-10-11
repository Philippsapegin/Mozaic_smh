$projectRoot = Split-Path -LiteralPath $PSScriptRoot
$installedPath = Join-Path $env:LOCALAPPDATA 'Mozaic\mozaic.exe'
$installedPaths = @($installedPath)
$registration = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Mozaic' -ErrorAction SilentlyContinue
if ($registration.InstallLocation) {
  $binaryName = if ($registration.MainBinaryName) { $registration.MainBinaryName } else { 'mozaic.exe' }
  $installedPaths += Join-Path ($registration.InstallLocation.Trim('"')) $binaryName
}
$paths = @($installedPaths) + @((Join-Path $projectRoot 'app\Mozaic.exe'))
$releasePath = Join-Path $projectRoot 'release'
if (Test-Path -LiteralPath $releasePath) {
  $paths += Get-ChildItem -LiteralPath $releasePath -Filter 'Mozaic-*.exe' |
    Where-Object { $_.BaseName -match '^Mozaic-\d+\.\d+\.\d+$' } | ForEach-Object { $_.FullName }
}
$applications = foreach ($path in $paths) {
  if (Test-Path -LiteralPath $path -PathType Leaf) {
    $file = Get-Item -LiteralPath $path
    try { $version = [version]($file.VersionInfo.ProductVersion -replace '[+-].*$', '') }
    catch { $version = [version]'0.0.0' }
    [PSCustomObject]@{ Path = $path; Version = $version; Installed = ($installedPaths -contains $path) }
  }
}
$application = $applications | Sort-Object Version,Installed -Descending | Select-Object -First 1
if ($application) {
  Start-Process -FilePath $application.Path -WorkingDirectory (Split-Path -LiteralPath $application.Path) -WindowStyle Normal
} else {
  Start-Process 'https://github.com/Philippsapegin/Mozaic_smh/releases/latest'
}
