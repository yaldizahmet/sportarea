// Maça özel saha dizilimi. Hem saha görünümü hem liste görünümü bunu kullanır.
//
// Diziliş kaleci hariç yazılır: "2-2-1" = 2 defans, 2 orta saha, 1 forvet (+ kaleci).
// Slot numaraları: 0 = kaleci, sonra defanstan forvete, her sırada soldan sağa.

export type Role = 'GK' | 'DEF' | 'MID' | 'FWD';
export const ROLE_LABEL: Record<Role, string> = { GK: '🧤 Kaleci', DEF: 'Defans', MID: 'Orta saha', FWD: 'Forvet' };

// Takımdaki kişi sayısına göre önerilen dizilişler (ilki varsayılan).
const OPTIONS: Record<number, string[]> = {
  1: ['1'],
  2: ['1-1', '2'],
  3: ['1-1-1', '2-1', '1-2'],
  4: ['2-1-1', '1-2-1', '2-2'],
  5: ['2-2-1', '2-1-2', '3-1-1', '1-2-2'],
  6: ['2-3-1', '3-2-1', '2-2-2', '3-1-2'],
  7: ['3-3-1', '3-2-2', '2-3-2', '3-1-3'],
  8: ['3-3-2', '3-4-1', '4-3-1'],
  9: ['3-4-2', '4-4-1', '4-3-2'],
  10: ['4-4-2', '4-3-3', '3-5-2'],
};

// Kaleci hariç oyuncu sayısı için diziliş seçenekleri. Listede yoksa dengeli bir tane üretilir.
export function formationOptions(teamSize: number): string[] {
  const outfield = teamSize - 1;
  if (outfield <= 0) return [];
  if (OPTIONS[outfield]) return OPTIONS[outfield];
  const d = Math.ceil(outfield / 3);
  const f = Math.max(1, Math.floor(outfield / 4));
  return [`${d}-${outfield - d - f}-${f}`];
}

export const parseFormation = (f?: string | null) =>
  String(f ?? '').split('-').map((x) => parseInt(x, 10)).filter((n) => n > 0);

const fits = (f: string | null | undefined, teamSize: number) => {
  const rows = parseFormation(f);
  return rows.length > 0 && rows.reduce((a, b) => a + b, 0) === teamSize - 1;
};

// Takım için geçerli diziliş: kayıtlı olan takım sayısına uyuyorsa o, değilse önerilen ilk seçenek.
export function effectiveFormation(teamSize: number, stored?: string | null): string {
  if (teamSize <= 1) return '';
  return fits(stored, teamSize) ? String(stored) : formationOptions(teamSize)[0];
}

// Diziliş satırlarının rolleri: 1 satır orta saha; 2 satır defans + forvet; 3+ satır defans, orta(lar), forvet.
function rowRoles(rowCount: number): Role[] {
  if (rowCount === 1) return ['MID'];
  if (rowCount === 2) return ['DEF', 'FWD'];
  return Array.from({ length: rowCount }, (_, i) => (i === 0 ? 'DEF' : i === rowCount - 1 ? 'FWD' : 'MID'));
}

// slot -> rol ve (satır, sıradaki konum)
export function slotLayout(formation: string, teamSize: number) {
  const rows = parseFormation(formation);
  const roles = rowRoles(rows.length);
  const slots: { slot: number; role: Role; row: number; col: number; rowSize: number }[] = [];
  if (teamSize >= 1) slots.push({ slot: 0, role: 'GK', row: -1, col: 0, rowSize: 1 });
  let n = 1;
  rows.forEach((size, r) => {
    for (let c = 0; c < size; c++) slots.push({ slot: n++, role: roles[r], row: r, col: c, rowSize: size });
  });
  return { rows, slots };
}

// Profildeki mevkiden tahmini rol (kayıtlı diziliş yoksa yerleştirmek için).
export function profileRole(p: any): Role {
  const pos = String(p?.position || '').toLowerCase();
  if (pos.includes('kaleci')) return 'GK';
  if (pos.includes('defans') || pos.includes('stoper') || pos.includes('bek')) return 'DEF';
  if (pos.includes('forvet') || pos.includes('santrafor') || pos.includes('kanat')) return 'FWD';
  return 'MID';
}

// Takımdaki her oyuncuya bir slot verir. Kayıtlı (geçerli, çakışmayan) slot korunur;
// kalanlar profildeki mevkiye uygun boş slotlara, sonra kalan boşluklara yerleşir.
export function computeLineup(team: any[], storedFormation?: string | null) {
  const formation = effectiveFormation(team.length, storedFormation);
  const { slots } = slotLayout(formation, team.length);
  const bySlot = new Map<number, any>();
  const rest: any[] = [];
  for (const p of team) {
    const s = p.slot;
    if (Number.isInteger(s) && s >= 0 && s < slots.length && !bySlot.has(s)) bySlot.set(s, p);
    else rest.push(p);
  }
  // 1. tur: mevkisi uyan boş slot
  for (const sl of slots) {
    if (bySlot.has(sl.slot)) continue;
    const i = rest.findIndex((p) => profileRole(p) === sl.role);
    if (i >= 0) bySlot.set(sl.slot, rest.splice(i, 1)[0]);
  }
  // 2. tur: kalan boşluklar (kaleciye en son, kalecisi olmayan takımda biri kaleye geçer)
  const order = [...slots.filter((s) => s.slot !== 0), ...slots.filter((s) => s.slot === 0)];
  for (const sl of order) {
    if (bySlot.has(sl.slot) || !rest.length) continue;
    bySlot.set(sl.slot, rest.shift());
  }
  const placed = slots
    .filter((sl) => bySlot.has(sl.slot))
    .map((sl) => ({ ...sl, player: bySlot.get(sl.slot) }));
  const roleOf = new Map<string, Role>(placed.map((x) => [x.player.id, x.role]));
  const slotOf = new Map<string, number>(placed.map((x) => [x.player.id, x.slot]));
  return { formation, placed, roleOf, slotOf };
}
