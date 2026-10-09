// Web sürümü için build damgası: her `npm run build:web` çalıştığında tarih/saat yazılır.
// Uygulama giriş ekranında "v1.1.0 · web 09.10 13:40" olarak gösterir.
const fs = require('fs');
const path = require('path');
const now = new Date(Date.now() + 3 * 3600 * 1000); // Türkiye saati
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${pad(now.getUTCDate())}.${pad(now.getUTCMonth() + 1)} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
fs.writeFileSync(path.join(__dirname, '..', 'src', 'webBuild.json'), JSON.stringify({ stamp }) + '\n');
console.log('Web build damgası:', stamp);
