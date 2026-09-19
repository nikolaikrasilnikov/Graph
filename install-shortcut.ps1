param([string]$DesktopDirectory='')
$ErrorActionPreference='Stop'
if(!$DesktopDirectory){$DesktopDirectory=[Environment]::GetFolderPath('Desktop')}
if(!(Test-Path -LiteralPath $DesktopDirectory)){New-Item -ItemType Directory -Path $DesktopDirectory -Force | Out-Null}
$graphShell=New-Object -ComObject WScript.Shell
$graphShortcut=$graphShell.CreateShortcut((Join-Path $DesktopDirectory 'Graph.lnk'))
$graphShortcut.TargetPath=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$graphShortcut.Arguments='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+(Join-Path $PSScriptRoot 'start.ps1')+'"'
$graphShortcut.WorkingDirectory=$PSScriptRoot
$graphShortcut.IconLocation=(Join-Path $PSScriptRoot 'graph-icon-v5.ico')+',0'
$graphShortcut.Description='Graph - local agent workspace'
$graphShortcut.WindowStyle=7
$graphShortcut.Save()
Write-Output (Join-Path $DesktopDirectory 'Graph.lnk')
