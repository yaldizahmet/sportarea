# Telefon icin mobile\.env -> EXPO_PUBLIC_API_URL (bu PC'nin Wi-Fi IPv4)
# sporarea klasorunde: powershell -ExecutionPolicy Bypass -File .\IP-GUNCELLE.ps1

$ErrorActionPreference = "Stop"
$root = (Resolve-Path $PSScriptRoot).Path
$envPath = Join-Path $root "mobile\.env"

$ip = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
  $_.InterfaceAlias -notmatch 'Loopback' -and
  $_.IPAddress -notmatch '^169\.254\.'
} | Sort-Object InterfaceMetric | Select-Object -First 1 -ExpandProperty IPAddress

if (-not $ip) {
  Write-Host "IPv4 bulunamadi. ipconfig ciktisindan Wi-Fi IPv4'u elle mobile\.env dosyasina yazin."
  exit 1
}

$url = "http://${ip}:3000/api"
$content = @"
# Guncelleme: IP-GUNCELLE.ps1
EXPO_PUBLIC_API_URL=$url
"@

Set-Content -Path $envPath -Value $content -Encoding utf8
Write-Host "mobile\.env guncellendi:"
Write-Host "  EXPO_PUBLIC_API_URL=$url"
