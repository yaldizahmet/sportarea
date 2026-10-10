import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, PanResponder, Animated, Platform } from 'react-native';
import Avatar from './Avatar';
import { displayName } from '../utils/format';
import { computeLineup, formationOptions } from '../utils/lineup';

// Takımları saha şeması üzerinde gösterir. Üst yarı A takımı (kalesi yukarıda), alt yarı B takımı.
// Oyuncular maça özel dizilime göre yerleşir (utils/lineup). Takımın kaptanı (kaptan yoksa yönetici)
// maç öncesi sadece kendi takımı için:
//  - diziliş seçer (2-2-1 gibi),
//  - bir oyuncuyu sürükleyip takım arkadaşının üstüne bırakarak yerlerini değiştirir
//    (ya da önce birine, sonra diğerine dokunur). Diğer herkes sadece görüntüler.

const W = 320;
const H = 500;
const HALF = H / 2;
const MARKER = 34;

type Team = 'A' | 'B';

// Slotun sahadaki koordinatı. A takımı yukarıdan aşağıya (kale -> orta çizgi), B tersi.
function slotXY(team: Team, row: number, rowCount: number, col: number, rowSize: number) {
  const fromGoal =
    row < 0 ? 36 : rowCount === 1 ? (100 + HALF - 34) / 2 : 100 + (row / (rowCount - 1)) * (HALF - 34 - 100);
  const y = team === 'A' ? fromGoal : H - fromGoal;
  const x = (W * (col + 1)) / (rowSize + 1);
  return { x, y };
}

type LineupChange = { team: Team; formation: string; slots: { userId: string; slot: number }[] };

type Props = {
  teamA: any[];
  teamB: any[];
  nameA: string;
  nameB: string;
  formationA?: string | null;
  formationB?: string | null;
  meId?: string;
  editableA?: boolean;
  editableB?: boolean;
  captainIds?: string[];
  viewerHint?: string;
  onPressPlayer?: (p: any) => void;
  onLineupChange?: (c: LineupChange) => void;
  onDragActive?: (active: boolean) => void;
};

