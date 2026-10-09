import { apiFetch } from '../utils/api';
import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { API_URL } from '../config/api';
import Avatar from "../components/Avatar";
import { displayName, realNameHint } from "../utils/format";

type SortKey = 'score' | 'goals' | 'matches' | 'mvp';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'score', label: '🌟 Puan' },
  { key: 'goals', label: '⚽ Gol' },
  { key: 'mvp', label: '🏆 MVP' },
  { key: 'matches', label: '🏟️ Maç' },
];
const MEDALS = ['🥇', '🥈', '🥉'];

// Liderlik tablosu grup bazlı: seçilen grubun üyeleri, o grubun oynanmış maçlarına göre.
export default function LeaderboardScreen({ navigation, route }: any) {
  const user = route.params?.user;
  const [groups, setGroups] = useState<any[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('score');

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`${API_URL}/groups`);
        const data = await res.json();
        if (Array.isArray(data) && data.length) {
          setGroups(data);
          setGroupId(data[0].id);
        } else {
          setLoading(false);
        }
      } catch (e) {
        setLoading(false);
      }
    })();
  }, []);

  const fetchBoard = async (id: string) => {
    try {
      const res = await apiFetch(`${API_URL}/leaderboard?groupId=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (Array.isArray(data)) setPlayers(data);
    } catch (e) {
      console.log('Liderlik tablosu alınamadı');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (groupId) {
      setLoading(true);
      fetchBoard(groupId);
    }
  }, [groupId]);

  const onRefresh = async () => {
    if (!groupId) return;
    setRefreshing(true);
    await fetchBoard(groupId);
    setRefreshing(false);
  };

  // Eşitlikte maç sayısı fazla olan, o da eşitse isim sırası önce gelir.
  const sorted = [...players].sort(
    (a, b) => (b[sortBy] || 0) - (a[sortBy] || 0) || (b.matches || 0) - (a.matches || 0) || displayName(a).localeCompare(displayName(b), 'tr')
  );
  const anyPlayed = players.some((p) => (p.matches || 0) > 0);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Liderlik Tablosu</Text>
        <View style={{ width: 28 }} />
      </View>

      {groups.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.groupRow} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
          {groups.map((g) => (
            <TouchableOpacity key={g.id} onPress={() => setGroupId(g.id)} style={[styles.groupChip, groupId === g.id && styles.groupChipActive]}>
              <Text style={[styles.groupChipText, groupId === g.id && styles.groupChipTextActive]} numberOfLines={1}>{g.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      {groups.length === 1 && <Text style={styles.singleGroup}>{groups[0].name}</Text>}

      <View style={styles.tabsContainer}>
        {SORTS.map((s) => (
          <TouchableOpacity key={s.key} style={[styles.tab, sortBy === s.key && styles.activeTab]} onPress={() => setSortBy(s.key)}>
            <Text style={[styles.tabText, sortBy === s.key && styles.activeTabText]}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator size="large" color="#FACC15" /></View>
      ) : groups.length === 0 ? (
        <Text style={styles.empty}>Liderlik tablosu için önce bir gruba katıl.</Text>
      ) : (
        <ScrollView
          style={styles.container}
          showsVerticalScrollIndicator={false}
          refreshControl={Platform.OS === 'web' ? undefined : <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FACC15" colors={['#FACC15']} />}
        >
          {!anyPlayed && (
            <Text style={styles.notice}>Henüz tamamlanmış maç yok. İlk maç bitince gol, MVP ve maç sayıları burada görünecek.</Text>
          )}
          <View style={{ height: 8 }} />
          {sorted.map((item: any) => {
            const isMe = item.id === user?.id;
            // Eşit değerdekiler aynı sırayı paylaşır (1, 2, 2, 4...).
            const value = item[sortBy] || 0;
            const rank = 1 + sorted.filter((x) => (x[sortBy] || 0) > value).length;
            return (
              <View key={item.id} style={[styles.playerCard, isMe && styles.meCard]}>
                <View style={styles.rankBadge}>
                  {rank <= 3 && value > 0 && anyPlayed
                    ? <Text style={{ fontSize: 22 }}>{MEDALS[rank - 1]}</Text>
                    : <Text style={styles.rankText}>{rank}</Text>}
                </View>
                <View style={styles.avatarMain}>
                  <Avatar user={item} size={46} initialStyle={styles.avatarInitial} />
                </View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={styles.playerName} numberOfLines={1}>{displayName(item)}{isMe ? ' (sen)' : ''}</Text>
                  <Text style={styles.playerMeta}>
                    {realNameHint(item) ? `${realNameHint(item)} · ` : ''}{item.matches || 0} maç · {item.goals || 0} gol · {item.mvp || 0} MVP
                  </Text>
                </View>
                <View style={styles.statScoreBg}>
                  <Text style={styles.statScoreVal}>{item[sortBy] || 0}</Text>
                </View>
              </View>
            );
          })}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0F172A', ...(Platform.OS === 'web' ? { height: '100vh' as any } : {}) },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15 },
  backButton: { padding: 5, marginLeft: -5 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#FFF' },
  container: { flex: 1, paddingHorizontal: 20 },

  groupRow: { flexGrow: 0, marginBottom: 6 },
  groupChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.04)', maxWidth: 200 },
  groupChipActive: { backgroundColor: '#FACC15', borderColor: '#FACC15' },
  groupChipText: { color: '#E2E8F0', fontWeight: '600' },
  groupChipTextActive: { color: '#0F172A' },
  singleGroup: { color: '#94A3B8', textAlign: 'center', marginBottom: 6, fontSize: 14 },

  tabsContainer: { flexDirection: 'row', paddingHorizontal: 20, marginBottom: 6 },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: '#FACC15' },
  tabText: { color: '#94A3B8', fontSize: 13, fontWeight: '600' },
  activeTabText: { color: '#FACC15', fontWeight: 'bold' },

  empty: { color: '#94A3B8', textAlign: 'center', marginTop: 40, paddingHorizontal: 30 },
  notice: { color: '#94A3B8', fontSize: 13, textAlign: 'center', marginTop: 10, lineHeight: 19 },

  playerCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', padding: 14, borderRadius: 16, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  meCard: { borderColor: 'rgba(250, 204, 21, 0.45)', backgroundColor: 'rgba(250, 204, 21, 0.06)' },
  rankBadge: { width: 32, alignItems: 'center', marginRight: 6 },
  rankText: { color: '#94A3B8', fontSize: 17, fontWeight: 'bold' },
  avatarMain: { width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(250, 204, 21, 0.1)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#FACC15', overflow: 'hidden' },
  avatarInitial: { color: '#FACC15', fontSize: 20, fontWeight: 'bold' },
  playerName: { color: '#FFF', fontSize: 16, fontWeight: 'bold', marginBottom: 3 },
  playerMeta: { color: '#94A3B8', fontSize: 12 },
  statScoreBg: { backgroundColor: 'rgba(0,0,0,0.3)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, minWidth: 50, alignItems: 'center' },
  statScoreVal: { color: '#FACC15', fontSize: 18, fontWeight: '900' },
});
