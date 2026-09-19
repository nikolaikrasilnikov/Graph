param([switch]$NoBrowser)
$ErrorActionPreference='Stop'
$graphRoot=$PSScriptRoot
try{
 $configFile=Join-Path $graphRoot 'config.json'
 if(!(Test-Path -LiteralPath $configFile)){throw 'Run Setup.cmd first.'}
 $graphConfig=Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
 $paths=@();foreach($key in @('nodePath','gitPath','ghPath')){if($graphConfig.$key){$paths+=Split-Path $graphConfig.$key}}
 $env:PATH=($paths -join ';')+';'+$env:PATH
 $herdrArgs=@();if($graphConfig.herdrSession){$herdrArgs+=@('--session',$graphConfig.herdrSession)}
 $previousPreference=$ErrorActionPreference;$ErrorActionPreference='Continue'
 & $graphConfig.herdrPath @herdrArgs workspace list 2>$null | Out-Null
 $herdrReady=$LASTEXITCODE -eq 0;$ErrorActionPreference=$previousPreference
 if(!$herdrReady){
  Start-Process -FilePath $graphConfig.herdrPath -ArgumentList ($herdrArgs+@('server')) -WorkingDirectory $graphRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $graphRoot 'herdr-start.log') -RedirectStandardError (Join-Path $graphRoot 'herdr-error.log') | Out-Null
  for($i=0;$i -lt 40;$i++){Start-Sleep -Milliseconds 300;$ErrorActionPreference='Continue';& $graphConfig.herdrPath @herdrArgs workspace list 2>$null | Out-Null;$herdrReady=$LASTEXITCODE -eq 0;$ErrorActionPreference=$previousPreference;if($herdrReady){break}}
  if(!$herdrReady){throw 'Herdr did not start. See herdr-error.log.'}
 }
 $graphUrl='http://127.0.0.1:'+$graphConfig.port
 $graphStatus=$null;try{$graphStatus=Invoke-RestMethod -Uri ($graphUrl+'/api/health') -TimeoutSec 3}catch{}
 if($graphStatus -and $graphStatus.installationRoot -ne $graphRoot){throw 'This port belongs to another instance. Choose another port in config.json.'}
 if(!$graphStatus){
  $graphNode=$graphConfig.nodePath;if(!$graphNode){$graphNode=(Get-Command node.exe -ErrorAction Stop).Source}
  $process=Start-Process -FilePath $graphNode -ArgumentList ('"'+(Join-Path $graphRoot 'server.mjs')+'"') -WorkingDirectory $graphRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $graphRoot 'server.log') -RedirectStandardError (Join-Path $graphRoot 'server-error.log') -PassThru
  [IO.File]::WriteAllText((Join-Path $graphRoot '.server.pid'),[string]$process.Id)
  for($i=0;$i -lt 40;$i++){Start-Sleep -Milliseconds 300;try{$graphStatus=Invoke-RestMethod -Uri ($graphUrl+'/api/health') -TimeoutSec 3;if($graphStatus.installationRoot -eq $graphRoot){break}}catch{}}
 }
 if(!$graphStatus -or $graphStatus.installationRoot -ne $graphRoot){throw 'Graph did not start. See server-error.log.'}
 if(!$NoBrowser){Start-Process $graphUrl}
 Write-Output $graphUrl
}catch{
 [IO.File]::WriteAllText((Join-Path $graphRoot 'startup-error.log'),$_.Exception.Message)
 if(!$NoBrowser){Add-Type -AssemblyName PresentationFramework;[System.Windows.MessageBox]::Show($_.Exception.Message,'Graph startup') | Out-Null}
 throw
}
