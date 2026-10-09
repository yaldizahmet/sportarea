import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from './api';
import { API_URL } from '../config/api';

// Davet linki: https://sportarea.onrender.com/?davet=K7M2QX
// Link açılınca kod saklanır; kişi kayıt olur ya da giriş yapar yapmaz gruba otomatik eklenir.
const KEY = 'pendingInvite';
export const WEB_URL = 'https://sportarea.onrender.com';
export const inviteLink = (code: string) => `${WEB_URL}/?davet=${encodeURIComponent(code)}`;

// Uygulama açılırken bir kez çağrılır (web'de adres çubuğundaki ?davet= parametresini okur).
export async function captureInviteFromUrl(): Promise<string | null> {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    const url = new URL(window.location.href);
    const code = (url.searchParams.get('davet') || '').trim().toUpperCase();
    if (!code) return null;
    await AsyncStorage.setItem(KEY, code);
    // Adres çubuğunu temizle: sayfa yenilenince tekrar tetiklenmesin.
    url.searchParams.delete('davet');
    window.history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + url.hash);
    return code;
  } catch {
    return null;
  }
}

export const getPendingInvite = () => AsyncStorage.getItem(KEY);

// Giriş yapmadan grup adını göster: "Çarşamba Halı Saha grubuna davet edildin"
export async function previewInvite(code: string): Promise<{ name: string; memberCount: number } | null> {
  try {
    const res = await fetch(`${API_URL}/invite/${encodeURIComponent(code)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Bekleyen davet varsa gruba katıl. Katılınan grubu döndürür (yoksa null).
export async function consumePendingInvite(): Promise<{ group: any; alreadyMember: boolean } | null> {
  const code = await AsyncStorage.getItem(KEY);
  if (!code) return null;
  try {
    const res = await apiFetch(`${API_URL}/groups/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteCode: code }),
    });
    // Kod geçersizse de tekrar denemeyelim.
    await AsyncStorage.removeItem(KEY);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.group ? { group: data.group, alreadyMember: Boolean(data.alreadyMember) } : null;
  } catch {
    return null; // ağ hatası: kod saklı kalır, sonraki açılışta tekrar denenir
  }
}

// Maç linki: https://sportarea.onrender.com/?mac=<id>
// Kadro paylaşımında kullanılır; açan kişi (giriş yaptıktan sonra) doğrudan o maçın sayfasına gider.
const MATCH_KEY = 'pendingMatch';
export const matchLink = (id: string) => `${WEB_URL}/?mac=${encodeURIComponent(id)}`;

export async function captureMatchFromUrl(): Promise<string | null> {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    const url = new URL(window.location.href);
    const id = (url.searchParams.get('mac') || '').trim();
    if (!id) return null;
    await AsyncStorage.setItem(MATCH_KEY, id);
    url.searchParams.delete('mac');
    window.history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + url.hash);
    return id;
  } catch {
    return null;
  }
}

export async function consumePendingMatch(): Promise<string | null> {
  const id = await AsyncStorage.getItem(MATCH_KEY);
  if (id) await AsyncStorage.removeItem(MATCH_KEY);
  return id;
}
