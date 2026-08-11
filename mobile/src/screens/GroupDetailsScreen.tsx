import { apiFetch } from '../utils/api';
import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  ScrollView, 
  TouchableOpacity,
  Alert,
  Share,
  TextInput,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { API_URL } from '../config/api';

export default function GroupDetailsScreen({ route, navigation }: any) {
  const user = route.params?.user || { id: 'tempId', name: 'User' };
  const group = route.params?.group || {};
  
  const [members, setMembers] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'MEMBERS' | 'CHAT'>('MEMBERS');

  useEffect(() => {
    if(group.id) {
      fetchMembers();
      fetchMessages();
      const interval = setInterval(fetchMessages, 5000);
      return () => clearInterval(interval);
    }
  }, [group.id]);

  const fetchMembers = async () => {
    try {
      const res = await apiFetch(`${API_URL}/groups/${group.id}/members`);
      const data = await res.json();
      if(Array.isArray(data)) {
        setMembers(data);
      }
    } catch(e) {
      console.log('Uyeler getirilemedi', e);
    }
  };

  const fetchMessages = async () => {
    try {
      const res = await apiFetch(`${API_URL}/groups/${group.id}/messages`);
      const data = await res.json();
      if(Array.isArray(data)) setMessages(data);
    } catch(e) {}
  };

  const sendMessage = async () => {
    if(!newMessage.trim()) return;
    try {
       await apiFetch(`${API_URL}/groups/${group.id}/messages`, {
         method: 'POST',
         headers: {'Content-Type': 'application/json'},
         body: JSON.stringify({ message: newMessage })
       });
       setNewMessage('');
       fetchMessages();
    } catch(e) {}
  };

  const handleCopyCode = async () => {
    try {
      await Share.share({
        message: `SporArea'da oluşturduğum '${group.name}' grubuna katıl!\nDavet Kodum: ${group.inviteCode}\n\nUygulamayı indir ve hemen futbol heyecanına başla!`
      });
    } catch (error) {
      Alert.alert('Hata', 'Paylaşım yapılamadı.');
    }
  };

  const handleCancelGroup = async () => {
    const performCancel = async () => {
      try {
        const res = await apiFetch(`${API_URL}/groups/${group.id}`, {
          method: "DELETE"
        });
        const data = await res.json();
        if (res.ok) {
          Alert.alert("Başarılı", "Grup başarıyla iptal edildi ve silindi.");
          navigation.goBack();
        } else {
          Alert.alert("Hata", data.error || "Grup iptal edilemedi.");
        }
      } catch (e) {
        Alert.alert("Hata", "Bağlantı sorunu yaşandı.");
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm("Bu grubu iptal etmek ve gruba ait tüm sohbet mesajlarını kalıcı olarak silmek istediğinize emin misiniz?")) {
        await performCancel();
      }
    } else {
      Alert.alert(
        "Grubu İptal Et ❌",
        "Bu grubu iptal etmek ve gruba ait tüm sohbet mesajlarını silmek istediğinize emin misiniz?",
        [
          { text: "Vazgeç", style: "cancel" },
          { text: "Evet, İptal Et", style: "destructive", onPress: performCancel }
        ]
      );
    }
  };

  const isCreatorPattern = (memberId: string) => {
    // Just for UI mockup, you can actually verify matching group.creatorId in a real scenario
    return memberId === group.creatorId; 
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Grup Detayları</Text>
        <TouchableOpacity style={styles.settingsButton}>
          <Ionicons name="settings-outline" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        
        <LinearGradient colors={['rgba(0, 230, 118, 0.15)', 'rgba(0, 230, 118, 0.05)']} style={styles.heroCard}>
          <View style={styles.heroIconContainer}>
            <Ionicons name="shield-checkmark" size={40} color="#00E676" />
          </View>
          <Text style={styles.groupName}>{String(group.name || 'İsimsiz Grup')}</Text>
          <Text style={styles.groupRole}>Kulüp</Text>
          
          <View style={styles.statsContainer}>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{String(members.length)}</Text>
              <Text style={styles.statLabel}>Üye</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>-</Text>
              <Text style={styles.statLabel}>Maç</Text>
            </View>
          </View>
        </LinearGradient>

        <View style={styles.inviteContainer}>
          <View style={styles.inviteInfo}>
            <Text style={styles.inviteLabel}>Davet Kodu</Text>
            <Text style={styles.inviteCode}>{String(group.inviteCode || 'YOK')}</Text>
          </View>
          <TouchableOpacity style={styles.copyButton} onPress={handleCopyCode}>
            <Ionicons name="copy-outline" size={20} color="#00E676" />
            <Text style={styles.copyButtonText}>Kopyala</Text>
          </TouchableOpacity>
        </View>

        <View style={{flexDirection: 'row', marginTop: 20, marginBottom: 10, paddingHorizontal: 20}}>
           <TouchableOpacity style={[styles.tabBtn, activeTab === 'MEMBERS' && styles.activeTabBtn]} onPress={() => setActiveTab('MEMBERS')}>
              <Text style={[styles.tabText, activeTab === 'MEMBERS' && styles.activeTabText]}>Üyeler</Text>
           </TouchableOpacity>
           <TouchableOpacity style={[styles.tabBtn, activeTab === 'CHAT' && styles.activeTabBtn]} onPress={() => setActiveTab('CHAT')}>
              <Text style={[styles.tabText, activeTab === 'CHAT' && styles.activeTabText]}>Grup Sohbeti</Text>
           </TouchableOpacity>
        </View>

        {activeTab === 'MEMBERS' ? (
          <View style={styles.membersContainer}>
            {members.length === 0 ? (
              <Text style={{color: '#A0A0A0', textAlign: 'center'}}>Henüz üye yok.</Text>
            ) : (
              <>{members.map((member, idx) => {
                const isCreator = isCreatorPattern(member.id);
                return (
                  <View key={idx} style={styles.memberCard}>
                    <View style={styles.memberLeft}>
                      <View style={[styles.memberAvatar, isCreator ? styles.founderAvatar : null]}>
                        <Text style={styles.memberInitial}>{String(member.name?.charAt(0) || 'U')}</Text>
                      </View>
                      <View>
                        <Text style={styles.memberName}>{String(member.name)}</Text>
                        <Text style={styles.memberRole}>{isCreator ? 'Kurucu' : 'Oyuncu'}</Text>
                      </View>
                    </View>
                    <View style={styles.memberStats}>
                      <Ionicons name="football" size={14} color="#A0A0A0" />
                      <Text style={styles.memberMatches}>{String(member.matches || 0)} Maç</Text>
                    </View>
                  </View>
                );
              })}</>
            )}
          </View>
        ) : (
          <View style={styles.chatContainer}>
             {messages.length === 0 ? (
               <Text style={{color: '#94A3B8', textAlign: 'center', marginVertical: 30}}>Henüz mesaj yok. İlk mesajı siz gönderin!</Text>
             ) : (
               messages.map((msg, i) => (
                 <View key={i} style={[styles.msgBubble, msg.userId === user.id ? styles.myMsg : styles.theirMsg]}>
                   {msg.userId !== user.id && <Text style={styles.msgUser}>{msg.userName}</Text>}
                   <Text style={{color: '#FFF'}}>{msg.message}</Text>
                   <Text style={styles.msgTime}>{new Date(msg.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</Text>
                 </View>
               ))
             )}
             
             <View style={styles.chatInputContainer}>
                <TextInput 
                  style={styles.chatInput}
                  placeholder="Grupla paylaş..."
                  placeholderTextColor="#94A3B8"
                  value={newMessage}
                  onChangeText={setNewMessage}
                />
                <TouchableOpacity style={styles.sendBtn} onPress={sendMessage}>
                  <Ionicons name="send" size={20} color="#FFF" />
                </TouchableOpacity>
             </View>
          </View>
        )}

        {user.id === group.creatorId && (
          <TouchableOpacity 
            style={styles.cancelGroupButton} 
            onPress={handleCancelGroup}
          >
            <LinearGradient 
              colors={["#EF4444", "#DC2626"]} 
              start={{ x: 0, y: 0 }} 
              end={{ x: 1, y: 0 }} 
              style={styles.cancelGroupGradient}
            >
              <Ionicons name="trash-outline" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.cancelGroupButtonText}>GRUBU İPTAL ET</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}

        <View style={{height: 40}} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0F172A', ...(Platform.OS === 'web' ? { height: '100vh' as any, overflow: 'auto' as any } : {}) },
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
  heroCard: {
    alignItems: 'center',
    padding: 25,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(0, 230, 118, 0.3)',
    marginTop: 10,
    shadowColor: '#00E676',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 15,
    elevation: 8,
  },
  heroIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(0, 230, 118, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 15,
    borderWidth: 1,
    borderColor: 'rgba(0, 230, 118, 0.4)',
  },
  groupName: { color: '#FFFFFF', fontSize: 24, fontWeight: 'bold', marginBottom: 5 },
  groupRole: { color: '#00E676', fontSize: 15, fontWeight: '600', marginBottom: 20 },
  statsContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 16, paddingVertical: 15, paddingHorizontal: 30, width: '100%', justifyContent: 'space-evenly' },
  statBox: { alignItems: 'center' },
  statNumber: { color: '#FFFFFF', fontSize: 22, fontWeight: 'bold' },
  statLabel: { color: '#94A3B8', fontSize: 13, marginTop: 4 },
  statDivider: { width: 1, height: 30, backgroundColor: 'rgba(255,255,255,0.1)' },
  inviteContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 16, padding: 20, marginTop: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  inviteInfo: { flex: 1 },
  inviteLabel: { color: '#94A3B8', fontSize: 13, marginBottom: 5 },
  inviteCode: { color: '#FFFFFF', fontSize: 18, fontWeight: 'bold', letterSpacing: 2 },
  copyButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0, 230, 118, 0.15)', paddingHorizontal: 15, paddingVertical: 10, borderRadius: 12 },
  copyButtonText: { color: '#00E676', marginLeft: 6, fontWeight: 'bold' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 30, marginBottom: 15 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#FFFFFF' },
  seeAllText: { color: '#00E676', fontSize: 14, fontWeight: '600' },
  membersContainer: { backgroundColor: 'rgba(255, 255, 255, 0.03)', borderRadius: 20, padding: 15, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.05)' },
  memberCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.03)', paddingBottom: 15 },
  memberLeft: { flexDirection: 'row', alignItems: 'center' },
  memberAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#334155', justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  founderAvatar: { backgroundColor: 'rgba(0, 230, 118, 0.2)', borderWidth: 1, borderColor: '#00E676' },
  memberInitial: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 18 },
  memberName: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  memberRole: { color: '#94A3B8', fontSize: 13, marginTop: 2 },
  memberStats: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  memberMatches: { color: '#E2E8F0', fontSize: 13, marginLeft: 6, fontWeight: '500' },

  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  activeTabBtn: { borderBottomColor: '#00E676' },
  tabText: { color: '#94A3B8', fontWeight: 'bold' },
  activeTabText: { color: '#00E676' },

  chatContainer: { backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 16, padding: 15, marginTop: 10 },
  msgBubble: { padding: 12, borderRadius: 16, marginBottom: 10, maxWidth: '85%' },
  myMsg: { backgroundColor: '#00E676', alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  theirMsg: { backgroundColor: '#334155', alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  msgUser: { color: '#FACC15', fontSize: 12, fontWeight: 'bold', marginBottom: 4 },
  msgTime: { color: 'rgba(255,255,255,0.5)', fontSize: 10, alignSelf: 'flex-end', marginTop: 4 },

  chatInputContainer: { flexDirection: 'row', marginTop: 15, alignItems: 'center' },
  chatInput: { flex: 1, backgroundColor: '#1E293B', borderRadius: 20, paddingHorizontal: 15, paddingVertical: 10, color: '#FFF', borderWidth: 1, borderColor: '#334155' },
  sendBtn: { backgroundColor: '#00E676', width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginLeft: 10 },
  cancelGroupButton: {
    marginHorizontal: 20,
    marginTop: 25,
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#EF4444",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  cancelGroupGradient: { 
    paddingVertical: 15, 
    flexDirection: 'row', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  cancelGroupButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "bold",
  },
});