export default function PitchView(props: Props) {
  const { teamA, teamB, nameA, nameB, formationA, formationB, meId, editableA, editableB, captainIds, viewerHint, onPressPlayer, onLineupChange, onDragActive } = props;
  const canEdit = (team: Team) => Boolean(team === 'A' ? editableA : editableB);
  const anyEditable = canEdit('A') || canEdit('B');
  const [selected, setSelected] = useState<string | null>(null);

  const lineA = useMemo(() => computeLineup(teamA, formationA), [teamA, formationA]);
  const lineB = useMemo(() => computeLineup(teamB, formationB), [teamB, formationB]);

  const markers = useMemo(() => {
    const out: { p: any; team: Team; slot: number; x: number; y: number }[] = [];
    ([['A', lineA], ['B', lineB]] as const).forEach(([team, line]) => {
      const rowCount = line.formation ? line.formation.split('-').length : 0;
      line.placed.forEach((s) => {
        const { x, y } = slotXY(team, s.row, rowCount, s.col, s.rowSize);
        out.push({ p: s.player, team, slot: s.slot, x, y });
      });
    });
    return out;
  }, [lineA, lineB]);

  const lineOf = (team: Team) => (team === 'A' ? lineA : lineB);

  // İki oyuncunun yerini değiştir ve takımın tüm dizilimini bildir.
  const swap = (team: Team, idA: string, idB: string) => {
    const line = lineOf(team);
    const slots = line.placed.map((s) => ({ userId: s.player.id as string, slot: s.slot }));
    const a = slots.find((s) => s.userId === idA);
    const b = slots.find((s) => s.userId === idB);
    if (!a || !b || a === b) return;
    [a.slot, b.slot] = [b.slot, a.slot];
    onLineupChange?.({ team, formation: line.formation, slots });
  };

  const changeFormation = (team: Team, formation: string) => {
    const line = lineOf(team);
    // Slot numaraları aynı kalır (0 kaleci, sonra defanstan forvete); sadece sıraların dağılımı değişir.
    const slots = line.placed.map((s) => ({ userId: s.player.id as string, slot: s.slot }));
    onLineupChange?.({ team, formation, slots });
  };

  const dropAt = (m: { p: any; team: Team }, x: number, y: number) => {
    let best: { id: string; d: number } | null = null;
    for (const o of markers) {
      if (o.team !== m.team || o.p.id === m.p.id) continue;
      const d = Math.hypot(o.x - x, o.y - y);
      if (!best || d < best.d) best = { id: o.p.id, d };
    }
    if (best && best.d < 46) swap(m.team, m.p.id, best.id);
  };

  const tap = (m: { p: any; team: Team }) => {
    if (!canEdit(m.team)) {
      onPressPlayer?.(m.p);
      return;
    }
    if (!selected) return setSelected(m.p.id);
    if (selected === m.p.id) return setSelected(null);
    const other = markers.find((o) => o.p.id === selected);
    if (other && other.team === m.team) swap(m.team, selected, m.p.id);
    setSelected(null);
  };

  return (
    <View style={styles.wrap}>
      {anyEditable ? (
        <View style={styles.formBox}>
          {([['A', teamA, lineA, nameA, '#60A5FA'], ['B', teamB, lineB, nameB, '#F87171']] as const).map(([team, list, line, name, color]) => {
            const opts = formationOptions(list.length);
            if (!canEdit(team) || opts.length < 2) return null;
            return (
              <View key={team} style={styles.formRow}>
                <Text style={[styles.formLabel, { color }]} numberOfLines={1}>{name}</Text>
                <View style={styles.formChips}>
                  {opts.map((f) => (
                    <TouchableOpacity key={f} onPress={() => changeFormation(team, f)} style={[styles.formChip, line.formation === f && styles.formChipOn]}>
                      <Text style={[styles.formChipText, line.formation === f && { color: '#0F172A' }]}>{f}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            );
          })}
          <Text style={styles.editHint}>
            Yer değiştirmek için oyuncuyu sürükleyip takım arkadaşının üstüne bırak ya da sırayla ikisine dokun. Diziliş kaleci hariçtir.
          </Text>
          {viewerHint ? <Text style={styles.editHint}>{viewerHint}</Text> : null}
        </View>
      ) : viewerHint ? (
        <Text style={[styles.editHint, { width: W, marginBottom: 8 }]}>{viewerHint}</Text>
      ) : null}

      <View style={styles.legend}>
        <Text style={[styles.legendText, { color: '#93C5FD' }]} numberOfLines={1}>
          🔵 {nameA} · {teamA.length}{lineA.formation ? ` · 1-${lineA.formation}` : ''}
        </Text>
        <Text style={[styles.legendText, { color: '#FCA5A5', textAlign: 'right' }]} numberOfLines={1}>
          🔴 {nameB} · {teamB.length}{lineB.formation ? ` · 1-${lineB.formation}` : ''}
        </Text>
      </View>
      <View style={styles.pitch}>
        {Array.from({ length: 8 }).map((_, i) => (
          <View key={i} style={[styles.stripe, { top: (H / 8) * i, backgroundColor: i % 2 ? '#1F7A3A' : '#23863F' }]} />
        ))}
        <View style={styles.border} />
        <View style={styles.centerLine} />
        <View style={styles.centerCircle} />
        <View style={styles.centerDot} />
        <View style={[styles.box, { top: 8, borderTopWidth: 0 }]} />
        <View style={[styles.box, { bottom: 8, borderBottomWidth: 0 }]} />
        <View style={[styles.goal, { top: -4 }]} />
        <View style={[styles.goal, { bottom: -4 }]} />


        {markers.map((m) => (
          <Marker
            key={m.p.id}
            m={m}
            color={m.team === 'A' ? '#2196F3' : '#F44336'}
            me={m.p.id === meId}
            selected={selected === m.p.id}
            captain={Boolean(captainIds?.includes(m.p.id))}
            editable={canEdit(m.team)}
            tappable={Boolean(canEdit(m.team) || onPressPlayer)}
            onTap={tap}
            onDrop={dropAt}
            onDragActive={onDragActive}
          />
        ))}
      </View>
    </View>
  );
}

type MarkerProps = {
  m: { p: any; team: Team; x: number; y: number };
  color: string;
  me: boolean;
  selected: boolean;
  captain: boolean;
  editable: boolean;
  tappable: boolean;
  onTap: (m: any) => void;
  onDrop: (m: any, x: number, y: number) => void;
  onDragActive?: (active: boolean) => void;
};

function Marker({ m, color, me, selected, captain, editable, tappable, onTap, onDrop, onDragActive }: MarkerProps) {
  const pan = useRef(new Animated.ValueXY()).current;
  const [dragging, setDragging] = useState(false);
  // PanResponder bir kez oluşur; güncel değerleri ref'ten okur.
  const latest = useRef({ m, editable, tappable, onTap, onDrop, onDragActive });
  latest.current = { m, editable, tappable, onTap, onDrop, onDragActive };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => latest.current.editable || latest.current.tappable,
        onMoveShouldSetPanResponder: (_e, g) => latest.current.editable && (Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          if (latest.current.editable) latest.current.onDragActive?.(true);
        },
        onPanResponderMove: (_e, g) => {
          if (!latest.current.editable) return;
          if (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4) setDragging(true);
          pan.setValue({ x: g.dx, y: g.dy });
        },
        onPanResponderRelease: (_e, g) => {
          const { m: cur, editable: ed, onTap: tapFn, onDrop: dropFn, onDragActive: dragFn } = latest.current;
          if (ed) dragFn?.(false);
          setDragging(false);
          pan.setValue({ x: 0, y: 0 });
          const moved = Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8;
          if (ed && moved) dropFn(cur, cur.x + g.dx, cur.y + g.dy);
          else tapFn(cur);
        },
        onPanResponderTerminate: () => {
          latest.current.onDragActive?.(false);
          setDragging(false);
          pan.setValue({ x: 0, y: 0 });
        },
      }),
    [pan]
  );

  const ringColor = selected ? '#FFFFFF' : me ? '#FACC15' : color;
  return (
    <Animated.View
      {...(tappable ? responder.panHandlers : {})}
      style={[
        styles.marker,
        { left: m.x - 40, top: m.y - MARKER / 2, zIndex: dragging ? 10 : 1, transform: pan.getTranslateTransform() },
        Platform.OS === 'web' && editable ? ({ touchAction: 'none', cursor: 'grab', userSelect: 'none' } as any) : null,
      ]}
    >
      <View style={[styles.ring, { borderColor: ringColor, backgroundColor: color }, (selected || dragging) && { transform: [{ scale: 1.15 }] }]}>
        <Avatar user={m.p} size={MARKER - 4} initialColor="#FFFFFF" />
      </View>
      {captain ? (
        <View style={styles.capBadge}><Text style={styles.capText}>K</Text></View>
      ) : null}
      <View style={[styles.nameTag, me && { backgroundColor: '#FACC15' }]}>
        <Text style={[styles.nameText, me && { color: '#0F172A' }]} numberOfLines={1}>
          {me ? 'Sen' : displayName(m.p)}
        </Text>
      </View>
    </Animated.View>
  );
}

