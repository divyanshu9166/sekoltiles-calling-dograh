$ErrorActionPreference = 'Stop'

$packageRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Split-Path -Parent $packageRoot
$relativeFiles = @(
  '.env',
  'lib\dograh.ts',
  'lib\calling-agent-status.ts',
  'lib\calling-agent\outbound.ts',
  'lib\validations\ai-call.ts',
  'app\actions\calls.ts',
  'app\api\calls\outbound\route.ts',
  'app\api\calls\token\route.ts',
  'app\api\calls\log\route.ts',
  'app\api\calls\schedule-callback\route.ts'
)

$failed = $false
foreach ($relativeFile in $relativeFiles) {
  $sourcePath = Join-Path $sourceRoot $relativeFile
  $packagePath = Join-Path $packageRoot $relativeFile
  $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourcePath).Hash
  $packageHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $packagePath).Hash
  $matches = $sourceHash -eq $packageHash
  if (-not $matches) { $failed = $true }
  [pscustomobject]@{
    File = $relativeFile
    ExactMatch = $matches
  }
}

if ($failed) {
  throw 'Core calling-agent parity check failed.'
}

Write-Output 'Core calling-agent parity check passed.'
