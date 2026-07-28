import { Platform } from "react-native";

/**
 * Fiziksel cihazda bilgisayarın IP’sini kullanın; Android emülatörde 10.0.2.2.
 * Web ortamında otomatik olarak localhost veya o anki hostname kullanılır.
 */
let apiUrl = "";

apiUrl = "https://sportarea.onrender.com/api";

export const API_URL = apiUrl;
