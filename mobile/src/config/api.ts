import { Platform } from "react-native";

// Canlı sunucu (Render). Telefon uygulaması (APK / Expo Go) her zaman buraya bağlanır.
const PRODUCTION_API = "https://sportarea.onrender.com/api";

// Web sürümü sunucunun kendisinden açıldığında (https://sportarea.onrender.com) aynı adresi kullanır.
// Expo'nun geliştirme sunucusunda (npm run web -> :8081 / :19006) yine canlı sunucuya bağlanır.
function resolveApiUrl() {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const { port, origin } = window.location;
    const isExpoDevServer = port === "8081" || port === "8082" || port === "19006";
    if (!isExpoDevServer) return `${origin}/api`;
  }
  return PRODUCTION_API;
}

export const API_URL = resolveApiUrl();
