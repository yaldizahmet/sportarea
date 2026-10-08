// app.json'daki ayarları alır, Firebase dosyasını varsa ekler.
// Android'de push bildirimi için Google'ın Firebase dosyası (google-services.json) gerekir:
//  - Bilgisayarda: dosyayı mobile klasörüne koy (repoya eklenmez, .gitignore'da).
//  - EAS'ta: `npx eas env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json`
// Dosya yoksa uygulama yine derlenir, sadece Android'de push bildirimi gelmez.
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const local = path.join(__dirname, 'google-services.json');
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync(local) ? './google-services.json' : undefined);
  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
