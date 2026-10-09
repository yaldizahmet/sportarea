import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import webBuild from '../webBuild.json';

// Sürüm: app.json -> "version" (yeni özellik paketlerinde elle artırılır: 1.1.0 -> 1.2.0).
// Build numarası: her EAS build'inde otomatik artar (eas.json -> autoIncrement).
// Web'de build numarası yok; onun yerine `npm run build:web` sırasında yazılan tarih gösterilir.
export const APP_VERSION: string = Constants.expoConfig?.version ?? '';
export const BUILD_NUMBER: string | null = Platform.OS === 'web' ? null : Application.nativeBuildVersion ?? null;

export const versionLabel = () => {
  if (!APP_VERSION) return '';
  if (Platform.OS === 'web') return `SporArea v${APP_VERSION} · web${webBuild?.stamp ? ` ${webBuild.stamp}` : ''}`;
  return `SporArea v${APP_VERSION}${BUILD_NUMBER ? ` (${BUILD_NUMBER})` : ''}`;
};
