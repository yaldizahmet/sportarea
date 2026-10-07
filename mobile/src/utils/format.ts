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