const LINE = 'rgba(255,255,255,0.75)';
const styles = StyleSheet.create({
  wrap: { alignItems: 'center', marginBottom: 16 },
  formBox: { width: W, marginBottom: 10 },
  formRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  formLabel: { width: 86, fontWeight: 'bold', fontSize: 13 },
  formChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1 },
  formChip: { borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 10, paddingVertical: 5 },
  formChipOn: { backgroundColor: '#00E676', borderColor: '#00E676' },
  formChipText: { color: '#E2E8F0', fontWeight: '600', fontSize: 13 },
  editHint: { color: '#64748B', fontSize: 12, marginTop: 4, lineHeight: 16 },
  pitch: { width: W, height: H, borderRadius: 16, overflow: 'hidden', backgroundColor: '#23863F' },
  stripe: { position: 'absolute', left: 0, right: 0, height: H / 8 },
  border: { position: 'absolute', left: 8, right: 8, top: 8, bottom: 8, borderWidth: 2, borderColor: LINE, borderRadius: 4 },
  centerLine: { position: 'absolute', left: 8, right: 8, top: HALF - 1, height: 2, backgroundColor: LINE },
  centerCircle: { position: 'absolute', left: W / 2 - 40, top: HALF - 40, width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: LINE },
  centerDot: { position: 'absolute', left: W / 2 - 3, top: HALF - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: LINE },
  box: { position: 'absolute', left: W / 2 - 70, width: 140, height: 58, borderWidth: 2, borderColor: LINE },
  goal: { position: 'absolute', left: W / 2 - 30, width: 60, height: 12, borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: 'rgba(255,255,255,0.15)' },
  legend: { width: W, flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6, gap: 8 },
  legendText: { flex: 1, fontSize: 12, fontWeight: 'bold' },
  marker: { position: 'absolute', width: 80, alignItems: 'center' },
  ring: { width: MARKER, height: MARKER, borderRadius: MARKER / 2, borderWidth: 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  capBadge: { position: 'absolute', top: -4, left: 46, width: 16, height: 16, borderRadius: 8, backgroundColor: '#FACC15', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#0F172A' },
  capText: { color: '#0F172A', fontSize: 10, fontWeight: '900' },
  nameTag: { marginTop: 2, backgroundColor: 'rgba(15, 23, 42, 0.85)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, maxWidth: 78 },
  nameText: { color: '#F8FAFC', fontSize: 10, fontWeight: 'bold' },
});
