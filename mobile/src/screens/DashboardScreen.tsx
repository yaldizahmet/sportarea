import { apiFetch } from '../utils/api';
import React, { useState, useEffect } from "react";
import * as Notifications from "expo-notifications";
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
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { API_URL } from "../config/api";
import { formatMatchDate, formatWeekly, isPastMatch, DAY_NAMES_SHORT, formatMoney, shareOf } from "../utils/format";
import ChangePasswordModal from "../components/ChangePasswordModal";
import { registerForPush, matchIdFromResponse } from "../utils/push";
import { consumePendingInvite, consumePendingMatch } from "../utils/invite";
import Avatar from "../components/Avatar";

// Maç kartında "benim cevabım" rozeti
const MY_STATUS_BADGE: Record<string, { label: string; color: string; bg: string; border: string }> = {
  ACTIVE:   { label: 'Varım',     color: '#00E676', bg: 'rgba(0, 230, 118, 0.15)',  border: 'rgba(0, 230, 118, 0.4)' },
  RESERVE:  { label: 'Yedek',     color: '#38BDF8', bg: 'rgba(56, 189, 248, 0.15)', border: 'rgba(56, 189, 248, 0.4)' },
  MAYBE:    { label: 'Belki',     color: '#FFC107', bg: 'rgba(255, 193, 7, 0.15)',  border: 'rgba(255, 193, 7, 0.4)' },
  DECLINED: { label: 'Yokum',     color: '#F44336', bg: 'rgba(244, 67, 54, 0.12)',  border: 'rgba(244, 67, 54, 0.35)' },
  NONE:     { label: 'Cevap ver', color: '#0F172A', bg: '#FFC107',                  border: '#FFC107' },
};

// 18:00–23:30 akşam, 00:00 ve 00:30 o günün gecesi (bir sonraki takvim günü olarak kaydedilir).
const HOURS = ['18:00', '19:00', '20:00', '21:00', '22:00', '23:00', '00:00'];
const LOCKOUT_OPTIONS = [1, 3, 6, 12];

const showAlert = (title: string, msg: string) => {
  if (Platform.OS === 'web') window.alert(`${title}\n\n${msg}`);
  else Alert.alert(title, msg);
};

