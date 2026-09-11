$ErrorActionPreference = 'Continue'

$projectRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $projectRoot 'ai-agent\venv\Scripts\python.exe'
$pythonPath = if (Test-Path -LiteralPath $venvPython) { $venvPython } else { 'python' }
$agentPath = Join-Path $projectRoot 'ai-agent\agent.py'
$logDir = Join-Path $projectRoot 'logs'
$logPath = Join-Path $logDir 'calling-agent.log'

if (-not (Test-Path -LiteralPath $agentPath)) { throw "Calling-agent source was not found: $agentPath" }
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

while ($true) {
  "$(Get-Date -Format o) Starting AI calling worker" | Add-Content -LiteralPath $logPath
  & $pythonPath $agentPath start *>> $logPath
  "$(Get-Date -Format o) AI calling worker exited; restarting in 5 seconds" | Add-Content -LiteralPath $logPath
  Start-Sleep -Seconds 5
}
