# SporArea: install dependencies (server + mobile)
# Run: powershell -ExecutionPolicy Bypass -File .\KURULUM.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "Folder:" (Get-Location)
Write-Host ""

try {
  $null = Get-Command node -ErrorAction Stop
  $null = Get-Command npm -ErrorAction Stop
  Write-Host "Node:" (node -v)
  Write-Host "npm: " (npm -v)
} catch {
  Write-Host "ERROR: Node.js is not installed. Install LTS from https://nodejs.org (v20 or v22 recommended)."
  exit 1
}

Write-Host ""
Write-Host "Running npm run install:all ..."
npm run install:all

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "ERROR: npm failed. Copy the red error text above and share it."
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Done. Next:"
Write-Host "  Terminal 1:  npm run server"
Write-Host "  Terminal 2:  npm run mobile"
exit 0
