param([ValidateSet('codex','github')][string]$Provider='codex')
$ErrorActionPreference='Stop'
$graphRoot=Split-Path $PSScriptRoot
$config=Get-Content -LiteralPath (Join-Path $graphRoot 'config.json') -Raw | ConvertFrom-Json
foreach($key in @('nodePath','gitPath','ghPath')){if($config.$key){$env:PATH=(Split-Path $config.$key)+';'+$env:PATH}}
if($Provider -eq 'codex'){& $config.codexPath login}
else{& $config.ghPath auth login --hostname github.com --git-protocol https --web;if($LASTEXITCODE -eq 0){& $config.ghPath auth setup-git}}
exit $LASTEXITCODE
