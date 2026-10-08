# SporArea · Google Play hazırlık dosyası

Bu klasördeki her şey Play Console'a yapıştırılmak / yüklenmek için hazır.

```
store/
  MAGAZA.md                 ← bu dosya (metinler + adımlar)
  gorseller/ikon-512.png     ← Uygulama simgesi (512x512)
  gorseller/tanitim-1024x500.png ← Öne çıkan görsel (feature graphic)
  gorseller/ekran-1..5.png   ← Telefon ekran görüntüleri (1080x2160)
```

---

## 1. Mağaza kaydı (Ana mağaza girişi)

**Uygulama adı** (en fazla 30 karakter)

```
SporArea: Halı Saha Takımı
```

**Kısa açıklama** (en fazla 80 karakter)

```
Haftalık halı saha maçını kur: kim var, kim yok, takımlar ve skor tek yerde.
```

**Tam açıklama** (en fazla 4000 karakter)

```
Her hafta aynı hikâye: grupta anket açılıyor, yarısı işaretliyor, yarısı "bakarız" diyor, maç günü 9 kişi kalıyorsunuz. SporArea bu işi senin yerine takip eder.

⚽ HAFTALIK MAÇ KENDİLİĞİNDEN AÇILIR
Grubunun maç gününü, saatini ve sahasını bir kez gir. Her hafta yeni maç otomatik açılır, herkese bildirim gider. Kimsenin anket açmasına gerek kalmaz.

✅ VARIM · BELKİ · YOKUM
Tek dokunuşla cevap ver. Kadro dolunca sonra gelenler yedeğe yazılır; biri "Yokum" derse sıradaki yedek otomatik kadroya girer ve haberdar edilir.

🔁 "HER HAFTA VARIM"
Düzenli gelenler bu ayarı açar, her hafta kadroya kendiliğinden eklenir. Gelemeyeceği hafta "Yokum" demesi yeterli.

🔒 SON DEĞİŞİKLİK SAATİ
Maçtan kaç saat önce kadronun kilitleneceğini sen belirle. Son dakika kaçışları biter.

⚖️ DENGELİ TAKIMLAR
Mevkilere ve oyuncu puanlarına göre takım önerisi al, istersen elle düzenle.

💸 SAHA ÜCRETİ HESABI
Saha ücretini gir, kişi başı pay kadroya göre otomatik hesaplansın. Kimin ödediğini işaretle, kimse unutmasın. (Uygulama içinden para alınmaz; sadece takip içindir.)

🏆 SKOR, GOLLER VE MAÇIN YILDIZI
Maç bitince skoru ve golleri gir. Oyuncular maçın yıldızını (MVP) seçer, birbirlerini hız, şut, pas ve fizik üzerinden puanlar.

📊 LİDERLİK TABLOSU
Grubun içinde puan, gol, MVP ve maç sayısına göre sıralama. Haftalık rekabet tadında.

🔔 HATIRLATMALAR
Maç açıldığında, kadroya girdiğinde, yedekten asile geçtiğinde ve maçtan önce bildirim alırsın.

🌦️ HAVA DURUMU VE YOL TARİFİ
Maç günü hava durumu ve sahaya tek dokunuşla yol tarifi.

👥 DAVET LİNKİ İLE KATILIM
Grubunu kur, davet linkini paylaş, arkadaşların tek dokunuşla katılsın.

Reklam yok. Verilerin satılmaz. Hesabını istediğin an tüm verilerinle birlikte silebilirsin.
```

**Kategori:** Spor
**Etiketler (öneri):** Spor, Futbol, Takım yönetimi
**E-posta (zorunlu, mağazada görünür):** Play Console'da geliştirici iletişim e-postası olarak hangi adresi göstermek istiyorsan
**Web sitesi:** https://sportarea.onrender.com
**Gizlilik politikası URL'si:** https://sportarea.onrender.com/gizlilik

**Grafikler**
- Uygulama simgesi → `gorseller/ikon-512.png`
- Öne çıkan görsel → `gorseller/tanitim-1024x500.png`
- Telefon ekran görüntüleri → `gorseller/ekran-1.png` … `ekran-5.png` (sırayla)
- Tablet ekran görüntüsü zorunlu değil; boş bırakılabilir.

