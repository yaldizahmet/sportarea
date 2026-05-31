import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  ScrollView, 
  TouchableOpacity,
  Image,
  ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { API_URL } from '../config/api';

export default function LeaderboardScreen({ navigation, route }: any) {
  const [players, setPlayers] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('score'); // 'score', 'goals', 'matches'
  const [viewMode, setViewMode] = useState('players'); // 'players', 'groups'
  const user = route.params?.user;

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  const fetchLeaderboard = async () => {
    try {
      const res = await fetch(`${API_URL}/leaderboard`);
      let data = await res.json();
      if(Array.isArray(data)) {
        data.sort((a,b) => b.score - a.score);
        setPlayers(data);
      }
      
      if(user?.id) {
         const grpRes = await fetch(`${API_URL}/leaderboard/groups?userId=${user.id}`);
         let grpData = await grpRes.json();
         if(Array.isArray(grpData)) {
            grpData.sort((a: any,b: any) => b.score - a.score);
            setGroups(grpData);
         }
      }
    } catch(e) {
      console.log('Error fetching leaderboard');
    } finally {
      setLoading(false);
    }
  };

  const getSortedData = () => {
    let source = viewMode === 'players' ? [...players] : [...groups];
    return source.sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0)).slice(0, 50);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Liderlik Tablosu</Text>
        <View style={{width: 28}} />
      </View>

      <View style={{flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.05)', marginHorizontal: 20, borderRadius: 12, marginBottom: 15, padding: 5}}>
         <TouchableOpacity 
           style={[styles.mainTab, viewMode === 'players' && styles.activeMainTab]} 
           onPress={() => setViewMode('players')}>
            <Text style={[styles.mainTabText, viewMode === 'players' && styles.activeMainTabText]}>👤 Oyuncular</Text>
         </TouchableOpacity>
         <TouchableOpacity 
           style={[styles.mainTab, viewMode === 'groups' && styles.activeMainTab]} 
           onPress={() => setViewMode('groups')}>
            <Text style={[styles.mainTabText, viewMode === 'groups' && styles.activeMainTabText]}>🛡️ Gruplarım</Text>
         </TouchableOpacity>
      </View>

      <View style={styles.tabsContainer}>
        <TouchableOpacity style={[styles.tab, sortBy === 'score' && styles.activeTab]} onPress={() => setSortBy('score')}>
           <Text style={[styles.tabText, sortBy === 'score' && styles.activeTabText]}>🌟 Genel Puan</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, sortBy === 'goals' && styles.activeTab]} onPress={() => setSortBy('goals')}>
           <Text style={[styles.tabText, sortBy === 'goals' && styles.activeTabText]}>⚽ Goller</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, sortBy === 'matches' && styles.activeTab]} onPress={() => setSortBy('matches')}>
           <Text style={[styles.tabText, sortBy === 'matches' && styles.activeTabText]}>🏟️ Maçlar</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{flex: 1, justifyContent: 'center'}}><ActivityIndicator size="large" color="#FACC15" /></View>
      ) : (
        <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
          <View style={{height: 15}} />
          {getSortedData().map((item: any, i: number) => (
             <View key={i} style={styles.playerCard}>
                <View style={styles.rankBadge}>
                   <Text style={styles.rankText}>{i + 1}</Text>
                </View>
                <View style={styles.avatarMain}>
                   {item.avatar ? (
                     <Image source={{uri: item.avatar}} style={{width: 50, height: 50, borderRadius: 25}} />
                   ) : (
                     <Text style={styles.avatarInitial}>{item.name.charAt(0)}</Text>
                   )}
                </View>
                <View style={{flex: 1, marginLeft: 15}}>
                   <Text style={styles.playerName}>{item.name}</Text>
                   {viewMode === 'players' && <Text style={styles.playerPosition}>{item.position || 'ORT'}</Text>}
                   {viewMode === 'groups' && <Text style={styles.playerPosition}>{item.matches || 0} Maç</Text>}
                </View>
                <View style={styles.statScoreBg}>
                   <Text style={[styles.statScoreVal, sortBy === 'goals' ? {color: '#00E676'} : {}]}>{item[sortBy] || 0}</Text>
                </View>
             </View>
          ))}
          <View style={{height: 40}} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15 },
  backButton: { padding: 5, marginLeft: -5 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#FFF' },
  container: { flex: 1, paddingHorizontal: 20 },

  tabsContainer: { flexDirection: 'row', paddingHorizontal: 20, marginBottom: 10, justifyContent: 'space-between' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: '#FACC15' },
  tabText: { color: '#94A3B8', fontSize: 13, fontWeight: '600' },
  activeTabText: { color: '#FACC15', fontWeight: 'bold' },
  
  mainTab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  activeMainTab: { backgroundColor: '#334155' },
  mainTabText: { color: '#94A3B8', fontSize: 14, fontWeight: '600' },
  activeMainTabText: { color: '#FFFFFF', fontWeight: 'bold' },

  playerCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', padding: 15, borderRadius: 16, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  rankBadge: { width: 30, alignItems: 'center', marginRight: 5 },
  rankText: { color: '#94A3B8', fontSize: 18, fontWeight: 'bold' },
  avatarMain: { width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(250, 204, 21, 0.1)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#FACC15' },
  avatarInitial: { color: '#FACC15', fontSize: 22, fontWeight: 'bold' },
  playerName: { color: '#FFF', fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  playerPosition: { color: '#A0A0A0', fontSize: 12 },
  statScoreBg: { backgroundColor: 'rgba(0,0,0,0.3)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, minWidth: 50, alignItems: 'center' },
  statScoreVal: { color: '#FACC15', fontSize: 18, fontWeight: '900' }
});
