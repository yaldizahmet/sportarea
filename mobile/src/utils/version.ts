import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Uygulama sürümü app.json -> "version" alanından gelir. Yeni sürüm çıkarken orayı artır (1.1.0 -> 1.2.0).
export const APP_VERSION: string = Constants.expoConfig?.version ?? '';
export const versionLabel = () =>
  APP_VERSION ? `SporArea v${APP_VERSION}${Platform.OS === 'web' ? ' · web' : ''}` : '';