---

## 2. Uygulama içeriği (Policy → App content)

### Gizlilik politikası
`https://sportarea.onrender.com/gizlilik`

### Uygulama erişimi (App access)
"Tüm işlevler özel erişim gerektiriyor" → **talimat ekle**:

- Ad: `Demo hesap`
- Kullanıcı adı: `demo@sporarea.app`
- Şifre: *(sana ayrıca iletildi; repo herkese açık olduğu için buraya yazılmadı)*
- Ek bilgi:
  ```
  Bu hesap "Demo Halı Saha" grubunun kurucusudur. Ana ekranda yaklaşan haftalık maç (Varım/Belki/Yokum), tamamlanmış bir maç (skor, MVP, puanlama, saha ücreti) ve grup ayarları (haftalık maç, davet linki) görülebilir. Hesap silme: Profil → Hesabımı Sil.
  ```

### Reklamlar
**Hayır**, uygulama reklam içermiyor.

### İçerik derecelendirmesi (IARC anketi)
- Kategori: **Diğer (Referans, Haber, Eğitim değil) / Sosyal, iletişim veya uygulama aracı** — "Utility, Productivity, Communication or Other" seç.
- Şiddet, cinsellik, küfür, uyuşturucu, kumar: **Hayır**
- Kullanıcılar birbiriyle etkileşebiliyor / içerik paylaşabiliyor mu? **Evet** (grup içinde isim, fotoğraf, puan görünür)
- Kullanıcının konumunu başka kullanıcılarla paylaşıyor mu? **Hayır**
- Dijital ürün satın alma? **Hayır**
→ Beklenen sonuç: 3+ / PEGI 3 civarı, "Kullanıcılar etkileşir" etiketiyle.

### Hedef kitle
- Yaş grubu: **18 ve üzeri** (önerilen; çocuk/aile politikalarına girmemek için en sade yol).
  İstersen **16-17**'yi de işaretleyebilirsin. 13 altını işaretleme.
- Uygulama çocukların ilgisini çekecek şekilde mi? **Hayır**

### Haber uygulaması
**Hayır**

### Sağlık uygulaması / finans / devlet
Hepsi **Hayır**. (Saha ücreti sadece not tutar, para işlemi yok.)

### Veri güvenliği (Data safety)

Genel sorular:
| Soru | Cevap |
|---|---|
| Uygulama gerekli kullanıcı veri türlerini topluyor veya paylaşıyor mu? | **Evet** |
| Tüm kullanıcı verileri aktarım sırasında şifreleniyor mu? | **Evet** (HTTPS) |
| Kullanıcılar verilerinin silinmesini isteyebilir mi? | **Evet** |
| Hesap silme URL'si | `https://sportarea.onrender.com/hesap-sil` |

Toplanan veri türleri (hiçbiri "paylaşılıyor" değil — hizmet sağlayıcılara aktarım paylaşım sayılmaz):

| Kategori → Tür | Toplanıyor | Zorunlu mu | Amaç |
|---|---|---|---|
| Kişisel bilgiler → **Ad** | Evet | Zorunlu | Uygulama işlevselliği, Hesap yönetimi |
| Kişisel bilgiler → **E-posta adresi** | Evet | Zorunlu | Hesap yönetimi |
| Kişisel bilgiler → **Kullanıcı kimlikleri** | Evet | Zorunlu | Uygulama işlevselliği, Hesap yönetimi |
| Fotoğraflar ve videolar → **Fotoğraflar** | Evet | **İsteğe bağlı** | Uygulama işlevselliği (profil fotoğrafı) |
| Uygulama etkinliği → **Diğer kullanıcı tarafından oluşturulan içerik** | Evet | Zorunlu | Uygulama işlevselliği (maç cevapları, skor, puanlar, MVP oyları) |
| Uygulama etkinliği → **Uygulama içi işlemler** | Evet | Zorunlu | Uygulama işlevselliği |
| Cihaz veya diğer kimlikler → **Cihaz veya diğer kimlikler** | Evet | İsteğe bağlı (bildirim izni) | Uygulama işlevselliği (anlık bildirim) |

