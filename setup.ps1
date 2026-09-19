[CmdletBinding()]
param(
 [string]$NodePath='', [string]$HerdrPath='', [string]$CodexPath='', [string]$ClaudePath='',
 [string]$GitPath='', [string]$GhPath='', [string]$LibraryRoot='', [string]$DataRoot='',
 [string]$DesktopDirectory='', [ValidateRange(1024,65535)][int]$Port=4317,
 [switch]$NoShortcut, [switch]$UseBundledTools, [switch]$Reconfigure
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$graphRoot=$PSScriptRoot
$configFile=Join-Path $graphRoot 'config.json'
if((Test-Path -LiteralPath $configFile) -and !$Reconfigure){
 Write-Host 'Existing config.json preserved. Use -Reconfigure explicitly to change setup.'
 if(!$NoShortcut){ & (Join-Path $graphRoot 'install-shortcut.ps1') -DesktopDirectory $DesktopDirectory }
 exit 0
}
$lock=Get-Content -LiteralPath (Join-Path $graphRoot 'scripts/dependencies.lock.json') -Raw | ConvertFrom-Json
function Get-GraphTool([string]$Name,[string]$Explicit){
 if($Explicit){if(!(Test-Path -LiteralPath $Explicit -PathType Leaf)){throw "Missing $Name executable: $Explicit"};return (Resolve-Path -LiteralPath $Explicit).Path}
 if(!$UseBundledTools -and $Name -in @('node','git','gh')){
  $found=Get-Command ($Name+'.exe') -ErrorAction SilentlyContinue
  if($found){return $found.Source}
 }
 $entry=$lock.$Name
 $toolRoot=Join-Path $graphRoot ('.runtime/'+$Name+'/'+$entry.version)
 $expected=Join-Path $toolRoot $entry.executable
 if(Test-Path -LiteralPath $expected -PathType Leaf){return (Resolve-Path -LiteralPath $expected).Path}
 $cache=Join-Path $graphRoot '.downloads'
 New-Item -ItemType Directory -Force -Path $cache,$toolRoot | Out-Null
 $archive=Join-Path $cache ($Name+'-'+$entry.version+$(if($entry.url.EndsWith('.tgz')){'.tgz'}else{'.zip'}))
 Write-Host "Downloading official $Name $($entry.version)..."
 if(!(Test-Path -LiteralPath $archive)){Invoke-WebRequest -Uri $entry.url -OutFile $archive -UseBasicParsing}
 if($entry.sha256){$digest=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLower();if($digest -ne $entry.sha256){throw "Checksum mismatch: $archive. Remove this download and retry."}}
 elseif($entry.integrity){$hash=[Security.Cryptography.SHA512]::Create();$stream=[IO.File]::OpenRead($archive);try{$digest='sha512-'+[Convert]::ToBase64String($hash.ComputeHash($stream))}finally{$stream.Dispose();$hash.Dispose()};if($digest -ne $entry.integrity){throw "Checksum mismatch: $archive"}}
 else{throw "No checksum for $Name"}
 if($archive.EndsWith('.tgz')){& tar.exe -xzf $archive -C $toolRoot;if($LASTEXITCODE -ne 0){throw "Failed to extract $Name"}}
 else{Expand-Archive -LiteralPath $archive -DestinationPath $toolRoot -Force}
 if(!(Test-Path -LiteralPath $expected -PathType Leaf)){throw "Expected executable not found: $expected"}
 return (Resolve-Path -LiteralPath $expected).Path
}
$node=Get-GraphTool 'node' $NodePath
$nodeVersion=(& $node --version).Trim();if($LASTEXITCODE -ne 0 -or [int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 22){throw 'Node.js 22+ required. Rerun with -UseBundledTools.'}
$herdr=Get-GraphTool 'herdr' $HerdrPath
$git=Get-GraphTool 'git' $GitPath
$gh=Get-GraphTool 'gh' $GhPath
$codex=Get-GraphTool 'codex' $CodexPath
$hostFile=Join-Path (Split-Path $codex) 'codex-code-mode-host.exe'
if(!(Test-Path -LiteralPath $hostFile)){throw 'Codex installation is incomplete: codex-code-mode-host.exe must be beside codex.exe.'}
$help=(& $codex exec --help 2>&1 | Out-String)
if($LASTEXITCODE -ne 0 -or $help -notmatch '--approve-for-me'){throw 'This Codex version does not support Graph automatic approval review. Use the pinned Codex from this installer.'}
if($ClaudePath -and !(Test-Path -LiteralPath $ClaudePath)){throw 'ClaudePath does not exist.'}
if(!$LibraryRoot){$LibraryRoot=Join-Path $graphRoot 'library'}
if(!$DataRoot){$DataRoot=Join-Path $graphRoot '.graph-data'}
$LibraryRoot=[IO.Path]::GetFullPath($LibraryRoot);$DataRoot=[IO.Path]::GetFullPath($DataRoot)
New-Item -ItemType Directory -Force -Path $LibraryRoot,$DataRoot | Out-Null
$seedRoot=Join-Path $graphRoot 'library-template'
foreach($source in Get-ChildItem -LiteralPath $seedRoot -Recurse -File){
 $relative=$source.FullName.Substring($seedRoot.Length).TrimStart('\','/')
 $destination=Join-Path $LibraryRoot $relative
 if(!(Test-Path -LiteralPath $destination)){New-Item -ItemType Directory -Force -Path (Split-Path $destination) | Out-Null;Copy-Item -LiteralPath $source.FullName -Destination $destination}
}
$config=Get-Content -LiteralPath (Join-Path $graphRoot 'config.example.json') -Raw | ConvertFrom-Json
$config.port=$Port;$config.libraryRoot=$LibraryRoot;$config.dataRoot=$DataRoot
$config.herdrPath=$herdr;$config.codexPath=$codex;$config.claudePath=$ClaudePath;$config.ghPath=$gh
$config | Add-Member -NotePropertyName nodePath -NotePropertyValue $node -Force
$config | Add-Member -NotePropertyName gitPath -NotePropertyValue $git -Force
$config | Add-Member -NotePropertyName herdrSession -NotePropertyValue ('graph-'+$Port) -Force
$config.defaultModel='codex:default';$config.githubAgentAuth=$false
$config.models=@(@{id='codex:default';label='Codex - configured default model';tier='balanced'})
if($ClaudePath){$config.models+=@{id='claude:sonnet';label='Claude - Sonnet';tier='balanced'}}
$utf8=New-Object System.Text.UTF8Encoding($false)
if(Test-Path -LiteralPath $configFile){Copy-Item -LiteralPath $configFile -Destination ($configFile+'.backup-'+(Get-Date -Format 'yyyyMMddHHmmss'))}
[IO.File]::WriteAllText($configFile,($config | ConvertTo-Json -Depth 8),$utf8)
if(!$NoShortcut){& (Join-Path $graphRoot 'install-shortcut.ps1') -DesktopDirectory $DesktopDirectory}
Write-Host 'Graph installed. No agent calls or GitHub actions have been made.'
Write-Host 'Next: open Login-Codex.cmd and finish sign-in yourself, then open the Graph desktop shortcut.'
Write-Host 'Optional GitHub: open Login-GitHub.cmd. Agent token access remains disabled by default.'
