import { apiFetch } from '../utils/api';
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
  ActivityIndicator,
  TextInput,
  Linking,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../config/api';
import { unregisterPush, setupPush, explainPushError } from '../utils/push';
import ChangePasswordModal from '../components/ChangePasswordModal';
import Avatar, { AVATAR_EMOJIS } from '../components/Avatar';
import { displayName, shortName } from '../utils/format';
import { versionLabel } from '../utils/version';

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
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarModal, setAvatarModal] = useState(false);
  const [pushTesting, setPushTesting] = useState(false);
  const [nickname, setNickname] = useState<string>(user.nickname || '');
  const [nickModal, setNickModal] = useState(false);
  const [nickInput, setNickInput] = useState('');

  const [isPositionModalVisible, setPositionModalVisible] = useState(false);
  const [passwordModal, setPasswordModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Hesap silme: şifreyle onaylanır, tüm veriler sunucudan kalıcı olarak silinir.
  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      notify('Şifre gerekli', 'Onaylamak için şifreni yaz.');
      return;
    }
    setDeleting(true);
    try {
      const res = await apiFetch(`${API_URL}/me`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: deletePassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('Olmadı', data.error || 'Hesap silinemedi.');
        setDeleting(false);
        return;
      }
      await AsyncStorage.removeItem('userToken');
      await AsyncStorage.removeItem('pushToken');
      setDeleteModal(false);
      notify('Hesabın silindi', 'Tüm verilerin kalıcı olarak silindi. Görüşmek üzere!');
      navigation.reset({ index: 0, routes: [{ name: 'Auth' }] });
    } catch (e) {
      notify('Hata', 'Bağlantı sorunu yaşandı.');
    }
    setDeleting(false);
  };
  const POSITIONS = ['Kaleci', 'Defans - Stoper', 'Defans - Bek', 'Orta Saha - Ön Libero', 'Orta Saha - 8 Numara', 'Orta Saha - 10 Numara', 'Forvet - Kanat', 'Forvet - Santrafor'];

  useEffect(() => {
    if (user.id) {
      // Not: önceden kimlik bilgisi gönderilmediği için istatistikler hiç yüklenmiyordu.
      apiFetch(`${API_URL}/users/${user.id}/stats`)
        .then(res => res.json())
        .then(data => {
          if(data && !data.error) setStats(data);
        })
        .catch(err => console.log('Istatistik hatasi:', err));
    }
  }, [user.id]);

  const handleUpdatePosition = async (pos: string) => {
    try {
      const res = await apiFetch(`${API_URL}/users/${user.id}/position`, {
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

  const notify = (title: string, msg: string) => {
    if (Platform.OS === 'web') window.alert(`${title}\n\n${msg}`);
    else Alert.alert(title, msg);
  };

  // Bildirim testi: kaydı adım adım dener, sonra bu hesaba deneme bildirimi yollar ve sonucu gösterir.
  const testPush = async () => {
    setPushTesting(true);
    try {
      const setup = await setupPush();
      if (!setup.ok) {
        if (setup.canOpenSettings && Platform.OS !== 'web') {
          Alert.alert('Bildirim izni kapalı', setup.message, [
            { text: 'Vazgeç', style: 'cancel' },
            { text: 'Ayarları aç', onPress: () => Linking.openSettings() },
          ]);
        } else notify('Bildirim kurulamadı', setup.message);
        return;
      }
      const res = await apiFetch(`${API_URL}/push/test`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) return notify('Hata', data.error || 'Test bildirimi gönderilemedi.');
      if (data.sent > 0) notify('Gönderildi ✓', 'Telefon bu cihaz için kaydedildi. Test bildirimi birkaç saniye içinde gelmeli.');
      else if (data.errors?.length) notify('Bildirim gönderilemedi', explainPushError(String(data.errors[0])));
      else notify('Gönderilemedi', 'Bu hesap için kayıtlı cihaz bulunamadı.');
    } catch (e) {
      notify('Hata', 'Bağlantı sorunu yaşandı.');
    } finally {
      setPushTesting(false);
    }
  };

  const saveAvatar = async (value: string | null) => {
    setAvatarSaving(true);
    try {
      const res = await apiFetch(`${API_URL}/users/${user.id}/avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar: value }),
      });
      if (!res.ok) throw new Error('save failed');
      setAvatarUrl(value || '');
      user.avatar = value; // önceki ekranlara dönünce de güncel görünsün
      setAvatarModal(false);
    } catch (e) {
      notify('Hata', 'Avatar kaydedilemedi. Tekrar dener misin?');
    }
    setAvatarSaving(false);
  };

  const saveNickname = async () => {
    try {
      const res = await apiFetch(`${API_URL}/me/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: nickInput }),
      });
      const data = await res.json();
      if (!res.ok) return notify('Olmadı', data.error || 'Kaydedilemedi.');
      setNickname(data.nickname || '');
      user.nickname = data.nickname || null;
      setNickModal(false);
    } catch (e) {
      notify('Hata', 'Bağlantı sorunu yaşandı.');
    }
  };

  // Galeriden fotoğraf seç -> kare kırp -> 256 px'e küçült -> JPEG olarak kaydet.
  // Küçük tutuyoruz ki üye listeleri ve kadro hızlı yüklensin (yaklaşık 15-30 KB).
  const pickAvatar = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });
      if (result.canceled || !result.assets?.[0]) return;
      setAvatarModal(false);

      setAvatarSaving(true);
      const rendered = await ImageManipulator.manipulate(result.assets[0].uri).resize({ width: 256 }).renderAsync();
      const saved = await rendered.saveAsync({ compress: 0.7, format: SaveFormat.JPEG, base64: true });
      if (!saved.base64) throw new Error('no base64');
      const dataUrl = `data:image/jpeg;base64,${saved.base64}`;

      const res = await apiFetch(`${API_URL}/users/${user.id}/avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar: dataUrl })
      });
      if (!res.ok) throw new Error('save failed');
      setAvatarUrl(dataUrl);
      user.avatar = dataUrl; // önceki ekranlara dönünce de güncel görünsün
    } catch (e) {
      notify('Hata', 'Fotoğraf kaydedilemedi. Tekrar dener misin?');
    }
    setAvatarSaving(false);
  };

  const handleLogout = async () => {
    if (Platform.OS === 'web') {
      if (window.confirm('Hesabınızdan çıkmak istediğinize emin misiniz?')) {
        await unregisterPush();
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
            await unregisterPush();
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
          <TouchableOpacity activeOpacity={0.9} onPress={() => setAvatarModal(true)} disabled={avatarSaving}>
            <LinearGradient colors={['#FACC15', '#A16207']} style={styles.fifaCardBg}>
               <View style={styles.fifaCardInner}>
                 <View style={styles.fifaTopLeft}>
                    <Text style={styles.fifaOverall}>{stats.score}</Text>
                    <Text style={styles.fifaPosition}>{user.position ? user.position.split(' - ')[0].substring(0,3).toUpperCase() : 'ORT'}</Text>
                 </View>
                 <View style={styles.fifaAvatarContainer}>
                    {avatarSaving ? (
                      <ActivityIndicator color="#A16207" />
                    ) : (
                      <Avatar user={{ name: user.name, nickname }} avatar={avatarUrl || null} size={106} initialStyle={styles.fifaAvatarInitial} />
                    )}
                 </View>
                 <Text style={styles.fifaName} numberOfLines={1}>{displayName({ name: user.name, nickname })}</Text>
                 
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

          <TouchableOpacity onPress={() => { setNickInput(nickname); setNickModal(true); }} style={{marginTop: 12, flexDirection: 'row', alignItems: 'center'}}>
             <Text style={{color: '#94A3B8', fontSize: 13}}>Lakap: </Text>
             <Text style={{color: '#00E676', fontWeight: 'bold'}}>{nickname || 'Ekle'}</Text>
             <Ionicons name="pencil" size={14} color="#00E676" style={{marginLeft: 5}}/>
          </TouchableOpacity>
          <Text style={{ color: '#64748B', fontSize: 12, marginTop: 6 }}>
            Arkadaşların seni {nickname ? `"${nickname}"` : `"${shortName(user.name)}"`} olarak görür.
          </Text>

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
        <TouchableOpacity style={styles.editProfileButton} onPress={() => setAvatarModal(true)} disabled={avatarSaving}>
          <Text style={styles.editProfileText}>{avatarSaving ? 'Kaydediliyor...' : 'Fotoğraf / Avatar Değiştir'}</Text>
          <Ionicons name="happy-outline" size={20} color="#FFFFFF" style={{marginLeft: 10}} />
        </TouchableOpacity>

        {Platform.OS !== 'web' && (
          <TouchableOpacity style={[styles.editProfileButton, { marginTop: 12 }]} onPress={testPush} disabled={pushTesting}>
            <Text style={styles.editProfileText}>{pushTesting ? 'Deneniyor...' : 'Bildirimleri Test Et'}</Text>
            <Ionicons name="notifications-outline" size={20} color="#FFFFFF" style={{marginLeft: 10}} />
          </TouchableOpacity>
        )}

        <TouchableOpacity style={[styles.editProfileButton, { marginTop: 12 }]} onPress={() => setPasswordModal(true)}>
          <Text style={styles.editProfileText}>Şifre Değiştir</Text>
          <Ionicons name="key-outline" size={20} color="#FFFFFF" style={{marginLeft: 10}} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.deleteAccountButton} onPress={() => { setDeletePassword(''); setDeleteModal(true); }}>
          <Ionicons name="trash-outline" size={18} color="#F87171" style={{ marginRight: 8 }} />
          <Text style={styles.deleteAccountText}>Hesabımı Sil</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => Linking.openURL('https://sportarea.onrender.com/gizlilik')} style={{ alignItems: 'center', marginTop: 18 }}>
          <Text style={{ color: '#64748B', fontSize: 13, textDecorationLine: 'underline' }}>Gizlilik Politikası</Text>
        </TouchableOpacity>
        <Text style={{ color: '#64748B', fontSize: 12, textAlign: 'center', marginTop: 10 }}>{versionLabel()}</Text>

        <View style={{height: 50}} />
      </ScrollView>

      {/* Avatar seçimi: galeriden fotoğraf ya da emoji */}
      <Modal visible={avatarModal} transparent animationType="slide" onRequestClose={() => setAvatarModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Fotoğraf ya da avatar</Text>
            <TouchableOpacity style={styles.editProfileButton} onPress={pickAvatar} disabled={avatarSaving}>
              <Ionicons name="image-outline" size={20} color="#FFFFFF" style={{ marginRight: 10 }} />
              <Text style={styles.editProfileText}>Galeriden fotoğraf seç</Text>
            </TouchableOpacity>
            <Text style={{ color: '#94A3B8', fontSize: 13, marginTop: 18, marginBottom: 10 }}>ya da bir avatar seç</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' }}>
              {AVATAR_EMOJIS.map((e) => {
                const on = avatarUrl === `emoji:${e}`;
                return (
                  <TouchableOpacity key={e} onPress={() => saveAvatar(`emoji:${e}`)} disabled={avatarSaving}
                    style={[styles.emojiCell, on && { borderColor: '#00E676', backgroundColor: 'rgba(0,230,118,0.12)' }]}>
                    <Text style={{ fontSize: 28 }}>{e}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {avatarUrl ? (
              <TouchableOpacity onPress={() => saveAvatar(null)} style={{ alignItems: 'center', marginTop: 14 }} disabled={avatarSaving}>
                <Text style={{ color: '#94A3B8', textDecorationLine: 'underline' }}>Kaldır (baş harfim görünsün)</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setAvatarModal(false)}>
              <Text style={[styles.cancelBtnText, { color: '#CBD5E1' }]}>Kapat</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Lakap */}
      <Modal visible={nickModal} transparent animationType="slide" onRequestClose={() => setNickModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Lakap</Text>
            <Text style={{ color: '#94A3B8', textAlign: 'center', marginBottom: 14 }}>
              Kadroda ve listelerde adın yerine lakabın görünür. Boş bırakırsan "{shortName(user.name)}" görünür.
            </Text>
            <TextInput
              style={styles.nickInput}
              value={nickInput}
              onChangeText={setNickInput}
              placeholder="Örn: Kaptan, Bomber, Duvar"
              placeholderTextColor="#64748B"
              maxLength={20}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={saveNickname}
            />
            <TouchableOpacity style={[styles.editProfileButton, { backgroundColor: '#00E676', borderColor: '#00E676', marginTop: 14 }]} onPress={saveNickname}>
              <Text style={[styles.editProfileText, { color: '#0F172A' }]}>Kaydet</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setNickModal(false)}>
              <Text style={[styles.cancelBtnText, { color: '#CBD5E1' }]}>Vazgeç</Text>
            </TouchableOpacity>
          </View>
        </View>
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

      <ChangePasswordModal visible={passwordModal} onDone={() => setPasswordModal(false)} onCancel={() => setPasswordModal(false)} />

      {/* HESAP SİLME */}
      <Modal visible={deleteModal} transparent animationType="slide" onRequestClose={() => setDeleteModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={[styles.modalTitle, { color: '#F87171' }]}>Hesabını sil</Text>
            <Text style={styles.deleteInfo}>
              Adın, e-postan, fotoğrafın, grup üyeliklerin, maç cevapların, gollerin, puanların ve oyların kalıcı olarak silinir. Bu işlem geri alınamaz.
            </Text>
            <Text style={styles.deleteInfo}>
              Kurduğun bir grup varsa yöneticilik en eski üyeye geçer; grupta başka kimse yoksa grup da silinir.
            </Text>
            <TextInput
              style={styles.deleteInput}
              placeholder="Onaylamak için şifren"
              placeholderTextColor="#64748B"
              secureTextEntry
              value={deletePassword}
              onChangeText={setDeletePassword}
            />
            <TouchableOpacity style={styles.deleteConfirm} onPress={handleDeleteAccount} disabled={deleting}>
              {deleting ? <ActivityIndicator color="#0F172A" /> : <Text style={styles.deleteConfirmText}>Hesabımı kalıcı olarak sil</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setDeleteModal(false)}>
              <Text style={styles.cancelBtnText}>Vazgeç</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  deleteAccountButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 28, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(248, 113, 113, 0.4)' },
  deleteAccountText: { color: '#F87171', fontSize: 15, fontWeight: 'bold' },
  deleteInfo: { color: '#CBD5E1', fontSize: 14, lineHeight: 20, marginBottom: 10 },
  deleteInput: { backgroundColor: 'rgba(0,0,0,0.25)', color: '#FFFFFF', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginTop: 6, marginBottom: 14 },
  deleteConfirm: { backgroundColor: '#F87171', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  deleteConfirmText: { color: '#0F172A', fontWeight: 'bold', fontSize: 16 },
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
  cancelBtn: { paddingVertical: 15, alignItems: 'center' },
  emojiCell: { width: 52, height: 52, margin: 5, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  nickInput: { backgroundColor: 'rgba(0,0,0,0.25)', color: '#FFFFFF', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, fontSize: 17, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  cancelBtnText: { color: '#EF4444', fontSize: 16, fontWeight: 'bold' },
  positionOptionBtn: { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', alignItems: 'center' },
  positionOptionText: { color: '#00E676', fontSize: 16, fontWeight: '500' },
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
