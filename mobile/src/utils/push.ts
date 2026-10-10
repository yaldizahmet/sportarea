import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from './api';
import { API_URL } from '../config/api';

const STORAGE_KEY = 'pushToken';

// Uygulama açıkken gelen bildirim de üstte görünsün.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Bildirim kaydının sonucu: başarılıysa token, değilse hangi adımda takıldığı (Profil'deki testte gösterilir).
export type PushSetup = { ok: true; token: string } | { ok: false; step: string; message: string; canOpenSettings?: boolean };

// Bildirim iznini ister, Expo push token'ını alır ve sunucuya kaydeder.
// Web'de ve emülatörde push çalışmaz. Android'de Firebase (google-services.json) içeren bir build gerekir.
export async function setupPush(): Promise<PushSetup> {
  if (Platform.OS === 'web') return { ok: false, step: 'web', message: 'Tarayıcıda bildirim yok. Telefona kurulan uygulamada çalışır.' };
  if (!Device.isDevice) return { ok: false, step: 'device', message: 'Emülatörde bildirim çalışmaz, gerçek telefonda dene.' };

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Maç bildirimleri',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#00E676',
      });
    }

    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted' && current.canAskAgain) {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') {
      return {
        ok: false, step: 'permission', canOpenSettings: true,
        message: 'Bildirim izni kapalı. Telefonun Ayarlar → Uygulamalar → SporArea → Bildirimler kısmından açman gerekiyor.',
      };
    }
  } catch (e: any) {
    return { ok: false, step: 'permission', message: `Bildirim izni alınamadı: ${String(e?.message ?? e).slice(0, 160)}` };
  }

  let token: string | undefined;
  try {
    const projectId =
      (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
    if (!projectId) return { ok: false, step: 'project', message: 'Uygulamada Expo proje kimliği yok (app.json → extra.eas.projectId).' };
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const firebase = /firebase|FirebaseApp|FCM|google-services|SERVICE_NOT_AVAILABLE/i.test(msg);
    return {
      ok: false, step: 'token',
      message: firebase
        ? `Telefon bildirim kimliği alınamadı: bu build'de Firebase ayarı (google-services.json) yok gibi görünüyor.\n\n(${msg.slice(0, 160)})`
        : `Telefon bildirim kimliği alınamadı: ${msg.slice(0, 200)}`,
    };
  }
  if (!token) return { ok: false, step: 'token', message: 'Telefon bildirim kimliği boş döndü.' };

  try {
    const res = await apiFetch(`${API_URL}/push-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, platform: Platform.OS }),
    });
    if (!res.ok) return { ok: false, step: 'server', message: `Sunucu cihazı kaydetmedi (HTTP ${res.status}).` };
  } catch (e: any) {
    return { ok: false, step: 'server', message: 'Sunucuya ulaşılamadı, internet bağlantını kontrol et.' };
  }
  await AsyncStorage.setItem(STORAGE_KEY, token).catch(() => {});
  return { ok: true, token };
}

// Uygulama açılışında sessizce çağrılır.
export async function registerForPush(): Promise<string | null> {
  const r = await setupPush();
  if (!r.ok) console.log('Push kaydı yapılamadı:', r.step, r.message);
  return r.ok ? r.token : null;
}

// Expo'nun gönderim hatalarını anlaşılır hâle getirir.
export function explainPushError(code: string) {
  if (/InvalidCredentials/i.test(code)) return 'Expo\'da Firebase gönderim anahtarı (FCM V1) yüklü değil. `npx eas credentials -p android` ile servis hesabı JSON\'unu yükle.';
  if (/MismatchSenderId/i.test(code)) return 'Uygulamadaki google-services.json ile Expo\'ya yüklenen FCM anahtarı farklı Firebase projelerine ait.';
  if (/DeviceNotRegistered/i.test(code)) return 'Bu cihaz kaydı artık geçersiz (uygulama silinip kurulmuş olabilir). Testi bir daha çalıştır.';
  if (/MessageRateExceeded/i.test(code)) return 'Çok sık bildirim gönderildi, biraz bekleyip tekrar dene.';
  return code;
}

// Çıkış yaparken: bu telefona bu hesabın bildirimleri artık gelmesin.
export async function unregisterPush() {
  try {
    const token = await AsyncStorage.getItem(STORAGE_KEY);
    if (!token) return;
    await apiFetch(`${API_URL}/push-token`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (e) {}
}

// Bildirime dokununca ilgili maçı açmak için: bildirimdeki matchId'yi döndürür.
export function matchIdFromResponse(response: Notifications.NotificationResponse | null | undefined): string | null {
  const id = (response?.notification?.request?.content?.data as any)?.matchId;
  return typeof id === 'string' ? id : null;
}
