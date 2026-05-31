import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  ScrollView, 
  TouchableOpacity,
  Alert,
  Platform,
  Image,
  Modal,
  TextInput,
  KeyboardAvoidingView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../config/api';

export default function ProfileScreen({ navigation, route }: any) {
  const user = route.params?.user || { name: 'Oyuncu', id: '' };

  const [stats, setStats] = useState<any>({
    matches: 0,
    score: 0,
    goals: 0,
    badges: [],
    skills: { speed: 60, shoot: 60, pass: 60, physique: 60 }
  });

  const [avatarUrl, setAvatarUrl] = useState(user.avatar || '');
  const [isAvatarModalVisible, setAvatarModalVisible] = useState(false);
  const [tempAvatarUrl, setTempAvatarUrl] = useState('');

  const [isPositionModalVisible, setPositionModalVisible] = useState(false);
  const POSITIONS = ['Kaleci', 'Defans - Stoper', 'Defans - Bek', 'Orta Saha - Ön Libero', 'Orta Saha - 8 Numara', 'Orta Saha - 10 Numara', 'Forvet - Kanat', 'Forvet - Santrafor'];

  useEffect(() => {
    if (user.id) {
      fetch(`${API_URL}/users/${user.id}/stats`)
        .then(res => res.json())
        .then(data => {
          if(data && !data.error) setStats(data);
        })
        .catch(err => console.log('Istatistik hatasi:', err));
    }
  }, [user.id]);

  const handleUpdatePosition = async (pos: string) => {
    try {
      const res = await fetch(`${API_URL}/users/${user.id}/position`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position: pos })
      });
      if (res.ok) {
        user.position = pos;
        setPositionModalVisible(false);
      }
    } catch(e) {
      console.log('Error updating position');
    }
  };

  const handleUpdateAvatar = async () => {
    try {
      const res = await fetch(`${API_URL}/users/${user.id}/avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar: tempAvatarUrl })
      });
      if (res.ok) {
        setAvatarUrl(tempAvatarUrl);
        setAvatarModalVisible(false);
        user.avatar = tempAvatarUrl; // update local param state
        if (Platform.OS === 'web') alert('Avatar güncellendi!');
        else Alert.alert('Başarılı', 'Avatar güncellendi!');
      }
    } catch(e) {
      if (Platform.OS === 'web') alert('Avatar güncellenemedi');
      else Alert.alert('Hata', 'Avatar güncellenemedi');
    }
  };

  const handleLogout = async () => {
    if (Platform.OS === 'web') {
      if (window.confirm('Hesabınızdan çıkmak istediğinize emin misiniz?')) {
        await AsyncStorage.removeItem('userToken');
        navigation.replace('Auth');
      }
    } else {
      Alert.alert('Çıkış', 'Hesabınızdan çıkmak istediğinize emin misiniz?', [
        { text: 'İptal', style: 'cancel' },
        { 
          text: 'Çıkış Yap', 
          style: 'destructive', 
          onPress: async () => {
            await AsyncStorage.removeItem('userToken');
            navigation.replace('Auth');
          }
        }
      ]);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profilim</Text>
        <TouchableOpacity style={styles.settingsButton} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={26} color="#ef4444" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        
        {/* Profile Info - FIFA Style Card */}
        <View style={{alignItems: 'center', marginVertical: 20, marginTop: 30}}>
          <TouchableOpacity activeOpacity={0.9} onPress={() => { setTempAvatarUrl(avatarUrl); setAvatarModalVisible(true); }}>
            <LinearGradient colors={['#FACC15', '#A16207']} style={styles.fifaCardBg}>
               <View style={styles.fifaCardInner}>
                 <View style={styles.fifaTopLeft}>
                    <Text style={styles.fifaOverall}>{stats.score}</Text>
                    <Text style={styles.fifaPosition}>{user.position ? user.position.split(' - ')[0].substring(0,3).toUpperCase() : 'ORT'}</Text>
                 </View>
                 <View style={styles.fifaAvatarContainer}>
                    {avatarUrl ? (
                      <Image source={{ uri: avatarUrl }} style={styles.fifaAvatar} />
                    ) : (
                      <Text style={styles.fifaAvatarInitial}>{user.name?.charAt(0) || 'O'}</Text>
                    )}
                 </View>
                 <Text style={styles.fifaName} numberOfLines={1}>{user.name}</Text>
                 
                 <View style={styles.fifaDivider} />
                 
                 <View style={styles.fifaStatsGrid}>
                    <View style={styles.fifaStatRow}><Text style={styles.fifaStatVal}>{stats.skills.speed}</Text><Text style={styles.fifaStatLabel}>HIZ</Text></View>
                    <View style={styles.fifaStatRow}><Text style={styles.fifaStatVal}>{stats.skills.shoot}</Text><Text style={styles.fifaStatLabel}>ŞUT</Text></View>
                    <View style={styles.fifaStatRow}><Text style={styles.fifaStatVal}>{stats.skills.pass}</Text><Text style={styles.fifaStatLabel}>PAS</Text></View>
                    <View style={styles.fifaStatRow}><Text style={styles.fifaStatVal}>{stats.skills.physique}</Text><Text style={styles.fifaStatLabel}>FİZ</Text></View>
                 </View>
               </View>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setPositionModalVisible(true)} style={{marginTop: 20, flexDirection: 'row', alignItems: 'center'}}>
             <Text style={{color: '#94A3B8', fontSize: 13}}>Mevki Güncelle: </Text>
             <Text style={{color: '#00E676', fontWeight: 'bold'}}>{user.position || 'Orta Saha'}</Text>
             <Ionicons name="pencil" size={14} color="#00E676" style={{marginLeft: 5}}/>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => navigation.navigate('Availability' as never, { user } as never)}
            style={styles.availabilityRow}
            activeOpacity={0.85}
          >
            <Ionicons name="calendar" size={22} color="#00E676" />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.availabilityTitle}>Müsaitlik</Text>
              <Text style={styles.availabilitySub}>Hangi gün / saatlerde oynayabileceğini kaydet</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#64748B" />
          </TouchableOpacity>
        </View>

        {/* Profile Badges Section */}
        {stats.badges && stats.badges.length > 0 && (
          <View style={{ marginTop: 20 }}>
            <Text style={styles.sectionTitle}>Başarılar</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
              {stats.badges.map((b: any, index: number) => (
                <View key={index} style={[styles.badgeItem, { backgroundColor: b.bg }]}>
                  <Text style={{ fontSize: 18, marginRight: 6 }}>{b.icon}</Text>
                  <Text style={styles.badgeText}>{b.title}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Stats Section */}
        <View style={styles.statsRow}>
          <LinearGradient colors={['rgba(0, 230, 118, 0.15)', 'rgba(0, 230, 118, 0.05)']} style={styles.statBoxGradient}>
             <Text style={styles.statValue}>{stats.matches}</Text>
            <Text style={styles.statLabel}>Maç</Text>
          </LinearGradient>
          <LinearGradient colors={['rgba(33, 150, 243, 0.15)', 'rgba(33, 150, 243, 0.05)']} style={styles.statBoxGradient}>
            <Text style={styles.statValue}>{stats.score}</Text>
            <Text style={styles.statLabel}>Skor</Text>
          </LinearGradient>
          <LinearGradient colors={['rgba(245, 158, 11, 0.15)', 'rgba(245, 158, 11, 0.05)']} style={styles.statBoxGradient}>
            <Text style={styles.statValue}>{stats.goals}</Text>
            <Text style={styles.statLabel}>Gol</Text>
          </LinearGradient>
        </View>

        {/* Radar Chart */}
        <View style={styles.radarContainer}>
          <Text style={styles.sectionTitle}>Oyuncu Analizi</Text>
          <View style={styles.radarMock}>
            <View style={styles.skillRow}>
              <Text style={styles.skillLabel}>Hız</Text>
              <View style={styles.skillBarBg}>
                 <LinearGradient colors={['#00C853', '#B2FF59']} style={[styles.skillBarFill, { width: `${stats.skills.speed}%` }]} />
              </View>
              <Text style={styles.skillValue}>{stats.skills.speed}</Text>
            </View>
            <View style={styles.skillRow}>
              <Text style={styles.skillLabel}>Şut</Text>
              <View style={styles.skillBarBg}>
                 <LinearGradient colors={['#2196F3', '#64B5F6']} style={[styles.skillBarFill, { width: `${stats.skills.shoot}%` }]} />
              </View>
              <Text style={styles.skillValue}>{stats.skills.shoot}</Text>
            </View>
            <View style={styles.skillRow}>
              <Text style={styles.skillLabel}>Pas</Text>
              <View style={styles.skillBarBg}>
                 <LinearGradient colors={['#00E676', '#1DE9B6']} style={[styles.skillBarFill, { width: `${stats.skills.pass}%` }]} />
              </View>
              <Text style={styles.skillValue}>{stats.skills.pass}</Text>
            </View>
            <View style={styles.skillRow}>
              <Text style={styles.skillLabel}>Fizik</Text>
              <View style={styles.skillBarBg}>
                 <LinearGradient colors={['#F59E0B', '#FCD34D']} style={[styles.skillBarFill, { width: `${stats.skills.physique}%` }]} />
              </View>
              <Text style={styles.skillValue}>{stats.skills.physique}</Text>
            </View>
          </View>
        </View>

        {/* Buttons */}
        <TouchableOpacity style={styles.editProfileButton} onPress={() => { setTempAvatarUrl(avatarUrl); setAvatarModalVisible(true); }}>
          <Text style={styles.editProfileText}>Fotoğraf Ekle / Düzenle</Text>
          <Ionicons name="camera-outline" size={20} color="#FFFFFF" style={{marginLeft: 10}} />
        </TouchableOpacity>

        <View style={{height: 50}} />
      </ScrollView>

      {/* Avatar Modal */}
      <Modal visible={isAvatarModalVisible} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Profil Resmini Değiştir</Text>
            <View style={styles.modalInputContainer}>
              <Ionicons name="link-outline" size={20} color="#00E676" style={{ marginRight: 10 }} />
              <TextInput 
                style={styles.modalInput}
                placeholder="Resim linki (örn: https://i.imgur.com/...) "
                placeholderTextColor="#A0A0A0"
                value={tempAvatarUrl}
                onChangeText={setTempAvatarUrl}
              />
            </View>
            <TouchableOpacity style={styles.saveBtn} onPress={handleUpdateAvatar}>
               <LinearGradient colors={['#00C853', '#B2FF59']} start={{x: 0, y: 0}} end={{x: 1, y: 0}} style={styles.saveBtnGradient}>
                 <Text style={styles.saveBtnText}>AVATARI KAYDET</Text>
               </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setAvatarModalVisible(false)}>
               <Text style={styles.cancelBtnText}>İptal Et</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Position Modal */}
      <Modal visible={isPositionModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Mevkinizi Seçin</Text>
            <ScrollView style={{maxHeight: 300, marginBottom: 20}}>
              {POSITIONS.map((pos, i) => (
                <TouchableOpacity key={i} onPress={() => handleUpdatePosition(pos)} style={styles.positionOptionBtn}>
                  <Text style={styles.positionOptionText}>{pos}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setPositionModalVisible(false)}>
               <Text style={styles.cancelBtnText}>İptal Et</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0F172A' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  backButton: { padding: 5, marginLeft: -5 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#FFFFFF' },
  settingsButton: { padding: 5, marginRight: -5 },
  container: { flex: 1, paddingHorizontal: 20 },
  
  profileHero: { alignItems: 'center', marginVertical: 20 },
  fifaCardBg: { width: 230, height: 330, borderRadius: 20, padding: 3, elevation: 15, shadowColor: '#FACC15', shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: {width: 0, height: 10} },
  fifaCardInner: { flex: 1, backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 17, padding: 15, alignItems: 'center', overflow: 'hidden' },
  fifaTopLeft: { position: 'absolute', top: 25, left: 20, alignItems: 'center' },
  fifaOverall: { fontSize: 32, fontWeight: '900', color: '#FFF', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: {width:1,height:1}, textShadowRadius: 3 },
  fifaPosition: { fontSize: 13, fontWeight: '800', color: '#FFF' },
  fifaAvatarContainer: { marginTop: 20, width: 110, height: 110, borderRadius: 55, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#FDE047', overflow: 'hidden' },
  fifaAvatar: { width: '100%', height: '100%' },
  fifaAvatarInitial: { fontSize: 45, fontWeight: 'bold', color: '#FFF' },
  fifaName: { marginTop: 15, fontSize: 18, fontWeight: '800', color: '#FFF', textTransform: 'uppercase', letterSpacing: 1 },
  fifaDivider: { width: '80%', height: 1, backgroundColor: 'rgba(255,255,255,0.4)', marginVertical: 15 },
  fifaStatsGrid: { flexDirection: 'row', flexWrap: 'wrap', width: '95%', justifyContent: 'space-between', paddingHorizontal: 10 },
  fifaStatRow: { width: '45%', flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  fifaStatVal: { fontSize: 18, fontWeight: '800', color: '#FFF', width: 28, textAlign: 'right' },
  fifaStatLabel: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.9)', marginLeft: 6 },

  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 30 },
  statBoxGradient: { width: '31%', paddingVertical: 20, borderRadius: 20, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.03)' },
  statValue: { color: '#FFFFFF', fontSize: 28, fontWeight: 'bold', marginBottom: 5 },
  statLabel: { color: '#94A3B8', fontSize: 13 },

  radarContainer: { backgroundColor: 'rgba(255, 255, 255, 0.03)', borderRadius: 24, padding: 25, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.05)', marginBottom: 30 },
  sectionTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: 'bold', marginBottom: 20 },
  radarMock: { marginTop: 10 },
  skillRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  skillLabel: { width: 50, color: '#A0A0A0', fontSize: 14, fontWeight: '600' },
  skillBarBg: { flex: 1, height: 8, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 4, overflow: 'hidden', marginHorizontal: 15 },
  skillBarFill: { height: '100%', borderRadius: 4 },
  skillValue: { width: 30, color: '#FFFFFF', fontSize: 15, fontWeight: 'bold', textAlign: 'right' },

  editProfileButton: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.05)', paddingVertical: 18, borderRadius: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  editProfileText: { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1E293B', borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 25, paddingBottom: 40, borderTopWidth: 1, borderTopColor: 'rgba(0, 230, 118, 0.3)' },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 20, textAlign: 'center' },
  modalInputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 16, paddingHorizontal: 20, height: 60, marginBottom: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  modalInput: { flex: 1, color: '#FFFFFF', fontSize: 15 },
  saveBtn: { borderRadius: 16, overflow: 'hidden', marginBottom: 15 },
  saveBtnGradient: { paddingVertical: 18, alignItems: 'center' },
  saveBtnText: { color: '#000', fontSize: 16, fontWeight: 'bold', letterSpacing: 1 },
  cancelBtn: { paddingVertical: 15, alignItems: 'center' },
  cancelBtnText: { color: '#EF4444', fontSize: 16, fontWeight: 'bold' },
  positionOptionBtn: { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', alignItems: 'center' },
  positionOptionText: { color: '#00E676', fontSize: 16, fontWeight: '500' },

  availabilityRow: {
    marginTop: 20,
    width: '100%',
    maxWidth: 360,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 230, 118, 0.08)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(0, 230, 118, 0.25)',
  },
  availabilityTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  availabilitySub: { color: '#94A3B8', fontSize: 12, marginTop: 4 },
  badgeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  badgeText: { color: '#F8FAFC', fontSize: 13, fontWeight: '700' }
});
