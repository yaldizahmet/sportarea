import { apiFetch } from '../utils/api';
import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Alert,
  Share,
  TextInput,
  Platform,
  Switch,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { API_URL } from '../config/api';
import { DAY_NAMES, DAY_NAMES_SHORT, formatWeekly } from '../utils/format';
import { inviteLink } from '../utils/invite';

// Pazartesi'den başlayan sıra (halı saha haftası böyle düşünülüyor)
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const TIMES = ['18:00', '19:00', '20:00', '21:00', '22:00', '23:00', '00:00'];
const LOCKOUT_OPTIONS = [1, 3, 6, 12];

const showAlert = (title: string, msg: string) => {
  if (Platform.OS === 'web') window.alert(`${title}\n\n${msg}`);
  else Alert.alert(title, msg);
};

export default function GroupDetailsScreen({ route, navigation }: any) {
  const user = route.params?.user || { id: 'tempId', name: 'User' };
  const initialGroup = route.params?.group || {};

  const [group, setGroup] = useState<any>(initialGroup);
  const [members, setMembers] = useState<any[]>([]);
  const [alwaysIn, setAlwaysIn] = useState<boolean>(false);
  const [savingAlwaysIn, setSavingAlwaysIn] = useState(false);

  // Haftalık maç düzenleme
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [day, setDay] = useState<number>(3);
  const [time, setTime] = useState('21:00');
  const [location, setLocation] = useState('');
  const [maxPlayers, setMaxPlayers] = useState('14');
  const [lockoutHours, setLockoutHours] = useState(3);
  const [savingSchedule, setSavingSchedule] = useState(false);

  const isCreator = group.creatorId === user.id;
  const weekly = formatWeekly(group.weeklyDay, group.weeklyTime);

  const fetchGroup = async () => {
    try {
      const res = await apiFetch(`${API_URL}/groups/${initialGroup.id}`);
      const data = await res.json();
      if (res.ok) {
        setGroup(data);
        setAlwaysIn(Boolean(data.myAlwaysIn));
      }
    } catch (e) {}
  };

  const fetchMembers = async () => {
    try {
      const res = await apiFetch(`${API_URL}/groups/${initialGroup.id}/members`);
      const data = await res.json();
      if (Array.isArray(data)) setMembers(data);
    } catch (e) {}
  };

  useFocusEffect(
    useCallback(() => {
      if (initialGroup.id) {
        fetchGroup();
        fetchMembers();
      }
    }, [initialGroup.id])
  );

  const startEditSchedule = () => {
    setDay(group.weeklyDay ?? 3);
    setTime(group.weeklyTime || '21:00');
    setLocation(group.weeklyLocation || '');
    setMaxPlayers(String(group.weeklyMaxPlayers || 14));
    setLockoutHours(group.weeklyLockoutHours ?? 3);
    setEditingSchedule(true);
  };

  const saveSchedule = async () => {
    if (!location.trim()) {
      showAlert('Eksik bilgi', 'Saha adını yaz.');
      return;
    }
    setSavingSchedule(true);
    try {
      const res = await apiFetch(`${API_URL}/groups/${group.id}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day, time, location: location.trim(), maxPlayers: parseInt(maxPlayers, 10), lockoutHours }),
      });
      const data = await res.json();
      if (res.ok) {
        setEditingSchedule(false);
        await fetchGroup();
        showAlert('Kaydedildi', data.message);
      } else {
        showAlert('Olmadı', data.error || 'Kaydedilemedi.');
      }
    } catch (e) {
      showAlert('Hata', 'Bağlantı sorunu yaşandı.');
    }
    setSavingSchedule(false);
  };

  const disableSchedule = async () => {
    const run = async () => {
      try {
        const res = await apiFetch(`${API_URL}/groups/${group.id}/schedule`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: false }),
        });
        const data = await res.json();
        if (res.ok) {
          setEditingSchedule(false);
          await fetchGroup();
          showAlert('Kapatıldı', data.message);
        }
      } catch (e) {}
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Haftalık otomatik maç kapatılsın mı?')) run();
    } else {
      Alert.alert('Haftalık maç', 'Otomatik maç kapatılsın mı?', [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Kapat', style: 'destructive', onPress: run },
      ]);
    }
  };

  const toggleAlwaysIn = async (value: boolean) => {
    setAlwaysIn(value);
    setSavingAlwaysIn(true);
    try {
      const res = await apiFetch(`${API_URL}/groups/${group.id}/always-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alwaysIn: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAlwaysIn(!value);
        showAlert('Olmadı', data.error || 'Ayar kaydedilemedi.');
      } else {
        fetchMembers();
        if (value) showAlert('Her hafta varsın', data.message);
      }
    } catch (e) {
      setAlwaysIn(!value);
      showAlert('Hata', 'Bağlantı sorunu yaşandı.');
    }
    setSavingAlwaysIn(false);
  };

  const handleShareCode = async () => {
    const lines = [
      `⚽ ${group.name} grubuna katıl!`,
      weekly ? `${weekly} · ${group.weeklyLocation}` : null,
      '',
      `Katılmak için dokun (iPhone'da da çalışır, indirme gerekmez):`,
      inviteLink(group.inviteCode),
      '',
      `Uygulama yüklüyse: "Kodla Katıl" → ${group.inviteCode}`,
    ].filter((x) => x !== null);
    const message = lines.join('\n');
    // Bilgisayar tarayıcılarında paylaşım menüsü yok: mesajı panoya kopyala.
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && !(navigator as any).share) {
      try {
        await navigator.clipboard.writeText(message);
        showAlert('Kopyalandı', 'Davet mesajı kopyalandı. WhatsApp grubuna yapıştırabilirsin.');
      } catch {
        showAlert('Davet linki', message);
      }
      return;
    }
    try {
      await Share.share({ message });
    } catch (error) {
      showAlert('Hata', 'Paylaşım yapılamadı.');
    }
  };

  const handleDeleteGroup = async () => {
    const performDelete = async () => {
      try {
        const res = await apiFetch(`${API_URL}/groups/${group.id}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok) {
          showAlert('Silindi', 'Grup silindi.');
          navigation.goBack();
        } else {
          showAlert('Hata', data.error || 'Grup silinemedi.');
        }
      } catch (e) {
        showAlert('Hata', 'Bağlantı sorunu yaşandı.');
      }
    };
    const msg = 'Grup ve üyelik bilgileri kalıcı olarak silinecek. Emin misin?';
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) await performDelete();
    } else {
      Alert.alert('Grubu sil', msg, [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Evet, sil', style: 'destructive', onPress: performDelete },
      ]);
    }
  };

  const alwaysInCount = members.filter((m) => m.alwaysIn).length;

  const confirmThen = (title: string, msg: string, action: string, run: () => void) => {
    if (Platform.OS === 'web') {
      if (window.confirm(`${title}\n\n${msg}`)) run();
    } else {
      Alert.alert(title, msg, [
        { text: 'Vazgeç', style: 'cancel' },
        { text: action, style: 'destructive', onPress: run },
      ]);
    }
  };

  const handleLeave = () =>
    confirmThen('Gruptan ayrıl', 'Yaklaşan maçlarda kadrodaysan yerin yedeğe geçer. Emin misin?', 'Ayrıl', async () => {
      try {
        const res = await apiFetch(`${API_URL}/groups/${group.id}/leave`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
          showAlert('Ayrıldın', data.message);
          navigation.goBack();
        } else showAlert('Olmadı', data.error || 'Ayrılamadın.');
      } catch (e) {
        showAlert('Hata', 'Bağlantı sorunu yaşandı.');
      }
    });

  const handleRemoveMember = (member: any) =>
    confirmThen('Üyeyi çıkar', `${member.name} gruptan çıkarılsın mı? Yaklaşan maçlardaki yeri yedeğe geçer.`, 'Çıkar', async () => {
      try {
        const res = await apiFetch(`${API_URL}/groups/${group.id}/members/${member.id}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok) {
          fetchMembers();
          fetchGroup();
        } else showAlert('Olmadı', data.error || 'Çıkarılamadı.');
      } catch (e) {
        showAlert('Hata', 'Bağlantı sorunu yaşandı.');
      }
    });

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{String(group.name || 'Grup')}</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView style={styles.container} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <LinearGradient colors={['rgba(0, 230, 118, 0.15)', 'rgba(0, 230, 118, 0.05)']} style={styles.heroCard}>
          <View style={styles.statsContainer}>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{String(group.memberCount ?? members.length)}</Text>
              <Text style={styles.statLabel}>Üye</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{String(group.matchCount ?? 0)}</Text>
              <Text style={styles.statLabel}>Oynanan maç</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{String(alwaysInCount)}</Text>
              <Text style={styles.statLabel}>Her hafta varım</Text>
            </View>
          </View>
        </LinearGradient>

        {/* DAVET */}
        <View style={styles.card}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardLabel}>Davet kodu</Text>
            <Text style={styles.inviteCode}>{String(group.inviteCode || '—')}</Text>
          </View>
          <TouchableOpacity style={styles.shareButton} onPress={handleShareCode}>
            <Ionicons name="share-social-outline" size={18} color="#00E676" />
            <Text style={styles.shareButtonText}>Paylaş</Text>
          </TouchableOpacity>
        </View>

        {/* HAFTALIK MAÇ */}
        <View style={[styles.card, { flexDirection: 'column', alignItems: 'stretch' }]}>
          <View style={styles.cardHeaderRow}>
            <Ionicons name="repeat" size={20} color="#00E676" />
            <Text style={styles.cardTitle}>Haftalık maç</Text>
            {isCreator && !editingSchedule && (
              <TouchableOpacity onPress={startEditSchedule} style={styles.linkButton}>
                <Text style={styles.linkButtonText}>{weekly ? 'Düzenle' : 'Ayarla'}</Text>
              </TouchableOpacity>
            )}
          </View>

          {!editingSchedule ? (
            weekly ? (
              <View>
                <Text style={styles.weeklyMain}>{weekly}</Text>
                <Text style={styles.weeklySub}>
                  {group.weeklyLocation} · {group.weeklyMaxPlayers} kişi · son değişiklik maçtan {group.weeklyLockoutHours ?? 3} saat önce
                </Text>
                <Text style={styles.weeklyHint}>
                  Maç her hafta kendiliğinden açılır, gruba davet gider. Ayrıca kurmana gerek yok.
                </Text>
              </View>
            ) : (
              <Text style={styles.weeklyHint}>
                {isCreator
                  ? 'Gün, saat ve sahayı bir kez gir; maç her hafta kendiliğinden açılsın.'
                  : 'Henüz ayarlanmadı. Grubu kuran kişi ayarlayabilir.'}
              </Text>
            )
          ) : (
            <View>
              <Text style={styles.fieldLabel}>Gün</Text>
              <View style={styles.chipWrap}>
                {DAY_ORDER.map((d) => (
                  <TouchableOpacity key={d} onPress={() => setDay(d)} style={[styles.chip, day === d && styles.chipActive]}>
                    <Text style={[styles.chipText, day === d && styles.chipTextActive]}>{DAY_NAMES_SHORT[d]}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Saat</Text>
              <View style={styles.chipWrap}>
                {TIMES.map((t) => (
                  <TouchableOpacity key={t} onPress={() => setTime(t)} style={[styles.chip, time === t && styles.chipActive]}>
                    <Text style={[styles.chipText, time === t && styles.chipTextActive]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {time.startsWith('00') && (
                <Text style={styles.nightHint}>{DAY_NAMES[day]} gecesi 00:00 (takvimde {DAY_NAMES[(day + 1) % 7]}).</Text>
              )}

              <Text style={styles.fieldLabel}>Saha</Text>
              <TextInput
                style={styles.input}
                value={location}
                onChangeText={setLocation}
                placeholder="Örn: Olimpik Halı Saha"
                placeholderTextColor="#64748B"
              />

              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Kişi sayısı</Text>
                  <TextInput
                    style={styles.input}
                    value={maxPlayers}
                    onChangeText={setMaxPlayers}
                    keyboardType="numeric"
                    placeholder="14"
                    placeholderTextColor="#64748B"
                  />
                </View>
                <View style={{ flex: 1.4 }}>
                  <Text style={styles.fieldLabel}>Son değişiklik (saat önce)</Text>
                  <View style={styles.chipWrap}>
                    {LOCKOUT_OPTIONS.map((h) => (
                      <TouchableOpacity key={h} onPress={() => setLockoutHours(h)} style={[styles.chip, lockoutHours === h && styles.chipActive]}>
                        <Text style={[styles.chipText, lockoutHours === h && styles.chipTextActive]}>{h}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
                <TouchableOpacity style={[styles.secondaryBtn, { flex: 1 }]} onPress={() => setEditingSchedule(false)}>
                  <Text style={styles.secondaryBtnText}>Vazgeç</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.primaryBtn, { flex: 1.4 }]} onPress={saveSchedule} disabled={savingSchedule}>
                  {savingSchedule ? <ActivityIndicator color="#0F172A" /> : <Text style={styles.primaryBtnText}>Kaydet</Text>}
                </TouchableOpacity>
              </View>
              {weekly && (
                <TouchableOpacity onPress={disableSchedule} style={{ marginTop: 12, alignSelf: 'center' }}>
                  <Text style={{ color: '#F87171', fontWeight: '600' }}>Haftalık maçı kapat</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* HER HAFTA VARIM */}
        <View style={styles.card}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.cardTitle}>Her hafta varım</Text>
            <Text style={styles.weeklyHint}>
              Açık olursa her maçta otomatik kadroya girersin. Gelemeyeceğin hafta maç sayfasından "Yokum" demen yeterli.
            </Text>
          </View>
          <Switch
            value={alwaysIn}
            onValueChange={toggleAlwaysIn}
            disabled={savingAlwaysIn}
            trackColor={{ false: '#334155', true: 'rgba(0, 230, 118, 0.5)' }}
            thumbColor={alwaysIn ? '#00E676' : '#94A3B8'}
          />
        </View>

        {/* ÜYELER */}
        <Text style={styles.sectionTitle}>Üyeler</Text>
        <View style={styles.membersContainer}>
          {members.length === 0 ? (
            <Text style={{ color: '#A0A0A0', textAlign: 'center' }}>Henüz üye yok.</Text>
          ) : (
            members.map((member) => {
              const founder = member.id === group.creatorId;
              return (
                <View key={member.id} style={styles.memberCard}>
                  <View style={styles.memberLeft}>
                    <View style={[styles.memberAvatar, founder ? styles.founderAvatar : null]}>
                      {member.avatar ? (
                        <Image source={{ uri: member.avatar }} style={{ width: 44, height: 44, borderRadius: 22 }} />
                      ) : (
                        <Text style={styles.memberInitial}>{String(member.name?.charAt(0) || '?')}</Text>
                      )}
                    </View>
                    <View>
                      <Text style={styles.memberName}>{String(member.name)}{member.id === user.id ? ' (sen)' : ''}</Text>
                      <Text style={styles.memberRole}>
                        {founder ? 'Kurucu' : String(member.position || 'Oyuncu')}
                        {member.alwaysIn ? ' · Her hafta' : ''}
                      </Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={styles.memberStats}>
                      <Ionicons name="football" size={14} color="#A0A0A0" />
                      <Text style={styles.memberMatches}>{String(member.matches || 0)}</Text>
                    </View>
                    {isCreator && !founder && (
                      <TouchableOpacity onPress={() => handleRemoveMember(member)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={`${member.name} gruptan çıkar`}>
                        <Ionicons name="person-remove-outline" size={20} color="#F87171" />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </View>

        {!isCreator && group.id && (
          <TouchableOpacity style={styles.deleteButton} onPress={handleLeave}>
            <Ionicons name="exit-outline" size={18} color="#F87171" style={{ marginRight: 8 }} />
            <Text style={styles.deleteButtonText}>Gruptan ayrıl</Text>
          </TouchableOpacity>
        )}

        {isCreator && (
          <TouchableOpacity style={styles.deleteButton} onPress={handleDeleteGroup}>
            <Ionicons name="trash-outline" size={18} color="#F87171" style={{ marginRight: 8 }} />
            <Text style={styles.deleteButtonText}>Grubu sil</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0F172A', ...(Platform.OS === 'web' ? { height: '100vh' as any, overflow: 'auto' as any } : {}) },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15 },
  backButton: { padding: 5, marginLeft: -5 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 20, fontWeight: 'bold', color: '#FFFFFF', marginHorizontal: 10 },
  container: { flex: 1, paddingHorizontal: 20 },

  heroCard: { padding: 18, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(0, 230, 118, 0.3)', marginTop: 4 },
  statsContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' },
  statBox: { alignItems: 'center', flex: 1 },
  statNumber: { color: '#FFFFFF', fontSize: 22, fontWeight: 'bold' },
  statLabel: { color: '#94A3B8', fontSize: 12, marginTop: 4, textAlign: 'center' },
  statDivider: { width: 1, height: 30, backgroundColor: 'rgba(255,255,255,0.1)' },

  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 16, padding: 18, marginTop: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  cardLabel: { color: '#94A3B8', fontSize: 13, marginBottom: 5 },
  cardTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold', flex: 1 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  inviteCode: { color: '#FFFFFF', fontSize: 20, fontWeight: 'bold', letterSpacing: 3 },
  shareButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0, 230, 118, 0.15)', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  shareButtonText: { color: '#00E676', marginLeft: 6, fontWeight: 'bold' },
  linkButton: { paddingHorizontal: 10, paddingVertical: 4 },
  linkButtonText: { color: '#00E676', fontWeight: 'bold' },

  weeklyMain: { color: '#FFFFFF', fontSize: 18, fontWeight: 'bold' },
  weeklySub: { color: '#CBD5E1', fontSize: 14, marginTop: 4 },
  weeklyHint: { color: '#94A3B8', fontSize: 13, marginTop: 6, lineHeight: 18 },
  nightHint: { color: '#FFC107', fontSize: 12, marginTop: -4, marginBottom: 10 },

  fieldLabel: { color: '#94A3B8', fontSize: 13, marginBottom: 8, marginTop: 4 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.04)' },
  chipActive: { backgroundColor: '#00E676', borderColor: '#00E676' },
  chipText: { color: '#E2E8F0', fontWeight: '600' },
  chipTextActive: { color: '#0F172A' },
  input: { backgroundColor: 'rgba(0,0,0,0.25)', color: '#FFFFFF', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginBottom: 12 },
  primaryBtn: { backgroundColor: '#00E676', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryBtnText: { color: '#0F172A', fontWeight: 'bold', fontSize: 16 },
  secondaryBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  secondaryBtnText: { color: '#A0A0A0', fontWeight: 'bold', fontSize: 16 },

  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#FFFFFF', marginTop: 24, marginBottom: 12 },
  membersContainer: { backgroundColor: 'rgba(255, 255, 255, 0.03)', borderRadius: 20, padding: 15, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.05)' },
  memberCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)', paddingBottom: 12 },
  memberLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  memberAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#334155', justifyContent: 'center', alignItems: 'center', marginRight: 14, overflow: 'hidden' },
  founderAvatar: { borderWidth: 1.5, borderColor: '#00E676' },
  memberInitial: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 18 },
  memberName: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  memberRole: { color: '#94A3B8', fontSize: 13, marginTop: 2 },
  memberStats: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  memberMatches: { color: '#E2E8F0', fontSize: 13, marginLeft: 6, fontWeight: '500' },

  deleteButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 24, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(248, 113, 113, 0.4)' },
  deleteButtonText: { color: '#F87171', fontSize: 15, fontWeight: 'bold' },
});
