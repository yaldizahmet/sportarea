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

// Bildirim iznini ister, Expo push token'ını alır ve sunucuya kaydeder.
// Web'de, emülatörde ve Android Expo Go'da push çalışmaz; bu durumlarda sessizce geçer.
// (Android'de push için APK / geliştirme sürümü gerekiyor.)
export async function registerForPush(): Promise<string | null> {
  try {
    if (Platform.OS === 'web' || !Device.isDevice) return null;

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
    if (status !== 'granted') return null;

    const projectId =
      (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    if (!token) return null;

    await apiFetch(`${API_URL}/push-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, platform: Platform.OS }),
    });
    await AsyncStorage.setItem(STORAGE_KEY, token);
    return token;
  } catch (e) {
    console.log('Push kaydı yapılamadı:', e);
    return null;
  }
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
