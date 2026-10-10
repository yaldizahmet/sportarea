import { db } from './db';

// Expo'nun ücretsiz push servisi. Testlerde sahte bir sunucuya yönlendirmek için değiştirilebilir.
const EXPO_PUSH_URL = process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';

export type PushMessage = {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

const isExpoToken = (t: string) => /^(Exponent|Expo)PushToken\[.+\]$/.test(t);

// Kullanıcıların telefonlarına bildirim gönderir. Hata olsa bile asıl isteği bozmaz:
// her zaman sessizce döner, sorunları sadece loglar.
export async function sendPush(messages: PushMessage[]): Promise<{ sent: number; errors: string[] }> {
  try {
    if (messages.length === 0) return { sent: 0, errors: [] };
    const userIds = [...new Set(messages.map((m) => m.userId))];
    const rows = await db.all<{ token: string; userId: string }>(
      'SELECT token, "userId" FROM "PushTokens" WHERE "userId" = ANY(?)',
      [userIds]
    );
    const tokensByUser = new Map<string, string[]>();
    for (const r of rows) {
      if (!isExpoToken(r.token)) continue;
      tokensByUser.set(r.userId, [...(tokensByUser.get(r.userId) ?? []), r.token]);
    }

    const outgoing: { to: string; title: string; body: string; data?: any; sound: 'default'; channelId: string; priority: 'high' }[] = [];
    for (const m of messages) {
      for (const to of tokensByUser.get(m.userId) ?? []) {
        outgoing.push({ to, title: m.title, body: m.body, data: m.data, sound: 'default', channelId: 'default', priority: 'high' });
      }
    }
    if (outgoing.length === 0) return { sent: 0, errors: [] };

    let sent = 0;
    const errors: string[] = [];
    // Expo tek istekte en fazla 100 mesaj kabul ediyor.
    for (let i = 0; i < outgoing.length; i += 100) {
      const chunk = outgoing.slice(i, i + 100);
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(chunk),
      });
      const json: any = await res.json().catch(() => null);
      const tickets: any[] = Array.isArray(json?.data) ? json.data : [];

      // Uygulamayı silen ya da bildirim iznini kapatan cihazların token'ını temizle.
      const dead: string[] = [];
      tickets.forEach((t, idx) => {
        if (t?.status === 'ok') sent++;
        else {
          errors.push(String(t?.details?.error || t?.message || 'bilinmeyen hata'));
          if (t?.details?.error === 'DeviceNotRegistered' && chunk[idx]) dead.push(chunk[idx].to);
        }
      });
      if (dead.length) await db.run('DELETE FROM "PushTokens" WHERE token = ANY(?)', [dead]);
      if (!res.ok) {
        console.error('Expo push HTTP', res.status, JSON.stringify(json)?.slice(0, 300));
        errors.push(`HTTP ${res.status}: ${String(json?.errors?.[0]?.message ?? '').slice(0, 120)}`);
      }
    }
    if (errors.length) console.error('Expo push ticket errors:', errors.slice(0, 5).join(', '));
    return { sent, errors };
  } catch (err) {
    console.error('Push send error:', err);
    return { sent: 0, errors: [String((err as any)?.message ?? err)] };
  }
}

// İsteği bekletmeden arka planda gönder.
export const sendPushInBackground = (messages: PushMessage[]) => {
  if (messages.length) void sendPush(messages);
};
