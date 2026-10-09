import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Avatar from './Avatar';
import { displayName } from '../utils/format';

// Takımları saha şeması üzerinde gösterir. Üst yarı A takımı (kalesi yukarıda), alt yarı B takımı.
// Oyuncular mevkisine göre sıralara dizilir: kaleci, defans, orta saha, forvet.
// Bir sırada 4'ten fazla kişi varsa sıra ikiye bölünür, isimler üst üste binmesin.

const W = 320;
const H = 480;
const HALF = H / 2;
const MARKER = 34;
const MAX_PER_ROW = 4;

const role = (p: any) => {
  const pos = String(p.position || '').toLowerCase();
  if (pos.includes('kaleci')) return 0;
  if (pos.includes('defans') || pos.includes('stoper') || pos.includes('bek')) return 1;
  if (pos.includes('forvet') || pos.includes('santrafor') || pos.includes('kanat')) return 3;
  return 2; // orta saha ve mevkisi belli olmayanlar
};

function layoutTeam(team: any[], top: boolean) {
  const groups: any[][] = [[], [], [], []];
  team.forEach((p) => groups[role(p)].push(p));
  const rows: any[][] = [];
  groups.forEach((g) => {
    for (let i = 0; i < g.length; i += MAX_PER_ROW) rows.push(g.slice(i, i + MAX_PER_ROW));
  });
  const coords: { p: any; x: number; y: number }[] = [];
  if (!rows.length) return coords;
  // Kale çizgisinden orta çizgiye doğru: ilk sıra kaleye yakın, son sıra orta sahaya yakın.
  const first = 34;
  const last = HALF - 40;
  rows.forEach((row, ri) => {
    const t = rows.length === 1 ? 0.5 : ri / (rows.length - 1);
    const fromGoal = first + t * (last - first);
    const y = top ? fromGoal : H - fromGoal;
    row.forEach((p, i) => coords.push({ p, x: (W * (i + 1)) / (row.length + 1), y }));
  });
  return coords;
}

type Props = {
  teamA: any[];
  teamB: any[];
  nameA: string;
  nameB: string;
  meId?: string;
  onPressPlayer?: (p: any) => void;
};

export default function PitchView({ teamA, teamB, nameA, nameB, meId, onPressPlayer }: Props) {
  const markers = [
    ...layoutTeam(teamA, true).map((m) => ({ ...m, color: '#2196F3' })),
    ...layoutTeam(teamB, false).map((m) => ({ ...m, color: '#F44336' })),
  ];
  return (
    <View style={styles.wrap}>
      <View style={styles.pitch}>
        {/* çim bantları */}
        {Array.from({ length: 8 }).map((_, i) => (
          <View key={i} style={[styles.stripe, { top: (H / 8) * i, backgroundColor: i % 2 ? '#1F7A3A' : '#23863F' }]} />
        ))}
        {/* çizgiler */}
        <View style={styles.border} />
        <View style={styles.centerLine} />
        <View style={styles.centerCircle} />
        <View style={styles.centerDot} />
        <View style={[styles.box, { top: 0, borderTopWidth: 0 }]} />
        <View style={[styles.box, { bottom: 0, borderBottomWidth: 0 }]} />
        <View style={[styles.goal, { top: -4 }]} />
        <View style={[styles.goal, { bottom: -4 }]} />

        <Text style={[styles.teamLabel, { top: 6, color: '#BFDBFE' }]} numberOfLines={1}>🔵 {nameA} · {teamA.length}</Text>
        <Text style={[styles.teamLabel, { bottom: 6, color: '#FECACA' }]} numberOfLines={1}>🔴 {nameB} · {teamB.length}</Text>

        {markers.map(({ p, x, y, color }) => {
          const me = p.id === meId;
          const Wrapper: any = onPressPlayer ? TouchableOpacity : View;
          return (
            <Wrapper
              key={p.id}
              onPress={onPressPlayer ? () => onPressPlayer(p) : undefined}
              style={[styles.marker, { left: x - 40, top: y - MARKER / 2 }]}
              activeOpacity={0.8}
            >
              <View style={[styles.ring, { borderColor: me ? '#FACC15' : color, backgroundColor: color }]}>
                <Avatar user={p} size={MARKER - 4} initialColor="#FFFFFF" />
              </View>
              <View style={[styles.nameTag, me && { backgroundColor: '#FACC15' }]}>
                <Text style={[styles.nameText, me && { color: '#0F172A' }]} numberOfLines={1}>
                  {me ? 'Sen' : displayName(p)}
                </Text>
              </View>
            </Wrapper>
          );
        })}
      </View>
    </View>
  );
}

const LINE = 'rgba(255,255,255,0.75)';
const styles = StyleSheet.create({
  wrap: { alignItems: 'center', marginBottom: 16 },
  pitch: { width: W, height: H, borderRadius: 16, overflow: 'hidden', backgroundColor: '#23863F' },
  stripe: { position: 'absolute', left: 0, right: 0, height: H / 8 },
  border: { position: 'absolute', left: 8, right: 8, top: 8, bottom: 8, borderWidth: 2, borderColor: LINE, borderRadius: 4 },
  centerLine: { position: 'absolute', left: 8, right: 8, top: HALF - 1, height: 2, backgroundColor: LINE },
  centerCircle: { position: 'absolute', left: W / 2 - 40, top: HALF - 40, width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: LINE },
  centerDot: { position: 'absolute', left: W / 2 - 3, top: HALF - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: LINE },
  box: { position: 'absolute', left: W / 2 - 70, width: 140, height: 56, borderWidth: 2, borderColor: LINE },
  goal: { position: 'absolute', left: W / 2 - 30, width: 60, height: 12, borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: 'rgba(255,255,255,0.15)' },
  teamLabel: { position: 'absolute', left: 16, right: 16, fontSize: 11, fontWeight: 'bold', textAlign: 'left' },
  marker: { position: 'absolute', width: 80, alignItems: 'center' },
  ring: { width: MARKER, height: MARKER, borderRadius: MARKER / 2, borderWidth: 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  nameTag: { marginTop: 2, backgroundColor: 'rgba(15, 23, 42, 0.85)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, maxWidth: 78 },
  nameText: { color: '#F8FAFC', fontSize: 10, fontWeight: 'bold' },
});