export default function DashboardScreen({ route, navigation }: any) {
  const user = route.params?.user || { name: "Oyuncu", id: "tempId" };

  // Veriler
  const [matches, setMatches] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  // İlk yükleme bitene kadar "grubun yok" gibi yanlış boş durumlar gösterilmez.
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isNotificationsVisible, setIsNotificationsVisible] = useState(false);
  const [isCalendarModalVisible, setIsCalendarModalVisible] = useState(false);
  const [matchLocation, setMatchLocation] = useState("");
  const [calendarDate, setCalendarDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState("");
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [maxPlayers, setMaxPlayers] = useState("14");
  const [lockoutHours, setLockoutHours] = useState(3);
  const [pitchFee, setPitchFee] = useState("");
  // Geçici şifreyle girildiyse önce yeni şifre belirlenir.
  const [mustChangePassword, setMustChangePassword] = useState(Boolean(user.mustChangePassword));
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  // Gruba Katıl / Grup Kur
  const [isJoinGroupModalVisible, setIsJoinGroupModalVisible] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [isCreateGroupModalVisible, setIsCreateGroupModalVisible] = useState(false);
  const [groupName, setGroupName] = useState("");

  useFocusEffect(
    React.useCallback(() => {
      fetchData();
    }, [])
  );

  // Push bildirimleri: izin iste + token'ı kaydet. Bildirime dokununca ilgili maçı aç.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    registerForPush();

    const openMatch = (matchId: string | null) => {
      if (matchId) navigation.navigate("MatchDetails", { match: { id: matchId }, user });
    };
    // Uygulama kapalıyken bildirime dokunularak açıldıysa
    Notifications.getLastNotificationResponseAsync()
      .then((r) => {
        openMatch(matchIdFromResponse(r));
        Notifications.clearLastNotificationResponseAsync?.();
      })
      .catch(() => {});
    // Uygulama açıkken / arka plandayken dokunulursa
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      openMatch(matchIdFromResponse(r));
      fetchData();
    });
    // Uygulama açıkken bildirim gelirse listeyi tazele
    const sub2 = Notifications.addNotificationReceivedListener(() => fetchData());
    return () => { sub.remove(); sub2.remove(); };
  }, []);

  const fetchData = async () => {
    try {
      const [matchRes, groupRes, notifRes] = await Promise.all([
        apiFetch(`${API_URL}/matches?type=my`),
        apiFetch(`${API_URL}/groups`),
        apiFetch(`${API_URL}/notifications`),
      ]);
      const [mData, gData, nData] = await Promise.all([matchRes.json(), groupRes.json(), notifRes.json()]);
      if (Array.isArray(mData)) setMatches(mData);
      if (Array.isArray(gData)) setGroups(gData);
      if (Array.isArray(nData)) setNotifications(nData);
    } catch (e) {
      console.log("Bağlantı hatası:", e);
    } finally {
      setLoaded(true);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  // Davet linkiyle gelip kayıt olduysa / giriş yaptıysa gruba otomatik katıl ve grubu aç.
  // Paylaşılan maç linkiyle geldiyse doğrudan o maçı aç.
  useEffect(() => {
    (async () => {
      const joined = await consumePendingInvite();
      if (!joined) {
        const matchId = await consumePendingMatch();
        if (matchId) navigation.navigate("MatchDetails", { match: { id: matchId }, user });
        return;
      }
      await fetchData();
      showAlert(
        joined.alreadyMember ? "Zaten gruptasın" : "Gruba katıldın 🎉",
        joined.alreadyMember
          ? `${joined.group.name} grubunun zaten üyesisin.`
          : `${joined.group.name} grubuna hoş geldin. Düzenli geliyorsan grup sayfasından "Her hafta varım"ı açabilirsin.`
      );
      navigation.navigate("GroupDetails", { group: joined.group, user });
    })();
  }, []);

  const upcomingMatches = matches
    .filter((m) => !isPastMatch(m))
    .sort((a, b) => Number(a.matchTimestamp) - Number(b.matchTimestamp));
  const pastMatches = matches
    .filter((m) => isPastMatch(m))
    .sort((a, b) => Number(b.matchTimestamp) - Number(a.matchTimestamp))
    .slice(0, 10);
  const unanswered = upcomingMatches.filter((m) => !m.myStatus && m.status !== 'CANCELLED');

  const handleOpenNotifications = async () => {
    setIsNotificationsVisible(true);
    try {
      await apiFetch(`${API_URL}/notifications/read`, { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ }) });
      setNotifications(prev => prev.map(n => ({...n, isRead: true})));
    } catch(e) {}
  };

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days: (Date | null)[] = [];
    let startDayOfWeek = firstDay.getDay();
    startDayOfWeek = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;
    for (let i = 0; i < startDayOfWeek; i++) days.push(null);
    for (let i = 1; i <= lastDay.getDate(); i++) days.push(new Date(year, month, i));
    return days;
  };

  const pickGroup = (g: any) => {
    setSelectedGroup(g.id);
    // Grubun haftalık sahası varsa onu öner; kullanıcı elle yazdıysa ezme.
    if (g.weeklyLocation && !matchLocation) setMatchLocation(g.weeklyLocation);
    if (g.weeklyMaxPlayers) setMaxPlayers(String(g.weeklyMaxPlayers));
    if (g.weeklyFee && !pitchFee) setPitchFee(String(g.weeklyFee));
  };

  const openCreateMatch = () => {
    if (groups.length === 0) {
      showAlert("Önce bir grup lazım", "Maçlar grup içinde kuruluyor. Yeni bir grup kur ya da arkadaşının davet koduyla katıl.");
      return;
    }
    if (!selectedGroup || !groups.some((g) => g.id === selectedGroup)) pickGroup(groups[0]);
    setIsModalVisible(true);
  };

  const resetCreateForm = () => {
    setMatchLocation("");
    setCalendarDate(null);
    setSelectedTime("");
    setMaxPlayers("14");
    setLockoutHours(3);
    setPitchFee("");
  };

  const handleCreateMatch = async () => {
    const missingFields = [];
    if (!selectedGroup) missingFields.push("Grup");
    if (!matchLocation.trim()) missingFields.push("Saha");
    if (!calendarDate) missingFields.push("Tarih");
    if (!selectedTime) missingFields.push("Saat");
    if (!(parseInt(maxPlayers) > 1)) missingFields.push("Kişi sayısı");
    if (missingFields.length > 0) {
      showAlert("Eksik Bilgi", `Lütfen şunları doldurun:\n\n- ${missingFields.join('\n- ')}`);
      return;
    }

    const [h, min] = selectedTime.split(':').map((x) => parseInt(x, 10));
    const start = new Date(calendarDate as Date);
    // 00:00 gibi gece saatleri seçilen günün gecesidir: maç ertesi takvim gününde başlar.
    if (h < 6) start.setDate(start.getDate() + 1);
    start.setHours(h, min, 0, 0);
    if (start.getTime() < Date.now()) {
      showAlert("Tarih geçmiş", "Seçtiğin gün ve saat geçmişte kalıyor.");
      return;
    }
    const day = calendarDate as Date;
    const dateLabel = `${day.getDate()}/${day.getMonth() + 1} ${DAY_NAMES_SHORT[day.getDay()]}, ${selectedTime}`;

    try {
      const response = await apiFetch(`${API_URL}/matches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId: selectedGroup,
          date: dateLabel,
          time: selectedTime,
          location: matchLocation.trim(),
          maxPlayers: parseInt(maxPlayers),
          matchTimestamp: start.getTime(),
          lockoutHours,
          pitchFee: pitchFee ? parseInt(pitchFee, 10) : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setIsModalVisible(false);
      resetCreateForm();
      fetchData();
      showAlert("Maç kuruldu", "Gruptaki herkese davet gitti.");
    } catch (error: any) {
      showAlert("Hata", error.message || "Maç oluşturulamadı");
    }
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      showAlert("Eksik Bilgi", "Lütfen grup adını girin.");
      return;
    }
    try {
      const response = await apiFetch(`${API_URL}/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: groupName.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setIsCreateGroupModalVisible(false);
      setGroupName("");
      fetchData();
      showAlert("Grup kuruldu", `Davet kodun: ${data.group.inviteCode}\n\nGrup sayfasından kodu WhatsApp'ta paylaşabilir, haftalık maçı ayarlayabilirsin.`);
    } catch (error: any) {
      showAlert("Hata", error.message || "Grup oluşturulamadı");
    }
  };

  const handleJoinGroup = async () => {
    if (!inviteCode.trim()) {
      showAlert("Eksik Bilgi", "Lütfen bir davet kodu girin.");
      return;
    }
    try {
      const response = await apiFetch(`${API_URL}/groups/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: inviteCode.trim().toUpperCase() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setIsJoinGroupModalVisible(false);
      setInviteCode("");
      fetchData();
      showAlert("Hoş geldin!", "Gruba katıldın.");
    } catch (error: any) {
      showAlert("Hata", error.message || "Gruba katılınamadı");
    }
  };

  // Davet bildiriminden doğrudan Varım / Belki / Yokum. Sunucu cevap gelince daveti kendisi siler.
  const answerMatchInvite = async (n: any, response: 'YES' | 'MAYBE' | 'NO') => {
    try {
      const meta = n.metadata ? JSON.parse(n.metadata) : null;
      if (!meta?.matchId) return;
      const res = await apiFetch(`${API_URL}/matches/${meta.matchId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response })
      });
      const data = await res.json();
      if (res.ok) {
        setNotifications(prev => prev.filter(x => x.id !== n.id));
        if (data.myStatus === 'RESERVE') showAlert("Yedektesin", data.message);
        fetchData();
      } else {
        showAlert("Olmadı", data.error || "Cevabın kaydedilemedi.");
      }
    } catch (e) {
      showAlert("Hata", "Bağlantı sorunu yaşandı.");
    }
  };

  const renderMatchCard = (match: any, past: boolean) => {
    const cancelled = match.status === 'CANCELLED';
    const s = MY_STATUS_BADGE[match.myStatus ?? 'NONE'] ?? MY_STATUS_BADGE.NONE;
    // Oynadığım, ücreti olan ve henüz ödemediğim geçmiş maç: payımı göster
    const owe = past && !cancelled && match.myStatus === 'ACTIVE' && match.pitchFee && match.myPaid === false
      ? shareOf(match.pitchFee, Number(match.activeCount)) : null;
    return (
      <TouchableOpacity
        key={match.id}
        activeOpacity={0.8}
        style={[styles.singleRowCard, (past || cancelled) && { opacity: cancelled ? 0.6 : 0.85 }]}
        onPress={() => navigation.navigate("MatchDetails", { match, user })}
      >
        <View style={[styles.rowIconContainer, { borderColor: cancelled ? 'rgba(244, 67, 54, 0.35)' : past ? 'rgba(255, 193, 7, 0.3)' : 'rgba(0, 230, 118, 0.3)' }]}>
          <Ionicons name={cancelled ? "close" : past ? "trophy" : "football"} size={20} color={cancelled ? "#F87171" : past ? "#FFC107" : "#00E676"} />
        </View>

        <View style={styles.rowMainInfo}>
          <Text style={styles.rowTitle} numberOfLines={1}>{formatMatchDate(match)}</Text>
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {past
              ? `${match.location || 'Saha belirtilmemiş'}${match.groupName ? ` · ${match.groupName}` : ''}`
              : `${match.activeCount ?? 0}/${match.maxPlayers} kişi · ${match.location || 'Saha belirtilmemiş'}`}
          </Text>
        </View>

        <View style={styles.rowRightSection}>
          {owe ? (
            <View style={[styles.miniBadge, { backgroundColor: 'rgba(244, 63, 94, 0.15)', borderColor: 'rgba(244, 63, 94, 0.45)', marginRight: 6 }]}>
              <Text style={[styles.miniBadgeText, { color: '#FB7185', fontWeight: 'bold' }]}>💸 {formatMoney(owe)}</Text>
            </View>
          ) : null}
          {cancelled ? (
            <View style={[styles.miniBadge, { backgroundColor: 'rgba(244, 67, 54, 0.12)', borderColor: 'rgba(244, 67, 54, 0.45)' }]}>
              <Text style={[styles.miniBadgeText, { color: '#F87171', fontWeight: 'bold' }]}>İptal</Text>
            </View>
          ) : past ? (
            <View style={[styles.miniBadge, { backgroundColor: 'rgba(255, 193, 7, 0.15)', borderColor: 'rgba(255, 193, 7, 0.4)' }]}>
              <Text style={[styles.miniBadgeText, { color: '#FFC107', fontWeight: 'bold' }]}>
                {match.score ? match.score : match.status === 'COMPLETED' ? 'Bitti' : 'Sonuç yok'}
              </Text>
            </View>
          ) : (
            <View style={[styles.miniBadge, { backgroundColor: s.bg, borderColor: s.border }]}>
              <Text style={[styles.miniBadgeText, { color: s.color, fontWeight: 'bold' }]}>{s.label}</Text>
            </View>
          )}
          <Ionicons name="chevron-forward" size={16} color="#64748B" style={{ marginLeft: 8 }} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Merhaba,</Text>
            <Text style={styles.userName} numberOfLines={1}>{user.nickname || String(user.name || '').split(' ')[0]}</Text>
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
              {user.avatar ? <Avatar user={user} size={44} /> : <Ionicons name="person" size={24} color="#00E676" />}
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          style={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={Platform.OS === 'web' ? undefined : <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00E676" colors={["#00E676"]} />}
        >
          <View style={styles.quickActionsContainer}>
            <TouchableOpacity style={styles.actionCard} onPress={openCreateMatch}>
              <LinearGradient colors={["rgba(0, 230, 118, 0.15)", "rgba(0, 230, 118, 0.05)"]} style={styles.actionGradient}>
                <Ionicons name="football" size={20} color="#00E676" />
                <Text style={styles.actionText}>Maç Kur</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionCard} onPress={() => setIsCreateGroupModalVisible(true)}>
              <LinearGradient colors={["rgba(255, 193, 7, 0.15)", "rgba(255, 193, 7, 0.05)"]} style={styles.actionGradient}>
                <Ionicons name="people" size={20} color="#FFC107" />
                <Text style={styles.actionText}>Grup Kur</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionCard} onPress={() => navigation.navigate("Leaderboard", { user })}>
              <LinearGradient colors={["rgba(168, 85, 247, 0.15)", "rgba(168, 85, 247, 0.05)"]} style={styles.actionGradient}>
                <Ionicons name="trophy" size={20} color="#A855F7" />
                <Text style={styles.actionText}>Liderler</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {unanswered.length > 0 && (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => navigation.navigate("MatchDetails", { match: unanswered[0], user })}
              style={localStyles.answerBanner}
            >
              <Ionicons name="alert-circle" size={22} color="#0F172A" />
              <Text style={localStyles.answerBannerText}>
                {unanswered.length === 1
                  ? `${formatMatchDate(unanswered[0])} maçına henüz cevap vermedin`
                  : `${unanswered.length} maça henüz cevap vermedin`}
              </Text>
              <Ionicons name="chevron-forward" size={18} color="#0F172A" />
            </TouchableOpacity>
          )}

          {!loaded ? (
            <View style={{ paddingVertical: 60, alignItems: 'center' }}>
              <ActivityIndicator color="#00E676" size="large" />
              <Text style={{ color: '#94A3B8', marginTop: 14 }}>Maçlar yükleniyor…</Text>
            </View>
          ) : groups.length === 0 ? (
            // Yeni kullanıcı: ne yapacağını tek bakışta göster
            <View style={localStyles.welcomeCard}>
              <Text style={localStyles.welcomeTitle}>Hoş geldin! 👋</Text>
              <Text style={localStyles.welcomeText}>
                Maçlar grup içinde ayarlanıyor. Arkadaşların bir grup kurduysa onlardan davet linkini ya da kodunu iste.
              </Text>
              <TouchableOpacity style={localStyles.welcomePrimary} onPress={() => setIsJoinGroupModalVisible(true)}>
                <Ionicons name="key-outline" size={18} color="#0F172A" />
                <Text style={localStyles.welcomePrimaryText}>Davet koduyla katıl</Text>
              </TouchableOpacity>
              <TouchableOpacity style={localStyles.welcomeSecondary} onPress={() => setIsCreateGroupModalVisible(true)}>
                <Text style={localStyles.welcomeSecondaryText}>Ya da kendi grubunu kur</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {loaded && groups.length > 0 && <>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Yaklaşan Maçlar</Text>
          </View>

          {upcomingMatches.length === 0 ? (
            <Text style={{ color: "#A0A0A0", textAlign: "center", marginVertical: 20 }}>
              Yaklaşan maç yok. Grup sayfasından haftalık maçı ayarlarsan her hafta kendiliğinden açılır.
            </Text>
          ) : (
            upcomingMatches.map((m) => renderMatchCard(m, false))
          )}

          <View style={[styles.sectionHeader, {marginTop: 20}]}>
            <Text style={styles.sectionTitle}>Geçmiş Maçlar</Text>
          </View>

          {pastMatches.length === 0 ? (
            <Text style={{color: "#A0A0A0", textAlign: "center", marginVertical: 20}}>
              Henüz oynanmış maç yok.
            </Text>
          ) : (
            pastMatches.map((m) => renderMatchCard(m, true))
          )}

          <View style={[styles.sectionHeader, {marginTop: 30}]}>
            <Text style={styles.sectionTitle}>Gruplarım</Text>
            <TouchableOpacity onPress={() => setIsJoinGroupModalVisible(true)} style={{flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(33, 150, 243, 0.1)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(33, 150, 243, 0.3)'}}>
              <Ionicons name="key-outline" size={14} color="#2196F3" style={{marginRight: 4}} />
              <Text style={{color: '#2196F3', fontSize: 13, fontWeight: 'bold'}}>Kodla Katıl</Text>
            </TouchableOpacity>
          </View>

          {groups.length === 0 ? null : (
            groups.map((group) => {
              const weekly = formatWeekly(group.weeklyDay, group.weeklyTime);
              return (
                <TouchableOpacity
                  key={group.id}
                  activeOpacity={0.8}
                  style={styles.singleRowCard}
                  onPress={() => navigation.navigate("GroupDetails", { group, user })}
                >
                  <View style={[styles.rowIconContainer, { borderColor: 'rgba(33, 150, 243, 0.3)' }]}>
                    <Ionicons name="shield-checkmark" size={20} color="#2196F3" />
                  </View>
                  <View style={styles.rowMainInfo}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{group.name}</Text>
                    <Text style={styles.rowSubtitle} numberOfLines={1}>
                      {weekly ? `${weekly} · ${group.weeklyLocation}` : 'Haftalık maç ayarlanmadı'}
                    </Text>
                  </View>
                  <View style={styles.rowRightSection}>
                    {group.creatorId === user.id && (
                      <View style={[styles.miniBadge, { backgroundColor: 'rgba(33, 150, 243, 0.15)', borderColor: 'rgba(33, 150, 243, 0.3)' }]}>
                        <Text style={[styles.miniBadgeText, { color: '#2196F3' }]}>Kurucu</Text>
                      </View>
                    )}
                    <Ionicons name="chevron-forward" size={16} color="#64748B" style={{ marginLeft: 8 }} />
                  </View>
                </TouchableOpacity>
              );
            })
          )}

          </>}

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>

      {/* MAÇ KUR */}
      <Modal animationType="slide" transparent={true} visible={isModalVisible} onRequestClose={() => setIsModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Yeni Maç Kur</Text>
              <TouchableOpacity onPress={() => setIsModalVisible(false)} style={styles.closeModalButton}>
                <Ionicons name="close" size={28} color="#A0A0A0" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={localStyles.fieldLabel}>Grup</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 15 }}>
                {groups.map((g) => (
                  <TouchableOpacity
                    key={g.id}
                    style={[styles.dateBubble, selectedGroup === g.id ? styles.dateBubbleActive : {}]}
                    onPress={() => pickGroup(g)}
                  >
                    <Text style={[styles.dateBubbleText, selectedGroup === g.id ? {color: '#000'} : {}]}>{g.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={localStyles.fieldLabel}>Saha</Text>
              <View style={styles.modalInputContainer}>
                <Ionicons name="location-outline" size={20} color="#00E676" style={styles.modalIcon} />
                <TextInput
                  style={styles.modalInput}
                  placeholder="Örn: Olimpik Halı Saha"
                  placeholderTextColor="#A0A0A0"
                  value={matchLocation}
                  onChangeText={setMatchLocation}
                />
              </View>

              <Text style={localStyles.fieldLabel}>Tarih</Text>
              <TouchableOpacity style={styles.modalInputContainer} onPress={() => setIsCalendarModalVisible(true)}>
                <Ionicons name="calendar-outline" size={20} color="#00E676" style={styles.modalIcon} />
                <Text style={{ color: calendarDate ? '#FFFFFF' : '#A0A0A0', fontSize: 16, flex: 1 }}>
                  {calendarDate
                    ? `${calendarDate.getDate()}/${calendarDate.getMonth() + 1} ${DAY_NAMES_SHORT[calendarDate.getDay()]}`
                    : "Tarih seçmek için dokun"}
                </Text>
              </TouchableOpacity>

              <Text style={localStyles.fieldLabel}>Saat</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }}>
                {HOURS.map((h) => (
                  <TouchableOpacity
                    key={h}
                    style={[styles.timeBubble, selectedTime === h ? styles.timeBubbleActive : {}]}
                    onPress={() => setSelectedTime(h)}
                  >
                    <Text style={[styles.timeBubbleText, selectedTime === h ? {color: '#000'} : {}]}>{h}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {selectedTime.startsWith('00') && calendarDate ? (
                <Text style={localStyles.hint}>
                  {DAY_NAMES_SHORT[calendarDate.getDay()]} gecesi 00:00 (takvimde ertesi gün) olarak kaydedilir.
                </Text>
              ) : <View style={{ height: 10 }} />}

              <Text style={localStyles.fieldLabel}>Kişi sayısı</Text>
              <View style={styles.modalInputContainer}>
                <Ionicons name="people-outline" size={20} color="#00E676" style={styles.modalIcon} />
                <TextInput
                  style={styles.modalInput}
                  placeholder="Örn: 14"
                  placeholderTextColor="#A0A0A0"
                  keyboardType="numeric"
                  value={maxPlayers}
                  onChangeText={setMaxPlayers}
                />
              </View>

              <Text style={localStyles.fieldLabel}>Saha ücreti (toplam, isteğe bağlı)</Text>
              <View style={styles.modalInputContainer}>
                <Ionicons name="cash-outline" size={20} color="#00E676" style={styles.modalIcon} />
                <TextInput
                  style={styles.modalInput}
                  placeholder="Örn: 1400"
                  placeholderTextColor="#A0A0A0"
                  keyboardType="numeric"
                  value={pitchFee}
                  onChangeText={(t) => setPitchFee(t.replace(/[^0-9]/g, ''))}
                />
                {pitchFee && parseInt(maxPlayers) > 0 ? (
                  <Text style={{ color: '#94A3B8', fontSize: 12, marginLeft: 8 }}>
                    ~{formatMoney(shareOf(parseInt(pitchFee, 10), parseInt(maxPlayers, 10)))}/kişi
                  </Text>
                ) : null}
              </View>

              <Text style={localStyles.fieldLabel}>Son değişiklik (maçtan kaç saat önce kilitlensin)</Text>
              <View style={{ flexDirection: 'row', marginBottom: 15 }}>
                {LOCKOUT_OPTIONS.map((h) => (
                  <TouchableOpacity
                    key={h}
                    style={[styles.timeBubble, lockoutHours === h ? styles.timeBubbleActive : {}]}
                    onPress={() => setLockoutHours(h)}
                  >
                    <Text style={[styles.timeBubbleText, lockoutHours === h ? {color: '#000'} : {}]}>{h} sa</Text>
                  </TouchableOpacity>
                ))}
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
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* GRUP KUR */}
      <Modal animationType="slide" transparent={true} visible={isCreateGroupModalVisible} onRequestClose={() => setIsCreateGroupModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Kendi Grubunu Kur</Text>
              <TouchableOpacity onPress={() => setIsCreateGroupModalVisible(false)} style={styles.closeModalButton}>
                <Ionicons name="close" size={28} color="#A0A0A0" />
              </TouchableOpacity>
            </View>
            <View style={styles.modalInputContainer}>
              <Ionicons name="shield-checkmark" size={20} color="#FFC107" style={styles.modalIcon} />
              <TextInput
                style={styles.modalInput}
                placeholder="Grup Adı (Örn: Çarşamba Kadrosu)"
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

      {/* KODLA KATIL */}
      <Modal animationType="fade" transparent={true} visible={isJoinGroupModalVisible} onRequestClose={() => setIsJoinGroupModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Koda Göre Gruba Katıl</Text>
              <TouchableOpacity onPress={() => setIsJoinGroupModalVisible(false)} style={styles.closeModalButton}>
                <Ionicons name="close" size={28} color="#A0A0A0" />
              </TouchableOpacity>
            </View>
            <View style={styles.modalInputContainer}>
              <Ionicons name="barcode-outline" size={20} color="#2196F3" style={styles.modalIcon} />
              <TextInput
                style={styles.modalInput}
                placeholder="Davet Kodu (Örn: K7M2QX)"
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

      {/* TAKVİM */}
      <Modal animationType="fade" transparent={true} visible={isCalendarModalVisible} onRequestClose={() => setIsCalendarModalVisible(false)}>
        <View style={[styles.modalOverlay, { justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0, 0, 0, 0.8)' }]}>
          <View style={[styles.modalContent, {
            width: Platform.OS === 'web' ? 360 : '90%',
            borderRadius: 24, borderWidth: 1, borderColor: 'rgba(0, 230, 118, 0.3)',
            padding: 20, paddingBottom: 25,
            borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderTopColor: "rgba(0, 230, 118, 0.3)",
          }]}>
            <View style={[styles.modalHeader, { marginBottom: 15 }]}>
              <Text style={styles.modalTitle}>Tarih Seç</Text>
              <TouchableOpacity onPress={() => setIsCalendarModalVisible(false)} style={styles.closeModalButton}>
                <Ionicons name="close" size={28} color="#A0A0A0" />
              </TouchableOpacity>
            </View>

            <View style={{ backgroundColor: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <TouchableOpacity onPress={() => { const d = new Date(currentMonth); d.setMonth(d.getMonth() - 1); setCurrentMonth(d); }} style={{ padding: 8 }}>
                  <Ionicons name="chevron-back" size={20} color="#00E676" />
                </TouchableOpacity>
                <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 16 }}>
                  {["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"][currentMonth.getMonth()]} {currentMonth.getFullYear()}
                </Text>
                <TouchableOpacity onPress={() => { const d = new Date(currentMonth); d.setMonth(d.getMonth() + 1); setCurrentMonth(d); }} style={{ padding: 8 }}>
                  <Ionicons name="chevron-forward" size={20} color="#00E676" />
                </TouchableOpacity>
              </View>

              <View style={{ flexDirection: 'row', marginBottom: 8 }}>
                {["Pt", "Sa", "Ça", "Pe", "Cu", "Ct", "Pz"].map((w, i) => (
                  <Text key={i} style={{ width: '14.28%', color: '#64748B', fontSize: 11, fontWeight: 'bold', textAlign: 'center' }}>{w}</Text>
                ))}
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {getDaysInMonth(currentMonth).map((day, i) => {
                  if (!day) return <View key={`empty-${i}`} style={{ width: '14.28%', height: 36 }} />;
                  const sameDay = (a: Date, b: Date) => a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
                  const isSelected = calendarDate ? sameDay(day, calendarDate) : false;
                  const isToday = sameDay(day, new Date());
                  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
                  const isPast = day < todayStart;
                  return (
                    <TouchableOpacity
                      key={`day-${i}`}
                      disabled={isPast}
                      style={{
                        width: '14.28%', height: 36, justifyContent: 'center', alignItems: 'center', borderRadius: 8,
                        backgroundColor: isSelected ? '#00E676' : 'transparent',
                        borderWidth: isToday ? 1 : 0, borderColor: '#00E676', opacity: isPast ? 0.25 : 1
                      }}
                      onPress={() => { setCalendarDate(day); setIsCalendarModalVisible(false); }}
                    >
                      <Text style={{ color: isSelected ? '#000' : '#FFF', fontWeight: 'bold', fontSize: 13 }}>{day.getDate()}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* BİLDİRİMLER */}
      <Modal visible={isNotificationsVisible} transparent animationType="slide" onRequestClose={() => setIsNotificationsVisible(false)}>
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
                   notifications.map((n) => (
                     <View key={n.id} style={{backgroundColor: 'rgba(255,255,255,0.05)', padding: 15, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)'}}>
                        <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 5}}>
                           <Ionicons name={n.type === 'MATCH_INVITE' ? "mail-unread" : (n.type === 'MATCH_RESULT' ? "football" : "information-circle")} size={16} color={n.type === 'MATCH_INVITE' ? '#A855F7' : (n.type === 'MATCH_RESULT' ? '#FFC107' : '#00E676')} />
                           <Text style={{color: '#94A3B8', fontSize: 12, marginLeft: 6}}>{new Date(n.createdAt).toLocaleDateString('tr-TR')} {new Date(n.createdAt).toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'})}</Text>
                        </View>
                        <Text style={{color: '#FFF', fontSize: 14, lineHeight: 20}}>{n.message}</Text>

                        {n.type === 'MATCH_INVITE' && (
                          <View style={{flexDirection: 'row', marginTop: 15, gap: 8}}>
                             <TouchableOpacity style={{flex: 1, backgroundColor: '#00E676', paddingVertical: 10, borderRadius: 8, alignItems: 'center'}} onPress={() => answerMatchInvite(n, 'YES')}>
                               <Text style={{color: '#000', fontWeight: 'bold', fontSize: 13}}>Varım</Text>
                             </TouchableOpacity>
                             <TouchableOpacity style={{flex: 1, backgroundColor: 'rgba(255, 193, 7, 0.12)', paddingVertical: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255, 193, 7, 0.4)'}} onPress={() => answerMatchInvite(n, 'MAYBE')}>
                               <Text style={{color: '#FFC107', fontWeight: 'bold', fontSize: 13}}>Belki</Text>
                             </TouchableOpacity>
                             <TouchableOpacity style={{flex: 1, backgroundColor: 'rgba(244, 67, 54, 0.1)', paddingVertical: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(244, 67, 54, 0.3)'}} onPress={() => answerMatchInvite(n, 'NO')}>
                               <Text style={{color: '#F44336', fontWeight: 'bold', fontSize: 13}}>Yokum</Text>
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
      <ChangePasswordModal
        visible={mustChangePassword}
        forced
        onDone={() => { user.mustChangePassword = false; setMustChangePassword(false); }}
      />
    </SafeAreaView>
  );
}

const localStyles = StyleSheet.create({
  answerBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FFC107', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 10,
  },
  answerBannerText: { flex: 1, color: '#0F172A', fontWeight: 'bold', fontSize: 14 },
  fieldLabel: { color: '#94A3B8', marginBottom: 8, fontSize: 13 },
  hint: { color: '#FFC107', fontSize: 12, marginBottom: 12 },
  welcomeCard: { backgroundColor: '#1E293B', borderRadius: 20, padding: 22, marginTop: 6, borderWidth: 1, borderColor: 'rgba(0, 230, 118, 0.25)' },
  welcomeTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: 'bold' },
  welcomeText: { color: '#CBD5E1', fontSize: 15, lineHeight: 22, marginTop: 8, marginBottom: 18 },
  welcomePrimary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#00E676', borderRadius: 14, paddingVertical: 14 },
  welcomePrimaryText: { color: '#0F172A', fontWeight: 'bold', fontSize: 16 },
  welcomeSecondary: { alignItems: 'center', paddingVertical: 14 },
  welcomeSecondaryText: { color: '#FFC107', fontWeight: '600', fontSize: 15 },
});

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