Toplanmayanlar: konum, finansal bilgi, rehber, mesajlar, ses, sağlık, tarama geçmişi, reklam kimliği, kilitlenme kayıtları.

Her tür için: "Veriler geçici olarak mı işleniyor?" → **Hayır**.

---

## 3. Android'de bildirimlerin çalışması için Firebase (bir kerelik, ~10 dk)

Mağazadan yüklenen sürümde push bildirimleri için Google'ın FCM servisi gerekiyor. Ücretsiz.

1. https://console.firebase.google.com → **Proje ekle** → ad: `SporArea` (Analytics'i kapatabilirsin).
2. Proje ana sayfasında **Android** simgesi → paket adı: `com.sporarea.app` → **Uygulamayı kaydet**.
3. **google-services.json** dosyasını indir. (Repoya koyma; `.gitignore` zaten engelliyor.)
4. Dosyayı EAS'e gizli dosya olarak yükle (proje klasöründe, `mobile` içinde):
   ```
   npx eas env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment production --environment preview --visibility secret
   ```
5. FCM V1 anahtarı: Firebase → ⚙️ Proje ayarları → **Hizmet hesapları** → **Yeni özel anahtar oluştur** → JSON iner.
6. Bu JSON'u Expo'ya ver:
   ```
   npx eas credentials -p android
   ```
   → `production` → **Google Service Account** → **Manage your Google Service Account Key for Push Notifications (FCM V1)** → **Upload** → indirdiğin JSON'u seç.

Bundan sonra alınan her build bildirimleri alır.

---

## 4. Play Console adımları

1. **Geliştirici hesabı:** https://play.google.com/console → kişisel hesap, 25 $ tek seferlik. Kimlik doğrulaması 1-2 gün sürebilir.
2. **Uygulama oluştur:** ad `SporArea`, dil Türkçe, Uygulama, Ücretsiz.
3. **Build al** (`mobile` klasöründe):
   ```
   npx eas build -p android --profile production
   ```
   Sonunda `.aab` dosyasının linki çıkar, indir.
4. **Uygulama içeriği** bölümündeki her maddeyi yukarıdaki 2. başlıktaki cevaplarla doldur.
5. **Mağaza kaydı**nı 1. başlıktaki metin ve görsellerle doldur.
6. **Kapalı test (zorunlu):** Yeni kişisel hesaplarda üretime çıkmadan önce
   **en az 12 test kullanıcısının 14 gün boyunca** kapalı teste katılmış olması gerekiyor.
   - Test → Kapalı test → yeni kanal → `.aab`'yi yükle.
   - Test kullanıcıları: halı saha grubundaki arkadaşlarının Gmail adreslerini bir e-posta listesine ekle (12+ kişi).
   - Katılım linkini WhatsApp grubuna at; herkes linke girip "test kullanıcısı ol" der ve Play'den yükler.
   - 14 gün boyunca uygulamayı gerçekten kullanmaları önemli (zaten her hafta maç var 🙂).
7. 14 gün dolunca **Üretim erişimi için başvur** → birkaç soru (test nasıl geçti vb.) → onay genelde 1-7 gün.
8. Onaydan sonra **Üretim → Yeni sürüm** → aynı (ya da yeni) `.aab` → yayınla.

### Sonraki güncellemeler
```
npx eas build -p android --profile production
```
Sürüm numarası otomatik artar (eas.json → autoIncrement). Çıkan `.aab`'yi Play Console'da yeni sürüme yükle.
Sadece sunucu/web değişikliği varsa build gerekmez; Render kendisi günceller.

---

## Notlar
- Paket adı `com.sporarea.app` — bir kez yayınlandıktan sonra değiştirilemez.
- Daha önce APK ile kurulu eski sürüm (`com.thend.sporarea`) telefonda ayrı uygulama olarak durur; Play sürümünü kurunca eskisini silebilirsin.
- Demo hesap ve "Demo Halı Saha" grubu canlı veritabanında duruyor; incelemeciler için silme.
