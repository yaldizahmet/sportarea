import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { API_URL } from "../config/api";

export default function DashboardScreen({ route, navigation }: any) {
  const user = route.params?.user || { name: "Oyuncu", id: "tempId" };

  // Veriler
  const [matches, setMatches] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isNotificationsVisible, setIsNotificationsVisible] = useState(false);
  const [isMapModalVisible, setIsMapModalVisible] = useState(false);
  const [isCalendarModalVisible, setIsCalendarModalVisible] = useState(false);
  const [matchLocation, setMatchLocation] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [calendarDate, setCalendarDate] = useState<Date>(new Date());
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [maxPlayers, setMaxPlayers] = useState("14");
  const [matchTeamA, setMatchTeamA] = useState("");
  const [matchTeamB, setMatchTeamB] = useState("");

  const DATES = Array.from({length: 14}).map((_, i) => {
     const d = new Date();
     d.setDate(d.getDate() + i);
     const dayNames = ['Paz','Pzt','Sal','Çar','Per','Cum','Cmt'];
     return { 
       display: `${d.getDate()} ${dayNames[d.getDay()]}`, 
       full: `${d.getDate()}/${d.getMonth()+1} ${dayNames[d.getDay()]}`,
       val: d.toISOString().split('T')[0]
     };
  });
  const HOURS = ['18:00', '19:00', '20:00', '21:00', '22:00', '23:00', '00:00'];
  const POPULAR_PITCHES = [
    "Kadıköy Arena",
    "Levent Spor Kompleksi",
    "Beşiktaş Belediye Sahası",
    "Olimpik Halı Saha, Üsküdar",
    "Florya Halı Saha",
    "Göztepe Parkı Tesisleri",
    "Kadıköy Olimpik"
  ];
  const [lockoutHours, setLockoutHours] = useState("1");

  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  // Gruba Katıl Modal State'leri
  const [isJoinGroupModalVisible, setIsJoinGroupModalVisible] = useState(false);
  const [inviteCode, setInviteCode] = useState("");

  // Grup Kurma Modal State'leri
  const [isCreateGroupModalVisible, setIsCreateGroupModalVisible] =
    useState(false);
  const [groupName, setGroupName] = useState("");

  useEffect(() => {
    if (Platform.OS === 'web') {
      console.log("Map Picker message event listener registered!");
      const handleMapMessage = (event: any) => {
        console.log("PARENT RECEIVED RAW MESSAGE EVENT:", event);
        console.log("PARENT RECEIVED RAW MESSAGE DATA:", event.data);
        
        let data = event.data;
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
            console.log("PARSED STRING MESSAGE DATA TO JSON:", data);
          } catch (e) {
            // Not JSON string
          }
        }
        
        if (data && data.type === 'MAP_LOCATION_SELECTED') {
          const { location } = data;
          console.log("Selected Location Address successfully retrieved:", location.address);
          setMatchLocation(location.address);
          setIsMapModalVisible(false);
        }
      };
      window.addEventListener('message', handleMapMessage);
      return () => window.removeEventListener('message', handleMapMessage);
    }
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      fetchData();
    }, [])
  );

  const fetchData = async () => {
    try {
      const matchRes = await fetch(`${API_URL}/matches?userId=${user.id}`);
      const groupRes = await fetch(`${API_URL}/groups?userId=${user.id}`);
      const notifRes = await fetch(`${API_URL}/notifications?userId=${user.id}`);
      const mData = await matchRes.json();
      const gData = await groupRes.json();
      const nData = await notifRes.json();
      if (Array.isArray(mData)) setMatches(mData);
      if (Array.isArray(gData)) setGroups(gData);
      if (Array.isArray(nData)) setNotifications(nData);
    } catch (e) {
      console.log("Bağlantı hatası:", e);
    }
  };

  const handleOpenNotifications = async () => {
    setIsNotificationsVisible(true);
    try {
      await fetch(`${API_URL}/notifications/read`, { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ userId: user.id }) });
      setNotifications(prev => prev.map(n => ({...n, isRead: 1})));
    } catch(e) {}
  };

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    const days = [];
    let startDayOfWeek = firstDay.getDay(); 
    startDayOfWeek = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;

    for (let i = 0; i < startDayOfWeek; i++) {
      days.push(null);
    }

    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push(new Date(year, month, i));
    }
    
    return days;
  };

  const handleSelectCalendarDate = (date: Date) => {
    setCalendarDate(date);
    const dayNames = ['Paz','Pzt','Sal','Çar','Per','Cum','Cmt'];
    const formatted = `${date.getDate()}/${date.getMonth()+1} ${dayNames[date.getDay()]}`;
    setSelectedDate(formatted);
    setIsCalendarModalVisible(false);
  };

  const handleCreateMatch = async () => {
    let missingFields = [];
    if (!matchLocation) missingFields.push("Konum");
    if (!selectedDate) missingFields.push("Tarih");
    if (!selectedTime) missingFields.push("Saat");
    if (!maxPlayers) missingFields.push("Kişi Sayısı");

    if (missingFields.length > 0) {
      Alert.alert(
        "Eksik Bilgi",
        `Lütfen aşağıdaki alanları doldurun:\n\n- ${missingFields.join('\n- ')}`
      );
      return;
    }

    try {
      let matchTimestamp = 0;
      if (calendarDate) {
          const tParts = selectedTime.split(':');
          const dObj = new Date(calendarDate);
          dObj.setHours(parseInt(tParts[0]), parseInt(tParts[1]), 0);
          matchTimestamp = dObj.getTime();
      }

      const response = await fetch(`${API_URL}/matches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creatorId: user.id || null,
          groupId: selectedGroup,
          date: `${selectedDate}, ${selectedTime}`,
          time: selectedTime,
          location: matchLocation,
          maxPlayers: parseInt(maxPlayers),
          teamAName: matchTeamA || undefined,
          teamBName: matchTeamB || undefined,
          matchTimestamp: matchTimestamp,
          lockoutHours: parseInt(lockoutHours) || 1
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      Alert.alert("Tebrikler!", "Maç başarıyla oluşturuldu.");
      setIsModalVisible(false);
      setMatchLocation("");
      setSelectedDate("");
      setSelectedTime("");
      setMatchTeamA("");
      setMatchTeamB("");
      setMaxPlayers("14");
      fetchData(); // Yenile
    } catch (error: any) {
      Alert.alert("Hata", error.message || "Maç oluşturulamadı");
    }
  };

  const handleCreateGroup = async () => {
    if (!groupName) {
      Alert.alert("Eksik Bilgi", "Lütfen grup adını girin.");
      return;
    }

    try {
      const response = await fetch(`${API_URL}/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creatorId: user.id || null,
          name: groupName,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      Alert.alert(
        "Tebrikler!",
        `Grup başarıyla oluşturuldu!\nDavet Kodunuz: ${data.group.inviteCode}`,
      );
      setIsCreateGroupModalVisible(false);
      setGroupName("");
      fetchData(); // Yenile
    } catch (error: any) {
      Alert.alert("Hata", error.message || "Grup oluşturulamadı");
    }
  };

  const handleJoinGroup = async () => {
    if (!inviteCode) {
      Alert.alert("Eksik Bilgi", "Lütfen bir davet kodu girin.");
      return;
    }

    try {
      const response = await fetch(`${API_URL}/groups/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id || null,
          inviteCode: inviteCode.toUpperCase(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      Alert.alert("Tebrikler!", "Gruba başarıyla katıldınız.");
      setIsJoinGroupModalVisible(false);
      setInviteCode("");
      fetchData(); // Yenile
    } catch (error: any) {
      Alert.alert("Hata", error.message || "Gruba katılınamadı");
    }
  };

  const handleAcceptMatchInvite = async (n: any) => {
    try {
      if(n.metadata) {
         const meta = JSON.parse(n.metadata);
         const res = await fetch(`${API_URL}/matches/${meta.matchId}/join`, {
           method: "POST",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify({ userId: user.id })
         });
         const data = await res.json();
         
         if (res.ok) {
           await fetch(`${API_URL}/notifications/${n.id}`, { method: "DELETE" });
           setNotifications(prev => prev.filter(x => x.id !== n.id));
           Alert.alert("Başarılı", data.message || "Maça katıldınız!");
           fetchData();
         } else {
           Alert.alert("İşlem Başarısız", data.error || "Maça katılım süresi dolmuş olabilir.");
         }
      }
    } catch(e) {}
  };

  const handleRejectMatchInvite = async (n: any) => {
    try {
      await fetch(`${API_URL}/notifications/${n.id}`, { method: "DELETE" });
      setNotifications(prev => prev.filter(x => x.id !== n.id));
    } catch(e) {}
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Merhaba,</Text>
            <Text style={styles.userName}>{user.name}</Text>
          </View>
          <View style={{flexDirection: 'row', alignItems: 'center'}}>
            <TouchableOpacity style={{marginRight: 15, position: 'relative'}} onPress={handleOpenNotifications}>
               <Ionicons name="notifications-outline" size={28} color="#94A3B8" />
               {notifications.some(n => !n.isRead) && (
                 <View style={{position: 'absolute', top: 0, right: 2, width: 10, height: 10, borderRadius: 5, backgroundColor: '#EF4444', borderWidth: 2, borderColor: '#0F172A'}} />
               )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.profileAvatar}
              onPress={() => navigation.navigate("Profile", { user })}
            >
              <Ionicons name="person" size={24} color="#00E676" />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          style={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.quickActionsContainer}>
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => setIsModalVisible(true)}
            >
              <LinearGradient
                colors={["rgba(0, 230, 118, 0.15)", "rgba(0, 230, 118, 0.05)"]}
                style={styles.actionGradient}
              >
                <Ionicons name="football" size={20} color="#00E676" />
                <Text style={styles.actionText}>Maç Kur</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => setIsCreateGroupModalVisible(true)}
            >
              <LinearGradient
                colors={["rgba(255, 193, 7, 0.15)", "rgba(255, 193, 7, 0.05)"]}
                style={styles.actionGradient}
              >
                <Ionicons name="people" size={20} color="#FFC107" />
                <Text style={styles.actionText}>Grup Kur</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => navigation.navigate("Leaderboard", { user })}
            >
              <LinearGradient
                colors={["rgba(168, 85, 247, 0.15)", "rgba(168, 85, 247, 0.05)"]}
                style={styles.actionGradient}
              >
                <Ionicons name="trophy" size={20} color="#A855F7" />
                <Text style={styles.actionText}>Liderler</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Yaklaşan Maçlar</Text>
            <TouchableOpacity onPress={fetchData}>
              <Text style={styles.seeAllText}>Yenile</Text>
            </TouchableOpacity>
          </View>

          {matches.filter(m => m.status !== 'COMPLETED').length === 0 ? (
            <Text
              style={{
                color: "#A0A0A0",
                textAlign: "center",
                marginVertical: 20,
              }}
            >
              Yaklaşan maç bulunmuyor.
            </Text>
          ) : (
            matches.filter(m => m.status !== 'COMPLETED').map((match, index) => (
              <TouchableOpacity
                key={`upcoming-${index}`}
                activeOpacity={0.8}
                style={styles.singleRowCard}
                onPress={() => navigation.navigate("MatchDetails", { match, user })}
              >
                <View style={[styles.rowIconContainer, { borderColor: 'rgba(0, 230, 118, 0.3)' }]}>
                  <Ionicons name="football" size={20} color="#00E676" />
                </View>
                
                <View style={styles.rowMainInfo}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {match.location || 'Konum Belirtilmemiş'}
                  </Text>
                  <Text style={styles.rowSubtitle}>
                    {match.date || 'Tarih Belirtilmemiş'}
                  </Text>
                </View>

                <View style={styles.rowRightSection}>
                  {match.groupName && (
                    <View style={[styles.miniBadge, { backgroundColor: 'rgba(168, 85, 247, 0.15)', borderColor: 'rgba(168, 85, 247, 0.3)' }]}>
                      <Text style={[styles.miniBadgeText, { color: '#A855F7' }]}>{match.groupName}</Text>
                    </View>
                  )}
                  <View style={[styles.miniBadge, { backgroundColor: 'rgba(255, 255, 255, 0.05)', borderColor: 'rgba(255, 255, 255, 0.1)' }]}>
                    <Text style={[styles.miniBadgeText, { color: '#94A3B8' }]}>{match.maxPlayers} Kişi</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#64748B" style={{ marginLeft: 8 }} />
                </View>
              </TouchableOpacity>
            ))
          )}

          <View style={[styles.sectionHeader, {marginTop: 20}]}>
            <Text style={styles.sectionTitle}>Geçmiş Maçlar</Text>
          </View>

          {matches.filter(m => m.status === 'COMPLETED').length === 0 ? (
            <Text style={{color: "#A0A0A0", textAlign: "center", marginVertical: 20}}>
              Henüz tamamlanmış maç yok.
            </Text>
          ) : (
            matches.filter(m => m.status === 'COMPLETED').map((match, index) => (
              <TouchableOpacity
                key={`completed-${index}`}
                activeOpacity={0.8}
                style={[styles.singleRowCard, { opacity: 0.85 }]}
                onPress={() => navigation.navigate("MatchDetails", { match, user })}
              >
                <View style={[styles.rowIconContainer, { borderColor: 'rgba(255, 193, 7, 0.3)' }]}>
                  <Ionicons name="trophy" size={20} color="#FFC107" />
                </View>
                
                <View style={styles.rowMainInfo}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {match.location || 'Konum Belirtilmemiş'}
                  </Text>
                  <Text style={styles.rowSubtitle}>
                    {match.date || 'Tarih Belirtilmemiş'}
                  </Text>
                </View>

                <View style={styles.rowRightSection}>
                  {match.score ? (
                    <View style={[styles.miniBadge, { backgroundColor: 'rgba(255, 193, 7, 0.15)', borderColor: 'rgba(255, 193, 7, 0.4)' }]}>
                      <Text style={[styles.miniBadgeText, { color: '#FFC107', fontWeight: 'bold' }]}>Skor: {match.score}</Text>
                    </View>
                  ) : (
                    <View style={[styles.miniBadge, { backgroundColor: 'rgba(148, 163, 184, 0.15)', borderColor: 'rgba(148, 163, 184, 0.3)' }]}>
                      <Text style={[styles.miniBadgeText, { color: '#94A3B8' }]}>Bitti</Text>
                    </View>
                  )}
                  <Ionicons name="chevron-forward" size={16} color="#64748B" style={{ marginLeft: 8 }} />
                </View>
              </TouchableOpacity>
            ))
          )}

          <View style={[styles.sectionHeader, {marginTop: 30}]}>
            <Text style={styles.sectionTitle}>Gruplar</Text>
            <TouchableOpacity onPress={() => setIsJoinGroupModalVisible(true)} style={{flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(33, 150, 243, 0.1)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(33, 150, 243, 0.3)'}}>
              <Ionicons name="key-outline" size={14} color="#2196F3" style={{marginRight: 4}} />
              <Text style={{color: '#2196F3', fontSize: 13, fontWeight: 'bold'}}>Kodla Katıl</Text>
            </TouchableOpacity>
          </View>

          {groups.length === 0 ? (
            <Text
              style={{
                color: "#A0A0A0",
                textAlign: "center",
                marginVertical: 20,
              }}
            >
              Hiç grup bulunamadı. Yeni bir grup kurun!
            </Text>
          ) : (
            groups.map((group, index) => (
              <TouchableOpacity
                key={`group-${index}`}
                activeOpacity={0.8}
                style={styles.singleRowCard}
                onPress={() => navigation.navigate("GroupDetails", { group, user })}
              >
                <View style={[styles.rowIconContainer, { borderColor: 'rgba(33, 150, 243, 0.3)' }]}>
                  <Ionicons name="shield-checkmark" size={20} color="#2196F3" />
                </View>
                
                <View style={styles.rowMainInfo}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {group.name}
                  </Text>
                  <Text style={styles.rowSubtitle}>
                    Davet Kodu: {group.inviteCode}
                  </Text>
                </View>

                <View style={styles.rowRightSection}>
                  <View style={[styles.miniBadge, { backgroundColor: 'rgba(33, 150, 243, 0.15)', borderColor: 'rgba(33, 150, 243, 0.3)' }]}>
                    <Text style={[styles.miniBadgeText, { color: '#2196F3' }]}>Grup Üyesi</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#64748B" style={{ marginLeft: 8 }} />
                </View>
              </TouchableOpacity>
            ))
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>

      <Modal
        animationType="slide"
        transparent={true}
        visible={isModalVisible}
        onRequestClose={() => setIsModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Yeni Maç Kur</Text>
              <TouchableOpacity
                onPress={() => setIsModalVisible(false)}
                style={styles.closeModalButton}
              >
                <Ionicons name="close" size={28} color="#A0A0A0" />
              </TouchableOpacity>
            </View>

            <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 15}}>
              <View style={[styles.modalInputContainer, {flex: 1, marginBottom: 0}]}>
                <Ionicons
                  name="location-outline"
                  size={20}
                  color="#00E676"
                  style={styles.modalIcon}
                />
                <TextInput
                  style={styles.modalInput}
                  placeholder="Örn: Olimpik Halı Saha, Kadıköy"
                  placeholderTextColor="#A0A0A0"
                  value={matchLocation}
                  onChangeText={setMatchLocation}
                />
              </View>
              {Platform.OS === 'web' && (
                <TouchableOpacity 
                  style={{
                    backgroundColor: 'rgba(0, 230, 118, 0.1)', 
                    borderWidth: 1, 
                    borderColor: '#00E676', 
                    borderRadius: 16, 
                    height: 60, 
                    justifyContent: 'center', 
                    alignItems: 'center', 
                    paddingHorizontal: 15,
                    marginLeft: 10
                  }}
                  onPress={() => setIsMapModalVisible(true)}
                >
                  <Ionicons name="map-outline" size={24} color="#00E676" />
                  <Text style={{color: '#00E676', fontSize: 10, fontWeight: 'bold', marginTop: 2}}>Harita</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={{ marginBottom: 15 }}>
              <Text style={{color: '#94A3B8', marginBottom: 8, fontSize: 13}}>Popüler Sahalar (Hızlı Seçim)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {POPULAR_PITCHES.map((pitch, i) => (
                  <TouchableOpacity 
                    key={i} 
                    style={[styles.dateBubble, matchLocation === pitch ? styles.dateBubbleActive : {}]}
                    onPress={() => setMatchLocation(pitch)}
                  >
                    <Text style={[styles.dateBubbleText, matchLocation === pitch ? {color: '#000'} : {}]}>{pitch}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={{ marginBottom: 15 }}>
              <Text style={{color: '#94A3B8', marginBottom: 6, fontSize: 13}}>Tarih</Text>
              <TouchableOpacity 
                style={styles.modalInputContainer} 
                onPress={() => setIsCalendarModalVisible(true)}
              >
                <Ionicons
                  name="calendar-outline"
                  size={20}
                  color="#00E676"
                  style={styles.modalIcon}
                />
                <Text style={{ 
                  color: selectedDate ? '#FFFFFF' : '#A0A0A0', 
                  fontSize: 16,
                  flex: 1,
                  paddingTop: Platform.OS === 'web' ? 18 : 0
                }}>
                  {selectedDate || "Tarih Seçmek İçin Dokunun..."}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={{ marginBottom: 15 }}>
              <Text style={{color: '#94A3B8', marginBottom: 8, fontSize: 13}}>Saat Seçin</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {HOURS.map((h, i) => (
                  <TouchableOpacity 
                    key={i} 
                    style={[styles.timeBubble, selectedTime === h ? styles.timeBubbleActive : {}]}
                    onPress={() => setSelectedTime(h)}
                  >
                    <Text style={[styles.timeBubbleText, selectedTime === h ? {color: '#000'} : {}]}>{h}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={{ marginBottom: 15 }}>
              <Text style={{color: '#94A3B8', marginBottom: 8, fontSize: 13}}>İlişkili Grup (Opsiyonel)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <TouchableOpacity 
                  style={[styles.dateBubble, !selectedGroup ? styles.dateBubbleActive : {}]}
                  onPress={() => setSelectedGroup(null)}
                >
                  <Text style={[styles.dateBubbleText, !selectedGroup ? {color: '#000'} : {}]}>Genel Maç</Text>
                </TouchableOpacity>
                {groups.map((g, i) => (
                  <TouchableOpacity 
                    key={i} 
                    style={[styles.dateBubble, selectedGroup === g.id ? styles.dateBubbleActive : {}]}
                    onPress={() => setSelectedGroup(g.id)}
                  >
                    <Text style={[styles.dateBubbleText, selectedGroup === g.id ? {color: '#000'} : {}]}>{g.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.modalInputContainer}>
              <Ionicons
                name="people-outline"
                size={20}
                color="#00E676"
                style={styles.modalIcon}
              />
              <TextInput
                style={styles.modalInput}
                placeholder="Kişi Sayısı (Örn: 14)"
                placeholderTextColor="#A0A0A0"
                keyboardType="numeric"
                value={maxPlayers}
                onChangeText={setMaxPlayers}
              />
            </View>

            <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
              <View style={[styles.modalInputContainer, {flex: 0.48}]}>
                <Ionicons name="shirt-outline" size={18} color="#2196F3" style={styles.modalIcon} />
                <TextInput
                  style={styles.modalInput}
                  placeholder="A Takımı"
                  placeholderTextColor="#A0A0A0"
                  value={matchTeamA}
                  onChangeText={setMatchTeamA}
                />
              </View>
              <View style={[styles.modalInputContainer, {flex: 0.48}]}>
                <Ionicons name="shirt-outline" size={18} color="#F44336" style={styles.modalIcon} />
                <TextInput
                  style={styles.modalInput}
                  placeholder="B Takımı"
                  placeholderTextColor="#A0A0A0"
                  value={matchTeamB}
                  onChangeText={setMatchTeamB}
                />
              </View>
            </View>

            <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
               <TouchableOpacity style={[styles.createMatchButton, {flex: 0.48, backgroundColor: 'transparent', borderWidth: 1, borderColor: '#334155', borderRadius: 16}]} onPress={() => setIsModalVisible(false)}>
                  <View style={[styles.createMatchGradient, {backgroundColor: 'transparent'}]}>
                     <Text style={[styles.createMatchButtonText, {color: '#A0A0A0'}]}>Vazgeç</Text>
                  </View>
               </TouchableOpacity>

               <TouchableOpacity style={[styles.createMatchButton, {flex: 0.48, marginTop: 10}]} onPress={handleCreateMatch}>
                  <LinearGradient colors={["#00C853", "#B2FF59"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.createMatchGradient}>
                     <Text style={styles.createMatchButtonText}>Oluştur</Text>
                  </LinearGradient>
               </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        animationType="slide"
        transparent={true}
        visible={isCreateGroupModalVisible}
        onRequestClose={() => setIsCreateGroupModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Kendi Grubunu Kur</Text>
              <TouchableOpacity
                onPress={() => setIsCreateGroupModalVisible(false)}
                style={styles.closeModalButton}
              >
                <Ionicons name="close" size={28} color="#A0A0A0" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalInputContainer}>
              <Ionicons
                name="shield-checkmark"
                size={20}
                color="#FFC107"
                style={styles.modalIcon}
              />
              <TextInput
                style={styles.modalInput}
                placeholder="Grup Adı (Örn: Cuma Akşam Kadrosu)"
                placeholderTextColor="#A0A0A0"
                value={groupName}
                onChangeText={setGroupName}
              />
            </View>

            <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
               <TouchableOpacity style={[styles.createMatchButton, {flex: 0.48, backgroundColor: 'transparent', borderWidth: 1, borderColor: '#334155', borderRadius: 16}]} onPress={() => setIsCreateGroupModalVisible(false)}>
                  <View style={[styles.createMatchGradient, {backgroundColor: 'transparent'}]}>
                     <Text style={[styles.createMatchButtonText, {color: '#A0A0A0'}]}>Vazgeç</Text>
                  </View>
               </TouchableOpacity>

               <TouchableOpacity style={[styles.createMatchButton, {flex: 0.48, marginTop: 10}]} onPress={handleCreateGroup}>
                  <LinearGradient colors={["#FFC107", "#FFE082"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.createMatchGradient}>
                     <Text style={styles.createMatchButtonText}>Oluştur</Text>
                  </LinearGradient>
               </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        animationType="fade"
        transparent={true}
        visible={isJoinGroupModalVisible}
        onRequestClose={() => setIsJoinGroupModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Koda Göre Gruba Katıl</Text>
              <TouchableOpacity
                onPress={() => setIsJoinGroupModalVisible(false)}
                style={styles.closeModalButton}
              >
                <Ionicons name="close" size={28} color="#A0A0A0" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalInputContainer}>
              <Ionicons
                name="barcode-outline"
                size={20}
                color="#2196F3"
                style={styles.modalIcon}
              />
              <TextInput
                style={styles.modalInput}
                placeholder="Davet Kodu (Örn: CUMA20)"
                placeholderTextColor="#A0A0A0"
                value={inviteCode}
                onChangeText={setInviteCode}
                autoCapitalize="characters"
              />
            </View>

            <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
               <TouchableOpacity style={[styles.createMatchButton, {flex: 0.48, backgroundColor: 'transparent', borderWidth: 1, borderColor: '#334155', borderRadius: 16}]} onPress={() => setIsJoinGroupModalVisible(false)}>
                  <View style={[styles.createMatchGradient, {backgroundColor: 'transparent'}]}>
                     <Text style={[styles.createMatchButtonText, {color: '#A0A0A0'}]}>Vazgeç</Text>
                  </View>
               </TouchableOpacity>

               <TouchableOpacity style={[styles.createMatchButton, {flex: 0.48, marginTop: 10}]} onPress={handleJoinGroup}>
                  <LinearGradient colors={["#2196F3", "#64B5F6"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.createMatchGradient}>
                     <Text style={styles.createMatchButtonText}>KATIL</Text>
                  </LinearGradient>
               </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Map Picker Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={isMapModalVisible}
        onRequestClose={() => setIsMapModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { height: '80%', paddingBottom: 20 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Haritadan Saha Seç</Text>
              <TouchableOpacity
                onPress={() => setIsMapModalVisible(false)}
                style={styles.closeModalButton}
              >
                <Ionicons name="close" size={28} color="#A0A0A0" />
              </TouchableOpacity>
            </View>

            {Platform.OS === 'web' ? (
              <iframe
                style={{ width: '100%', height: '100%', minHeight: 450, borderRadius: 16, border: 'none' }}
                srcDoc={`
                  <!DOCTYPE html>
                  <html>
                  <head>
                    <meta charset="utf-8" />
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
                    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
                    <style>
                      html, body, #map {
                        height: 100%;
                        margin: 0;
                        padding: 0;
                        background-color: #0F172A;
                        font-family: system-ui, -apple-system, sans-serif;
                      }
                      #search-box {
                        position: absolute;
                        top: 15px;
                        left: 15px;
                        z-index: 1000;
                        background: #1E293B;
                        padding: 8px;
                        border-radius: 12px;
                        display: flex;
                        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                        border: 1px solid rgba(255,255,255,0.08);
                      }
                      #search-input {
                        background: rgba(0,0,0,0.2);
                        color: #FFF;
                        border: 1px solid rgba(255,255,255,0.1);
                        padding: 8px 12px;
                        border-radius: 8px;
                        outline: none;
                        width: 220px;
                        font-size: 14px;
                      }
                      #search-btn {
                        background: #00E676;
                        border: none;
                        padding: 8px 16px;
                        color: #000;
                        font-weight: bold;
                        border-radius: 8px;
                        margin-left: 8px;
                        cursor: pointer;
                        font-size: 14px;
                        transition: all 0.2s;
                      }
                      #search-btn:hover {
                        opacity: 0.9;
                      }
                      #select-btn {
                        position: absolute;
                        bottom: 25px;
                        left: 50%;
                        transform: translateX(-50%);
                        z-index: 1000;
                        background: #00E676;
                        color: #000;
                        border: none;
                        padding: 14px 28px;
                        font-size: 16px;
                        font-weight: bold;
                        border-radius: 30px;
                        cursor: pointer;
                        box-shadow: 0 8px 25px rgba(0,230,118,0.4);
                        transition: transform 0.2s;
                      }
                      #select-btn:active {
                        transform: translateX(-50%) scale(0.95);
                      }
                      .leaflet-popup-content-wrapper {
                        background-color: #1E293B;
                        color: #FFF;
                        border: 1px solid rgba(255,255,255,0.1);
                        border-radius: 12px;
                      }
                      .leaflet-popup-tip {
                        background-color: #1E293B;
                      }
                      .leaflet-control-zoom {
                        border: 1px solid rgba(255,255,255,0.1) !important;
                        box-shadow: 0 4px 20px rgba(0,0,0,0.3) !important;
                      }
                      .leaflet-control-zoom-in, .leaflet-control-zoom-out {
                        background-color: #1E293B !important;
                        color: #FFF !important;
                        border-bottom: 1px solid rgba(255,255,255,0.1) !important;
                      }
                    </style>
                  </head>
                  <body>
                    <div id="search-box">
                      <input type="text" id="search-input" placeholder="Saha, mahalle veya ilçe ara..." />
                      <button id="search-btn">Ara</button>
                    </div>
                    <button id="select-btn" style="display:none;">Bu Konumu Seç ⚽</button>
                    <div id="map"></div>

                    <script>
                      var map = L.map('map').setView([41.0082, 28.9784], 12);
                      
                      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                        maxZoom: 19,
                        attribution: '© OpenStreetMap'
                      }).addTo(map);

                      var marker;
                      var selectedLocation = null;

                      function onMapClick(e) {
                        var lat = e.latlng.lat;
                        var lng = e.latlng.lng;
                        console.log("Map clicked at coordinate:", lat, lng);
                        
                        if (marker) {
                          marker.setLatLng(e.latlng);
                        } else {
                          marker = L.marker(e.latlng).addTo(map);
                        }

                        document.getElementById('select-btn').style.display = 'block';

                        selectedLocation = {
                          address: lat.toFixed(5) + ", " + lng.toFixed(5),
                          lat: lat,
                          lon: lng
                        };
                        marker.bindPopup("Yükleniyor...").openPopup();

                        fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lng + '&accept-language=tr')
                          .then(response => response.json())
                          .then(data => {
                            var name = data.display_name;
                            var addressParts = [];
                            
                            if (data.address.amenity) addressParts.push(data.address.amenity);
                            else if (data.address.leisure) addressParts.push(data.address.leisure);
                            else if (data.address.stadium) addressParts.push(data.address.stadium);
                            else if (data.address.road) addressParts.push(data.address.road);
                            
                            if (data.address.suburb) addressParts.push(data.address.suburb);
                            else if (data.address.neighbourhood) addressParts.push(data.address.neighbourhood);
                            
                            if (data.address.town) addressParts.push(data.address.town);
                            else if (data.address.city_district) addressParts.push(data.address.city_district);
                            else if (data.address.city) addressParts.push(data.address.city);

                            var shortAddress = addressParts.join(', ') || name;
                            selectedLocation = {
                              address: shortAddress,
                              lat: lat,
                              lon: lng
                            };

                            marker.bindPopup("<b style='color:#00E676; font-size:14px;'>Seçilen Konum:</b><br/><span style='font-size:12px;'>" + shortAddress + "</span>").openPopup();
                          })
                          .catch(err => {
                            selectedLocation = {
                              address: lat.toFixed(4) + ", " + lng.toFixed(4),
                              lat: lat,
                              lon: lng
                            };
                            marker.bindPopup("Koordinat: " + lat.toFixed(4) + ", " + lng.toFixed(4)).openPopup();
                          });
                      }

                      map.on('click', onMapClick);

                      document.getElementById('search-btn').addEventListener('click', function() {
                        var query = document.getElementById('search-input').value;
                        if (!query) return;
                        fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(query) + '&accept-language=tr')
                          .then(response => response.json())
                          .then(results => {
                            if (results && results.length > 0) {
                              var first = results[0];
                              var latlng = [parseFloat(first.lat), parseFloat(first.lon)];
                              map.setView(latlng, 15);
                              onMapClick({ latlng: L.latLng(latlng[0], latlng[1]) });
                            } else {
                              alert('Konum bulunamadı.');
                            }
                          });
                      });

                      document.getElementById('search-input').addEventListener('keypress', function(e) {
                        if (e.key === 'Enter') {
                          document.getElementById('search-btn').click();
                        }
                      });

                      document.getElementById('select-btn').addEventListener('click', function() {
                        if (selectedLocation) {
                          var payload = {
                            type: 'MAP_LOCATION_SELECTED',
                            location: selectedLocation
                          };
                          console.log('Sending MAP_LOCATION_SELECTED from iframe:', payload);
                          // Post both as raw object and as stringified JSON
                          window.parent.postMessage(payload, '*');
                          window.parent.postMessage(JSON.stringify(payload), '*');
                        }
                      });
                    </script>
                  </body>
                  </html>
                `}
              />
            ) : (
              <Text style={{ color: '#FFF', textAlign: 'center', marginTop: 20 }}>Harita yalnızca web tarayıcısında kullanılabilir.</Text>
            )}
          </View>
        </View>
      </Modal>

      {/* Calendar Picker Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={isCalendarModalVisible}
        onRequestClose={() => setIsCalendarModalVisible(false)}
      >
        <View style={[styles.modalOverlay, { justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0, 0, 0, 0.8)' }]}>
          <View style={[styles.modalContent, { 
            width: Platform.OS === 'web' ? 360 : '90%', 
            borderRadius: 24, 
            borderWidth: 1, 
            borderColor: 'rgba(0, 230, 118, 0.3)',
            padding: 20,
            paddingBottom: 25,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            borderTopWidth: 1,
            borderTopColor: "rgba(0, 230, 118, 0.3)",
          }]}>
            <View style={[styles.modalHeader, { marginBottom: 15 }]}>
              <Text style={styles.modalTitle}>Tarih Seç</Text>
              <TouchableOpacity
                onPress={() => setIsCalendarModalVisible(false)}
                style={styles.closeModalButton}
              >
                <Ionicons name="close" size={28} color="#A0A0A0" />
              </TouchableOpacity>
            </View>

            <View style={{ backgroundColor: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <TouchableOpacity onPress={() => {
                  const d = new Date(currentMonth);
                  d.setMonth(d.getMonth() - 1);
                  setCurrentMonth(d);
                }} style={{ padding: 8 }}>
                  <Ionicons name="chevron-back" size={20} color="#00E676" />
                </TouchableOpacity>
                <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 16 }}>
                  {(() => {
                    const months = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
                    return `${months[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
                  })()}
                </Text>
                <TouchableOpacity onPress={() => {
                  const d = new Date(currentMonth);
                  d.setMonth(d.getMonth() + 1);
                  setCurrentMonth(d);
                }} style={{ padding: 8 }}>
                  <Ionicons name="chevron-forward" size={20} color="#00E676" />
                </TouchableOpacity>
              </View>

              <View style={{ flexDirection: 'row', marginBottom: 8 }}>
                {["Pt", "Sa", "Ça", "Pe", "Cu", "Ct", "Pz"].map((w, i) => (
                  <Text key={i} style={{ width: '14.28%', color: '#64748B', fontSize: 11, fontWeight: 'bold', textAlign: 'center' }}>{w}</Text>
                ))}
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {(() => {
                  const days = getDaysInMonth(currentMonth);
                  return days.map((day, i) => {
                    if (!day) return <View key={`empty-${i}`} style={{ width: '14.28%', height: 36 }} />;
                    
                    const isSelected = calendarDate && 
                      day.getDate() === calendarDate.getDate() && 
                      day.getMonth() === calendarDate.getMonth() && 
                      day.getFullYear() === calendarDate.getFullYear();
                      
                    const isToday = (() => {
                      const today = new Date();
                      return day.getDate() === today.getDate() && 
                        day.getMonth() === today.getMonth() && 
                        day.getFullYear() === today.getFullYear();
                    })();

                    const isPast = (() => {
                      const today = new Date();
                      today.setHours(0,0,0,0);
                      return day < today;
                    })();

                    return (
                      <TouchableOpacity
                        key={`day-${i}`}
                        disabled={isPast}
                        style={{
                          width: '14.28%',
                          height: 36,
                          justifyContent: 'center',
                          alignItems: 'center',
                          borderRadius: 8,
                          backgroundColor: isSelected ? '#00E676' : 'transparent',
                          borderWidth: isToday ? 1 : 0,
                          borderColor: '#00E676',
                          opacity: isPast ? 0.25 : 1
                        }}
                        onPress={() => handleSelectCalendarDate(day)}
                      >
                        <Text style={{
                          color: isSelected ? '#000' : '#FFF',
                          fontWeight: 'bold',
                          fontSize: 13
                        }}>
                          {day.getDate()}
                        </Text>
                      </TouchableOpacity>
                    );
                  });
                })()}
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Notifications Modal */}
      <Modal visible={isNotificationsVisible} transparent animationType="slide">
         <View style={{flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', paddingTop: 60}}>
            <View style={{flex: 1, backgroundColor: '#1E293B', borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 25}}>
               <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20}}>
                 <Text style={{fontSize: 22, fontWeight: 'bold', color: '#FFF'}}>Bildirimler</Text>
                 <TouchableOpacity onPress={() => setIsNotificationsVisible(false)}>
                   <Ionicons name="close" size={28} color="#A0A0A0" />
                 </TouchableOpacity>
               </View>
               
               <ScrollView>
                 {notifications.length === 0 ? (
                   <Text style={{color: '#94A3B8', textAlign: 'center', marginTop: 50}}>Henüz bir bildiriminiz yok.</Text>
                 ) : (
                   notifications.map((n, i) => (
                     <View key={i} style={{backgroundColor: 'rgba(255,255,255,0.05)', padding: 15, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)'}}>
                        <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 5}}>
                           <Ionicons name={n.type === 'MATCH_INVITE' ? "mail-unread" : (n.type === 'MATCH_RESULT' ? "football" : "information-circle")} size={16} color={n.type === 'MATCH_INVITE' ? '#A855F7' : (n.type === 'MATCH_RESULT' ? '#FFC107' : '#00E676')} />
                           <Text style={{color: '#94A3B8', fontSize: 12, marginLeft: 6}}>{new Date(n.createdAt).toLocaleDateString()} {new Date(n.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</Text>
                        </View>
                        <Text style={{color: '#FFF', fontSize: 14, lineHeight: 20}}>{n.message}</Text>
                        
                        {n.type === 'MATCH_INVITE' && (
                          <View style={{flexDirection: 'row', marginTop: 15, justifyContent: 'space-between'}}>
                             <TouchableOpacity style={{flex: 0.48, backgroundColor: 'rgba(244, 67, 54, 0.1)', paddingVertical: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(244, 67, 54, 0.3)'}} onPress={() => handleRejectMatchInvite(n)}>
                               <Text style={{color: '#F44336', fontWeight: 'bold', fontSize: 13}}>Reddet</Text>
                             </TouchableOpacity>
                             <TouchableOpacity style={{flex: 0.48, backgroundColor: '#00E676', paddingVertical: 10, borderRadius: 8, alignItems: 'center'}} onPress={() => handleAcceptMatchInvite(n)}>
                               <Text style={{color: '#000', fontWeight: 'bold', fontSize: 13}}>Kabul Et</Text>
                             </TouchableOpacity>
                          </View>
                        )}
                     </View>
                   ))
                 )}
               </ScrollView>
            </View>
         </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#0F172A", ...(Platform.OS === 'web' ? { height: '100vh' as any, overflow: 'auto' as any } : {}) },
  container: { flex: 1, paddingHorizontal: 20, backgroundColor: "#0F172A" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 20,
  },
  greeting: { fontSize: 16, color: "#94A3B8" },
  userName: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#FFFFFF",
    marginTop: 4,
  },
  profileAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(0, 230, 118, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(0, 230, 118, 0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  scrollContent: { flex: 1 },
  quickActionsContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
    marginTop: 5,
  },
  actionCard: {
    width: "32%",
    height: 48,
    borderRadius: 12,
    overflow: "hidden",
  },
  actionGradient: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    borderRadius: 12,
  },
  actionText: {
    color: "#FFFFFF",
    marginLeft: 6,
    fontWeight: "bold",
    fontSize: 13,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
    marginTop: 10,
  },
  sectionTitle: { fontSize: 20, fontWeight: "bold", color: "#FFFFFF" },
  seeAllText: { color: "#00E676", fontSize: 14, fontWeight: "600" },
  matchCard: {
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 25,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  matchGradient: {
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    borderRadius: 20,
  },
  matchHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
  },
  badge: {
    backgroundColor: "rgba(0, 230, 118, 0.2)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(0, 230, 118, 0.5)",
  },
  badgeText: { color: "#00E676", fontSize: 12, fontWeight: "bold" },
  matchDate: { color: "#94A3B8", fontSize: 14 },
  matchLocation: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  matchFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
    paddingTop: 15,
  },
  playerCount: { flexDirection: "row", alignItems: "center" },
  playerCountText: { color: "#A0A0A0", marginLeft: 8, fontSize: 14 },
  joinButton: {
    backgroundColor: "#00E676",
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 12,
  },
  joinButtonText: { color: "#000000", fontWeight: "bold", fontSize: 14 },
  groupCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderRadius: 16,
    padding: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
  },
  groupIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.05)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 15,
    borderWidth: 1,
    borderColor: "rgba(0, 230, 118, 0.3)",
  },
  groupInfo: { flex: 1 },
  groupName: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  groupRole: { color: "#94A3B8", fontSize: 13 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#1E293B",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    padding: 25,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: "rgba(0, 230, 118, 0.3)",
    shadowColor: "#00E676",
    shadowOffset: { width: 0, height: -5 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 20,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 25,
  },
  modalTitle: { fontSize: 22, fontWeight: "bold", color: "#FFFFFF" },
  closeModalButton: { padding: 5 },
  modalInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    borderRadius: 16,
    height: 60,
    marginBottom: 15,
    paddingHorizontal: 20,
  },
  modalIcon: { marginRight: 15 },
  modalInput: { flex: 1, color: "#FFFFFF", fontSize: 16 },
  createMatchButton: {
    marginTop: 15,
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#00E676",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  createMatchGradient: { paddingVertical: 18, alignItems: "center" },
  createMatchButtonText: {
    color: "#000000",
    fontSize: 18,
    fontWeight: "bold",
    letterSpacing: 1,
  },
  dateBubble: { backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 15, paddingVertical: 10, borderRadius: 12, marginRight: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  dateBubbleActive: { backgroundColor: '#00E676', borderColor: '#00E676' },
  dateBubbleText: { color: '#E2E8F0', fontWeight: 'bold' },
  timeBubble: { backgroundColor: 'rgba(33, 150, 243, 0.1)', paddingHorizontal: 15, paddingVertical: 10, borderRadius: 12, marginRight: 10, borderWidth: 1, borderColor: 'rgba(33, 150, 243, 0.2)' },
  timeBubbleActive: { backgroundColor: '#2196F3', borderColor: '#2196F3' },
  timeBubbleText: { color: '#E2E8F0', fontWeight: 'bold' },
  singleRowCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
  },
  rowIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
    borderWidth: 1,
  },
  rowMainInfo: {
    flex: 1,
  },
  rowTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 4,
  },
  rowSubtitle: {
    color: "#94A3B8",
    fontSize: 13,
  },
  rowRightSection: {
    flexDirection: "row",
    alignItems: "center",
  },
  miniBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 0.5,
    marginLeft: 6,
  },
  miniBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
});
