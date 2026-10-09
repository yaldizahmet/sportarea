// Maç tarih/saat gösterimi. Kaynak her zaman matchTimestamp (ms); eski kayıtlarda
// yoksa sunucudaki metin (match.date) gösterilir.

const DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const DAYS_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

export const DAY_NAMES = DAYS;
export const DAY_NAMES_SHORT = DAYS_SHORT;

const pad = (n: number) => String(n).padStart(2, '0');

// Gece yarısından sonra başlayan maçlar (00:00–05:59) bir önceki günün gecesi olarak yazılır:
// Perşembe 00:30 -> "Çarşamba gecesi · 00:30". Halı sahada insanlar böyle konuşuyor.
const displayDay = (d: Date) => {
  if (d.getHours() < 6) {
    const prev = new Date(d);
    prev.setDate(prev.getDate() - 1);
    return { day: prev, night: true };
  }
  return { day: d, night: false };
};

export function formatMatchDate(match: { matchTimestamp?: number | string | null; date?: string; time?: string }) {
  const ts = Number(match?.matchTimestamp);
  if (!ts) return [match?.date, match?.time].filter(Boolean).join(' • ') || 'Tarih belirtilmemiş';

  const d = new Date(ts);
  const { day, night } = displayDay(d);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(day) - startOf(today)) / 86400000);

  let dayLabel: string;
  if (diffDays === 0) dayLabel = 'Bugün';
  else if (diffDays === 1) dayLabel = 'Yarın';
  else dayLabel = `${DAYS_SHORT[day.getDay()]} ${day.getDate()} ${MONTHS_SHORT[day.getMonth()]}`;

  return `${dayLabel}${night ? ' gecesi' : ''} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Maç geçti mi? Saatinden 2 saat sonra "geçmiş" sayılır (maç sürüyor olabilir).
export function isPastMatch(match: { status?: string; matchTimestamp?: number | string | null }) {
  if (match?.status === 'COMPLETED') return true;
  const ts = Number(match?.matchTimestamp);
  return Boolean(ts) && ts + 2 * 3600 * 1000 < Date.now();
}

// Haftalık maç ayarının okunur hali: "Her Çarşamba 21:00" / "Her Çarşamba gecesi 00:30"
export function formatWeekly(day?: number | null, time?: string | null) {
  if (day === null || day === undefined || !time) return null;
  const h = Number(String(time).split(':')[0]);
  return `Her ${DAYS[day]}${h < 6 ? ' gecesi' : ''} ${time}`;
}

// Kısa saat etiketi: "Bugün 18:00", "Yarın 21:00", "Cmt 18:00"
export function formatClock(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(d) - startOf(today)) / 86400000);
  const day = diff === 0 ? 'Bugün' : diff === 1 ? 'Yarın' : DAYS_SHORT[d.getDay()];
  return `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Para: 1400 -> "1.400 ₺"
export function formatMoney(n?: number | null) {
  if (!n) return '';
  return `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}\u00A0₺`;
}

// Kişi başı saha payı (sunucudaki hesapla aynı: yukarı yuvarlanır)
export const shareOf = (fee?: number | null, players?: number) =>
  fee && players && players > 0 ? Math.ceil(fee / players) : null;

// Görünen ad: lakap varsa lakap, yoksa "Ahmet Y." (ad + soyadın baş harfi). Misafir adı yazıldığı gibi.
// Sunucudaki displayName (server/index.ts) ile aynı kural.
export function shortName(name?: string | null) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  const last = parts.pop() as string;
  return `${parts.join(' ')} ${last.charAt(0).toLocaleUpperCase('tr-TR')}.`;
}
export function displayName(p?: { name?: string | null; nickname?: string | null; isGuest?: boolean } | null) {
  if (!p) return '';
  if (p.isGuest) return String(p.name ?? '');
  const nick = String(p.nickname ?? '').trim();
  return nick || shortName(p.name);
}
// Lakabı olanın altında küçük yazıyla kim olduğu ("Ahmet Y."); lakabı yoksa boş.
export function realNameHint(p?: { name?: string | null; nickname?: string | null; isGuest?: boolean } | null) {
  if (!p || p.isGuest || !String(p.nickname ?? '').trim()) return '';
  return shortName(p.name);
}
