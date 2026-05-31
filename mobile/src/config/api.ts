import { Platform } from "react-native";

/**
 * Fiziksel cihazda bilgisayarın IP’sini kullanın; Android emülatörde 10.0.2.2.
 * Web ortamında otomatik olarak localhost veya o anki hostname kullanılır.
 */
let apiUrl = "";

if (Platform.OS === 'web') {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  apiUrl = `http://${hostname}:3000/api`;
} else {
  const raw =
    typeof process !== "undefined" && process.env?.EXPO_PUBLIC_API_URL
      ? String(process.env.EXPO_PUBLIC_API_URL).trim()
      : "";
  const fallback =
    Platform.OS === "android" ? "http://10.0.2.2:3000/api" : "http://192.168.1.106:3000/api";
  apiUrl = raw || fallback;
}

export const API_URL = apiUrl;
