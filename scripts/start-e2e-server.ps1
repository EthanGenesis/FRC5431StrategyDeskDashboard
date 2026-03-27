$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$buildIdPath = Join-Path $root '.next\\BUILD_ID'

if (-not (Test-Path $buildIdPath)) {
  Write-Host 'No production build found for Playwright. Running npm run build first...'
  npm run build
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

Write-Host 'Starting Playwright web server on http://127.0.0.1:3001'
npm run start -- --hostname 127.0.0.1 --port 3001
exit $LASTEXITCODE
