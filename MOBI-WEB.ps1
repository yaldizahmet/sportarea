# Tarayicide mobil arayuzu ac (Expo Web) + ayri pencerede sunucu
# Calistir: sag tik -> PowerShell ile calistir  VEYA:
#   cd ...\sporarea
#   powershell -ExecutionPolicy Bypass -File .\MOBI-WEB.ps1

$ErrorActionPreference = "Stop"
$root = (Resolve-Path $PSScriptRoot).Path

Write-Host "Klasor: $root"
Write-Host "Once kurulum: npm run install:all (kok klasorde)"
Write-Host ""

# Sunucu: yeni PowerShell penceresi
$serverCmd = "Set-Location `"$root`"; npm run server"
Start-Process powershell.exe -ArgumentList @("-NoExit", "-Command", $serverCmd) | Out-Null
Write-Host "Sunucu ayri pencerede acildi. 4 saniye bekleniyor..."
Start-Sleep -Seconds 4

# Expo Web (tarayici genelde otomatik acilir)
Set-Location "$root\mobile"
Write-Host "Expo Web baslatiliyor (Ctrl+C ile durdur)..."
npx expo start --web
