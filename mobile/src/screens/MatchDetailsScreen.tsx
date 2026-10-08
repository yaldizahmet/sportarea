import { apiFetch } from '../utils/api';
import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  Modal,
  Image,
  Platform,
  Linking,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { API_URL } from "../config/api";
import { formatMatchDate, formatClock } from "../utils/format";

const getCoordinates = (team: any[], isTeamA: boolean) => {
  const width = 320;
  const height = 440;
  
  // Group players by role
  const gk = team.filter((p: any) => (p.position || '').toLowerCase().includes('kaleci'));
  const def = team.filter((p: any) => (p.position || '').toLowerCase().includes('defans') || (p.position || '').toLowerCase().includes('stoper') || (p.position || '').toLowerCase().includes('bek'));
  const fwd = team.filter((p: any) => (p.position || '').toLowerCase().includes('forvet') || (p.position || '').toLowerCase().includes('santrafor') || (p.position || '').toLowerCase().includes('kanat'));
  // Anyone else is mid
  const mid = team.filter((p: any) => !gk.includes(p) && !def.includes(p) && !fwd.includes(p));

  const coords: { [id: string]: { x: number, y: number } } = {};

  const assignCoordsForRole = (playersList: any[], yVal: number) => {
    const count = playersList.length;
    playersList.forEach((p, idx) => {
      let xVal = 160; // Center default
      if (count === 2) {
        xVal = idx === 0 ? 80 : 240;
      } else if (count === 3) {
        xVal = idx === 0 ? 70 : (idx === 1 ? 160 : 250);
      } else if (count > 3) {
        // Space them evenly
        const step = (width - 60) / (count - 1);
        xVal = 30 + idx * step;
      }
      coords[p.id] = { x: xVal, y: yVal };
    });
  };

  if (isTeamA) {
    assignCoordsForRole(gk, 35);
    assignCoordsForRole(def, 95);
    assignCoordsForRole(mid, 150);
    assignCoordsForRole(fwd, 195);
  } else {
    assignCoordsForRole(gk, 405);
    assignCoordsForRole(def, 345);
    assignCoordsForRole(mid, 290);
    assignCoordsForRole(fwd, 245);
  }

  return coords;
};

// Puanlama seviyeleri (sunucuya 1-99 arası sayı olarak gider; rozet eşikleri 78 ve 82)
const RATING_LEVELS = [
  { label: 'Zayıf', value: 40 },
  { label: 'Orta', value: 55 },
  { label: 'İyi', value: 70 },
  { label: 'Çok iyi', value: 82 },
  { label: 'Yıldız', value: 94 },
];

export default function MatchDetailsScreen({ route, navigation }: any) {
  // Bildirime dokunarak gelindiğinde elimizde sadece maç kimliği olur; geri kalanı sunucudan tamamlanır.
  const [matchInfo, setMatchInfo] = useState<any>(route.params?.match || {});
  const user = route.params?.user || {};

  const [players, setPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  
  const [matchStatus, setMatchStatus] = useState(matchInfo.status || 'OPEN');
  const [matchScore, setMatchScore] = useState(matchInfo.score || '');
  const [matchTimestamp, setMatchTimestamp] = useState(matchInfo.matchTimestamp || 0);
  
  // Finish Match
  const [finishModalVisible, setFinishModalVisible] = useState(false);
  const [scoreA, setScoreA] = useState('');
  const [scoreB, setScoreB] = useState('');
  const [playerGoals, setPlayerGoals] = useState<{ [id: string]: number }>({});

  // Rating
  const [ratingModalVisible, setRatingModalVisible] = useState(false);
  const [ratingTarget, setRatingTarget] = useState<any>(null);
  const [ratingScores, setRatingScores] = useState<Record<string, number | null>>({ speed: null, shoot: null, pass: null, physique: null });
  const [refreshing, setRefreshing] = useState(false);

  // MVP
  const [mvpModalVisible, setMvpModalVisible] = useState(false);
  const [matchMvp, setMatchMvp] = useState<any>(null);

  // Weather
  const [weather, setWeather] = useState<{temp: number, icon: string, desc: string} | null>(null);

  // AI Team Suggestion Preview States
  const [suggestedTeamsModalVisible, setSuggestedTeamsModalVisible] = useState(false);
  const [suggestedTeamA, setSuggestedTeamA] = useState<any[]>([]);
  const [suggestedTeamB, setSuggestedTeamB] = useState<any[]>([]);
  const [suggestedStats, setSuggestedStats] = useState<{teamA_overall: number, teamB_overall: number} | null>(null);
  const [saveTeamsLoading, setSaveTeamsLoading] = useState(false);
  const [groupCreatorId, setGroupCreatorId] = useState(matchInfo.groupCreatorId || null);
  // Takım kurma, maçı bitirme ve iptal: maçı kuran ya da grubun kurucusu (sunucudaki kuralın aynısı)
  const isManager = matchInfo.creatorId === user.id || groupCreatorId === user.id;

  // Hava durumu: saha adı haritada bulunursa ve maç 7 gün içindeyse gösterilir.
  // Bulunamazsa hiçbir şey gösterilmez (yanlış şehrin havasını göstermektense).
  const fetchWeather = async (loc: string, ts: number) => {
    try {
      if (!loc || !ts) return;
      const daysAhead = (ts - Date.now()) / 86400000;
      if (daysAhead < -1 || daysAhead > 7) return;

      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(loc)}&count=1&language=tr`);
      const geoData = await geoRes.json();
      const place = geoData?.results?.[0];
      if (!place) return;

      const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&daily=weathercode,temperature_2m_max&timezone=auto`);
      const weatherData = await weatherRes.json();
      const d = new Date(ts);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const idx = weatherData?.daily?.time?.indexOf(key) ?? -1;
      if (idx < 0) return;

      const code = weatherData.daily.weathercode[idx];
      const temp = Math.round(weatherData.daily.temperature_2m_max[idx]);
      let icon = '☀️'; let desc = 'Açık';
      if (code >= 1 && code <= 3) { icon = '⛅'; desc = 'Bulutlu'; }
      else if (code >= 45 && code <= 48) { icon = '🌫'; desc = 'Sisli'; }
      else if (code >= 51 && code <= 67) { icon = '🌧'; desc = 'Yağmurlu'; }
      else if (code >= 71 && code <= 77) { icon = '❄️'; desc = 'Karlı'; }
      else if (code >= 80 && code <= 82) { icon = '🌦'; desc = 'Sağanak bekleniyor'; }
      else if (code >= 95) { icon = '⛈️'; desc = 'Fırtına'; }
      setWeather({ temp, icon, desc });
    } catch (e) {
      console.log('Weather err:', e);
    }
  };

  const openDirections = () => {
    const q = encodeURIComponent(matchInfo.location || '');
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`);
  };

  useEffect(() => {
    if (matchInfo.id) {
      fetchMatchInfo();
      fetchPlayers();
      fetchMvp();
    }
  }, [matchInfo.id]);

  const fetchMatchInfo = async () => {
    try {
      const res = await apiFetch(`${API_URL}/matches/${matchInfo.id}`);
      const data = await res.json();
      if (data.status) setMatchStatus(data.status);
      if (data.score) setMatchScore(data.score);
      if (data.matchTimestamp) setMatchTimestamp(data.matchTimestamp);
      if (data.groupCreatorId) setGroupCreatorId(data.groupCreatorId);
      if (data.id) {
        setMatchInfo((prev: any) => ({ ...prev, ...data }));
        fetchWeather(data.location, Number(data.matchTimestamp) || 0);
      }
    } catch(e) {}
  };

  const fetchMvp = async () => {
    try {
      const res = await apiFetch(`${API_URL}/matches/${matchInfo.id}/mvp`);
      const data = await res.json();
      if (data.mvp) setMatchMvp(data.mvp);
    } catch(e) {}
  };

  const fetchPlayers = async () => {
    try {
      const res = await apiFetch(`${API_URL}/matches/${matchInfo.id}/players`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setPlayers(data);
      }
    } catch (e) {
      console.log("Oyuncular getirilemedi", e);
    }
  };

  const submitFinishMatch = async () => {
    try {
      const finalScore = (scoreA && scoreB) ? `${scoreA} - ${scoreB}` : '';
      const scorersData = Object.entries(playerGoals).map(([userId, goals]) => ({userId, goals}));
      const res = await apiFetch(`${API_URL}/matches/${matchInfo.id}/finish`, { 
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ score: finalScore, scorers: scorersData })
      });
      if (res.ok) {
        setMatchStatus('COMPLETED');
        if (finalScore) setMatchScore(finalScore);
        setFinishModalVisible(false);
        fetchPlayers();
        Alert.alert('Maç Bitti', 'Skor ve golcüler kaydedildi. Artık oyuncuları puanlayabilirsiniz!');
      } else {
        const errorData = await res.json();
        Alert.alert('Hata', errorData?.error || 'Kayıt başarısız oldu.');
      }
    } catch(e) {
      Alert.alert('Bağlantı Hatası', 'Sunucuya ulaşılamadı.');
    }
  };

  const openRatingModal = (player: any) => {
    if(player.id === user.id) {
      Alert.alert('Uyarı', 'Kendinize puan veremezsiniz!');
      return;
    }
    setRatingTarget(player);
    setRatingScores({ speed: null, shoot: null, pass: null, physique: null });
    setRatingModalVisible(true);
  };

  const submitRating = async () => {
    if(!ratingTarget) return;
    if (Object.values(ratingScores).some((v) => v === null)) {
      Alert.alert('Eksik', 'Dört özelliğin hepsi için bir seviye seç.');
      return;
    }
    try {
       const res = await apiFetch(`${API_URL}/matches/${matchInfo.id}/rate`, {
         method: 'POST',
         headers: {'Content-Type': 'application/json'},
         body: JSON.stringify({ 
            ratedId: ratingTarget.id,
            speed: ratingScores.speed,
            shoot: ratingScores.shoot,
            pass: ratingScores.pass,
            physique: ratingScores.physique
         })
       });
       if(res.ok) {
         setRatingModalVisible(false);
         Alert.alert('Başarılı', `${ratingTarget.name} adlı oyuncuyu puanladınız!`);
       } else {
         const d = await res.json();
         Alert.alert('Hata', d.error || 'Puanlama yapılamadı.');
       }
    } catch(e) {}
  };

  const submitMvpVote = async (votedId: string) => {
    try {
      const res = await apiFetch(`${API_URL}/matches/${matchInfo.id}/mvp`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ voterId: user.id, votedId })
      });
      const data = await res.json();
      if(res.ok) {
        Alert.alert("MVP Seçimi!", data.message || "Oyunuz başarıyla kaydedildi! 🏆");
        setMvpModalVisible(false);
        fetchMvp();
      } else {
        Alert.alert("Uyarı", data.error || "MVP oyu kullanılamadı.");
      }
    } catch(e) {
      Alert.alert("Hata", "Bağlantı sorunu.");
    }
  };

  // VARIM / BELKİ / YOKUM
  const sendResponse = async (response: 'YES' | 'MAYBE' | 'NO') => {
    setLoading(true);
    try {
      const res = await apiFetch(`${API_URL}/matches/${matchInfo.id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchPlayers();
        // Yedeğe düşmek önemli bir bilgi, onu ayrıca söyleyelim; diğer durumlarda düğme rengi yeterli.
        if (data.myStatus === 'RESERVE') Alert.alert("Yedektesin", data.message);
      } else {
        Alert.alert("Olmadı", data.error || "Cevabın kaydedilemedi.");
      }
    } catch (e) {
      Alert.alert("Hata", "Bağlantı sorunu yaşandı.");
    }
    setLoading(false);
  };

  const handleRespond = (response: 'YES' | 'MAYBE' | 'NO') => {
    if (loading) return;
    const inRoster = myStatus === 'ACTIVE' || myStatus === 'RESERVE';
    if (response === 'YES' && inRoster) return;
    if (response === 'MAYBE' && myStatus === 'MAYBE') return;
    if (response === 'NO' && myStatus === 'DECLINED') return;

    // Kadrodan çıkmak birinin yerini etkiler; emin olalım.
    if (inRoster && response !== 'YES') {
      const msg = myStatus === 'ACTIVE'
        ? "Kadrodan çıkarsan yerin ilk yedeğe geçer. Emin misin?"
        : "Yedek listesinden çıkmak istediğine emin misin?";
      if (Platform.OS === 'web') {
        if (window.confirm(msg)) sendResponse(response);
      } else {
        Alert.alert("Emin misin?", msg, [
          { text: "Vazgeç", style: "cancel" },
          { text: "Evet", style: "destructive", onPress: () => sendResponse(response) }
        ]);
      }
      return;
    }
    sendResponse(response);
  };

  const handleCancelMatch = async () => {
    const performCancel = async () => {
      try {
        const res = await apiFetch(`${API_URL}/matches/${matchInfo.id}`, {
          method: "DELETE"
        });
        const data = await res.json();
        if (res.ok) {
          Alert.alert("Başarılı", "Maç başarıyla iptal edildi.");
          navigation.goBack();
        } else {
          Alert.alert("Hata", data.error || "Maç iptal edilemedi.");
        }
      } catch (e) {
        Alert.alert("Hata", "Bağlantı sorunu yaşandı.");
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm("Bu maçı iptal etmek ve tüm kadro bilgilerini kalıcı olarak silmek istediğinize emin misiniz?")) {
        await performCancel();
      }
    } else {
      Alert.alert(
        "Maçı İptal Et ❌",
        "Bu maçı iptal etmek ve tüm kadro bilgilerini silmek istediğinize emin misiniz?",
        [
          { text: "Vazgeç", style: "cancel" },
          { text: "Evet, İptal Et", style: "destructive", onPress: performCancel }
        ]
      );
    }
  };

  const handleDivideTeams = async () => {
    try {
      const res = await apiFetch(`${API_URL}/matches/${matchInfo.id}/suggest-teams`);
      const data = await res.json();
      if (res.ok) {
        setSuggestedTeamA(data.teamA || []);
        setSuggestedTeamB(data.teamB || []);
        setSuggestedStats(data.stats || null);
        setSuggestedTeamsModalVisible(true);
      } else {
        Alert.alert("Hata", data.error || "Öneri oluşturulamadı. Yeterli oyuncu var mı kontrol edin.");
      }
    } catch (e) {
      Alert.alert("Hata", "Bağlantı sorunu yaşandı.");
    }
  };

  const handleApplySuggestedTeams = async () => {
    setSaveTeamsLoading(true);
    try {
      const res = await apiFetch(`${API_URL}/matches/${matchInfo.id}/save-teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamA: suggestedTeamA.map((p) => p.id),
          teamB: suggestedTeamB.map((p) => p.id),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuggestedTeamsModalVisible(false);
        fetchPlayers();
        Alert.alert("Takımlar Kuruldu! ⚽", "Dengeli takımlar sahaya yerleştirildi ve başarıyla kaydedildi!");
      } else {
        Alert.alert("Hata", data.error || "Takımlar kaydedilemedi.");
      }
    } catch (e) {
      Alert.alert("Hata", "Bağlantı sorunu yaşandı.");
    }
    setSaveTeamsLoading(false);
  };

  const activePlayers = players.filter((p: any) => p.status === 'ACTIVE');
  const reserves = matchStatus === 'COMPLETED' ? [] : players.filter((p: any) => p.status === 'RESERVE');
  // Maç bittiyse sadece sahada oynayanlar listelenir (yedek / belki / gelmeyen gizlenir).
  const isCompleted = matchStatus === 'COMPLETED';
  const maybePlayers = isCompleted ? [] : players.filter((p: any) => p.status === 'MAYBE');
  const pendingPlayers = isCompleted ? [] : players.filter((p: any) => p.status === 'PENDING');
  const declinedPlayers = isCompleted ? [] : players.filter((p: any) => p.status === 'DECLINED');
  // Benim cevabım: ACTIVE / RESERVE (varım), MAYBE, DECLINED, PENDING ya da listede yoksam null
  const myStatus: string | null = players.find((p: any) => p.id === user.id)?.status ?? null;
  const iPlayed = isCompleted && myStatus === 'ACTIVE';

  // Maçın aşaması: açık -> kilitli (son değişiklik saati geçti) -> başladı -> tamamlandı
  const ts = Number(matchTimestamp) || 0;
  const lockHours = Number(matchInfo.lockoutHours ?? 0);
  const lockAt = ts ? ts - lockHours * 3600 * 1000 : 0;
  const now = Date.now();
  const phase: 'open' | 'locked' | 'started' | 'completed' =
    isCompleted ? 'completed' : ts && now >= ts ? 'started' : lockAt && lockHours > 0 && now >= lockAt ? 'locked' : 'open';
  const inRoster = myStatus === 'ACTIVE' || myStatus === 'RESERVE';

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchMatchInfo(), fetchPlayers(), fetchMvp()]);
    setRefreshing(false);
  };

  const teamA = activePlayers.filter((p: any) => p.team === 'A');
  const teamB = activePlayers.filter((p: any) => p.team === 'B');
  const unassigned = activePlayers.filter((p: any) => p.team !== 'A' && p.team !== 'B');
  const teamsDivided = teamA.length > 0 || teamB.length > 0;

  const renderPlayerCard = (player: any, idx: number, badgeText: string, badgeStyle: any, textStyle: any) => {
    // Puanlama: maç bitti, ben oynadım, o da oynadı ve kendim değilim.
    const canRate = iPlayed && player.status === 'ACTIVE' && player.id !== user.id;
    const Wrapper: any = canRate ? TouchableOpacity : View;

    return (
      <Wrapper key={player.id ?? idx} style={styles.playerCard} onPress={canRate ? () => openRatingModal(player) : undefined}>
        <View style={styles.playerLeft}>
          <View style={styles.playerAvatar}>
            {player.avatar ? (
               <Image source={{uri: player.avatar}} style={{width: 40, height: 40, borderRadius: 20}} />
            ) : (
               <Text style={styles.playerInitial}>{String(player.name?.charAt(0) || "?")}</Text>
            )}
          </View>
          <View>
            <Text style={styles.playerName}>{String(player.name)}</Text>
            <Text style={styles.playerPosition}>{String(player.position || "Orta Saha")}</Text>
            {player.goals > 0 && <Text style={{color: '#00E676', fontSize: 12, marginTop: 3, fontWeight: 'bold'}}>⚽ {player.goals} Gol</Text>}
          </View>
        </View>
        <View style={[styles.statusBadge, canRate ? {backgroundColor: 'rgba(255, 193, 7, 0.2)'} : badgeStyle]}>
          <Text style={[styles.statusText, canRate ? {color: '#FFC107'} : textStyle]}>
            {canRate ? 'Puanla ⭐' : isCompleted && player.id === user.id ? 'Sen' : String(badgeText)}
          </Text>
        </View>
      </Wrapper>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Maç Detayları</Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            fetchMatchInfo();
            fetchPlayers();
            fetchMvp();
          }}
        >
          <Ionicons name="refresh" size={24} color="#00E676" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={Platform.OS === 'web' ? undefined : <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00E676" colors={["#00E676"]} />}
      >
        <LinearGradient colors={["#1E293B", "#0F172A"]} style={styles.infoCard}>
          <View style={styles.infoTop}>
            <Text style={styles.matchTitle}>{String(matchInfo.location || "Bilinmeyen Saha")}</Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={20} color="#00E676" style={styles.infoIcon} />
            <Text style={styles.infoText}>{formatMatchDate({ ...matchInfo, matchTimestamp })}</Text>
          </View>
          {matchInfo.groupName ? (
            <View style={styles.infoRow}>
              <Ionicons name="shield-checkmark-outline" size={20} color="#00E676" style={styles.infoIcon} />
              <Text style={styles.infoText}>{String(matchInfo.groupName)}</Text>
            </View>
          ) : null}
          
          {weather && (
            <View style={[styles.infoRow, {marginTop: 5}]}>
              <Text style={{fontSize: 20, marginRight: 8}}>{weather.icon}</Text>
              <Text style={[styles.infoText, {color: '#818cf8', fontWeight: 'bold'}]}>
                Hava: {weather.temp}°C, {weather.desc}
              </Text>
            </View>
          )}
          
          <View style={styles.divider} />

          <View style={styles.organizerRow}>
            <View style={styles.organizerAvatar}><Ionicons name="flag-outline" size={16} color="#00E676" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.organizerText}>
                {phase === 'completed' ? 'Maç tamamlandı'
                  : phase === 'started' ? 'Maç saati geldi, sonuç bekleniyor'
                  : phase === 'locked' ? 'Kadro kilitlendi'
                  : 'Kadro açık'}
              </Text>
              {phase === 'open' && lockAt > 0 && lockHours > 0 && (
                <Text style={styles.lockHint}>Son değişiklik: {formatClock(lockAt)}</Text>
              )}
            </View>
            {phase !== 'completed' && phase !== 'started' && isManager && (
              <TouchableOpacity style={{backgroundColor: 'rgba(239, 68, 68, 0.15)', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.5)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8}} onPress={handleCancelMatch}>
                 <Text style={{color: '#F87171', fontSize: 13, fontWeight: 'bold'}}>İptal Et</Text>
              </TouchableOpacity>
            )}
          </View>
          {matchStatus === 'COMPLETED' && (matchScore || matchInfo.score) ? (
             <View style={{marginTop: 15, padding: 15, backgroundColor: 'rgba(255, 193, 7, 0.1)', borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255, 193, 7, 0.3)'}}>
                <Text style={{color: '#FFC107', fontSize: 13, fontWeight: 'bold', marginBottom: 5}}>MAÇ SONUCU</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                  <Text style={{ color: '#60A5FA', fontSize: 14, fontWeight: 'bold', flex: 1, textAlign: 'right' }} numberOfLines={1}>{matchInfo.teamAName || 'A Takımı'}</Text>
                  <Text style={{ color: '#FFF', fontSize: 30, fontWeight: '900', marginHorizontal: 14 }}>{String(matchScore || matchInfo.score).replace(/\s*-\s*/, ' - ')}</Text>
                  <Text style={{ color: '#F87171', fontSize: 14, fontWeight: 'bold', flex: 1, textAlign: 'left' }} numberOfLines={1}>{matchInfo.teamBName || 'B Takımı'}</Text>
                </View>
             </View>
          ) : null}


        </LinearGradient>

        {/* Saha: her platformda çalışan tek tık yol tarifi */}
        {matchInfo.location ? (
          <TouchableOpacity activeOpacity={0.85} onPress={openDirections} style={styles.locationCard}>
            <Ionicons name="navigate-circle" size={36} color="#00E676" />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.locationName} numberOfLines={1}>{String(matchInfo.location)}</Text>
              <Text style={styles.locationSub}>Haritada aç / yol tarifi al</Text>
            </View>
            <Ionicons name="open-outline" size={18} color="#64748B" />
          </TouchableOpacity>
        ) : null}

        {isCompleted && (
          <View style={styles.mvpCard}>
            <Text style={styles.mvpLabel}>🏆 MAÇIN YILDIZI</Text>
            {matchMvp ? (
              <Text style={styles.mvpName}>{String(matchMvp.name)} <Text style={styles.mvpVotes}>· {String(matchMvp.voteCount)} oy</Text></Text>
            ) : (
              <Text style={styles.mvpEmpty}>Henüz kimse oy vermedi.</Text>
            )}
            {iPlayed ? (
              <>
                <TouchableOpacity style={styles.mvpBtn} onPress={() => setMvpModalVisible(true)} activeOpacity={0.85}>
                  <Text style={styles.mvpBtnText}>MVP'ye oy ver</Text>
                </TouchableOpacity>
                <Text style={styles.mvpHint}>Takım arkadaşlarını puanlamak için aşağıda isimlerine dokun.</Text>
              </>
            ) : (
              <Text style={styles.mvpHint}>Oy ve puanı sadece bu maçta oynayanlar verebilir.</Text>
            )}
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            {isCompleted
              ? `Oynayanlar (${activePlayers.length})`
              : `Kadro (${activePlayers.length}/${matchInfo.maxPlayers || 14})`}
          </Text>
          {matchStatus === 'OPEN' && isManager && (
            <TouchableOpacity onPress={handleDivideTeams} style={styles.divideButton}>
              <Text style={styles.divideButtonText}>Takım Böl 🎲</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Kim geliyor? Tek bakışta özet */}
        {!isCompleted && <View style={styles.tallyRow}>
          <View style={[styles.tallyChip, { borderColor: 'rgba(0, 230, 118, 0.4)' }]}>
            <Text style={[styles.tallyNum, { color: '#00E676' }]}>{activePlayers.length + reserves.length}</Text>
            <Text style={styles.tallyLabel}>Varım</Text>
          </View>
          <View style={[styles.tallyChip, { borderColor: 'rgba(255, 193, 7, 0.4)' }]}>
            <Text style={[styles.tallyNum, { color: '#FFC107' }]}>{maybePlayers.length}</Text>
            <Text style={styles.tallyLabel}>Belki</Text>
          </View>
          <View style={[styles.tallyChip, { borderColor: 'rgba(244, 67, 54, 0.4)' }]}>
            <Text style={[styles.tallyNum, { color: '#F44336' }]}>{declinedPlayers.length}</Text>
            <Text style={styles.tallyLabel}>Yokum</Text>
          </View>
          <View style={[styles.tallyChip, { borderColor: 'rgba(148, 163, 184, 0.4)' }]}>
            <Text style={[styles.tallyNum, { color: '#94A3B8' }]}>{pendingPlayers.length}</Text>
            <Text style={styles.tallyLabel}>Cevap yok</Text>
          </View>
        </View>}

        {!teamsDivided ? (
          <View style={styles.playersContainer}>
            {unassigned.length === 0 ? (
              <Text style={{ color: "#A0A0A0", textAlign: "center" }}>Henüz hiç oyuncu katılmadı. İlk sen ol!</Text>
            ) : (
              <>{unassigned.map((player: any, idx: number) => renderPlayerCard(player, idx, "ONAYLI", styles.statusApproved, styles.statusTextApproved))}</>
            )}
            {reserves.length > 0 && (
               <View style={{marginTop: 20}}>
                  <Text style={[styles.sectionTitle, {fontSize: 16, marginBottom: 10, color: '#F44336'}]}>Yedek Kulübesi ({reserves.length})</Text>
                  {reserves.map((player: any, idx: number) => renderPlayerCard(player, idx, "YEDEK", styles.statusPending, styles.statusTextPending))}
               </View>
            )}
            {maybePlayers.length > 0 && (
               <View style={{marginTop: 20}}>
                  <Text style={[styles.sectionTitle, {fontSize: 14, marginBottom: 10, color: '#FFC107'}]}>Belki ({maybePlayers.length})</Text>
                  {maybePlayers.map((player: any, idx: number) => renderPlayerCard(player, idx, "BELKİ", {backgroundColor: 'rgba(255,193,7,0.12)'}, {color: '#FFC107'}))}
               </View>
            )}
            {pendingPlayers.length > 0 && (
               <View style={{marginTop: 20}}>
                  <Text style={[styles.sectionTitle, {fontSize: 14, marginBottom: 10, color: '#A0A0A0'}]}>Cevap Vermeyenler ({pendingPlayers.length})</Text>
                  {pendingPlayers.map((player: any, idx: number) => renderPlayerCard(player, idx, "BEKLİYOR", {backgroundColor: 'rgba(255,255,255,0.1)'}, {color: '#94A3B8'}))}
               </View>
            )}
            {declinedPlayers.length > 0 && (
               <View style={{marginTop: 20}}>
                  <Text style={[styles.sectionTitle, {fontSize: 14, marginBottom: 10, color: '#F44336'}]}>Gelmiyor ({declinedPlayers.length})</Text>
                  {declinedPlayers.map((player: any, idx: number) => renderPlayerCard(player, idx, "YOK", {backgroundColor: 'rgba(244,67,54,0.1)'}, {color: '#F44336'}))}
               </View>
            )}
          </View>
        ) : (
          <View style={styles.teamsSplitContainer}>
            <LinearGradient colors={['rgba(33, 150, 243, 0.15)', 'rgba(33, 150, 243, 0.02)']} style={styles.teamContainer}>
              <Text style={[styles.teamHeader, { color: '#2196F3' }]}>A TAKIMI ({teamA.length})</Text>
              {teamA.map((player, idx) => renderPlayerCard(player, idx, "A Takımı", styles.teamABadge, styles.teamAText))}
            </LinearGradient>

            <LinearGradient colors={['rgba(244, 67, 54, 0.15)', 'rgba(244, 67, 54, 0.02)']} style={styles.teamContainer}>
              <Text style={[styles.teamHeader, { color: '#F44336' }]}>B TAKIMI ({teamB.length})</Text>
              {teamB.map((player, idx) => renderPlayerCard(player, idx, "B Takımı", styles.teamBBadge, styles.teamBText))}
            </LinearGradient>
            
            {unassigned.length > 0 ? (
              <View style={styles.teamContainer}>
                <Text style={[styles.teamHeader, { color: '#A0A0A0' }]}>Atanmamış Oyuncular</Text>
                {unassigned.map((player: any, idx: number) => renderPlayerCard(player, idx, "ONAYLI", styles.statusApproved, styles.statusTextApproved))}
              </View>
            ) : null}

            {reserves.length > 0 ? (
              <View style={styles.teamContainer}>
                <Text style={[styles.teamHeader, { color: '#F44336' }]}>Yedek Kulübesi</Text>
                {reserves.map((player: any, idx: number) => renderPlayerCard(player, idx, "YEDEK", styles.statusPending, styles.statusTextPending))}
              </View>
            ) : null}

            {maybePlayers.length > 0 || pendingPlayers.length > 0 || declinedPlayers.length > 0 ? (
               <View style={[styles.teamContainer, {borderColor: 'rgba(255,255,255,0.05)'}]}>
                  <Text style={[styles.teamHeader, { color: '#A0A0A0' }]}>Grup Üyeleri Durumu</Text>
                  {maybePlayers.map((player: any, idx: number) => renderPlayerCard(player, idx, "BELKİ", {backgroundColor: 'rgba(255,193,7,0.12)'}, {color: '#FFC107'}))}
                  {pendingPlayers.map((player: any, idx: number) => renderPlayerCard(player, idx, "BEKLİYOR", {backgroundColor: 'rgba(255,255,255,0.1)'}, {color: '#94A3B8'}))}
                  {declinedPlayers.map((player: any, idx: number) => renderPlayerCard(player, idx, "YOK", {backgroundColor: 'rgba(244,67,54,0.1)'}, {color: '#F44336'}))}
               </View>
            ) : null}
          </View>
        )}

        <View style={{ height: 150 }} />
      </ScrollView>

      {phase === 'open' && (
        <View style={styles.footer}>
          <Text style={styles.answerPrompt}>
            {myStatus === 'ACTIVE' ? 'Kadrodasın ✅'
              : myStatus === 'RESERVE' ? 'Yedek listesindesin, yer açılırsa kadroya geçersin'
              : myStatus === 'MAYBE' ? 'Belki dedin, kesinleşince güncelle'
              : myStatus === 'DECLINED' ? 'Bu maça gelmiyorsun'
              : 'Bu maça geliyor musun?'}
          </Text>
          <View style={styles.answerRow}>
            {([
              { key: 'YES', label: 'Varım', icon: 'checkmark-circle', color: '#00E676', on: inRoster },
              { key: 'MAYBE', label: 'Belki', icon: 'help-circle', color: '#FFC107', on: myStatus === 'MAYBE' },
              { key: 'NO', label: 'Yokum', icon: 'close-circle', color: '#F44336', on: myStatus === 'DECLINED' },
            ] as const).map((opt) => (
              <TouchableOpacity
                key={opt.key}
                activeOpacity={0.8}
                disabled={loading}
                onPress={() => handleRespond(opt.key)}
                style={[
                  styles.answerBtn,
                  { borderColor: opt.on ? opt.color : 'rgba(255,255,255,0.12)', backgroundColor: opt.on ? opt.color : 'rgba(255,255,255,0.04)' },
                  loading && { opacity: 0.6 },
                ]}
              >
                <Ionicons name={opt.icon} size={20} color={opt.on ? '#0F172A' : opt.color} />
                <Text style={[styles.answerBtnText, { color: opt.on ? '#0F172A' : '#E2E8F0' }]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {phase === 'locked' && (
        <View style={styles.footer}>
          <View style={styles.lockedBox}>
            <Ionicons name="lock-closed" size={18} color="#94A3B8" />
            <Text style={styles.lockedText}>
              {myStatus === 'ACTIVE' ? 'Kadro kilitlendi, kadrodasın ✅ Gelemeyeceksen maçı kurana haber ver.'
                : myStatus === 'RESERVE' ? 'Kadro kilitlendi, yedek listesindesin.'
                : 'Kadro kilitlendi, artık değişiklik yapılamıyor.'}
            </Text>
          </View>
        </View>
      )}

      {phase === 'started' && isManager && (
        <View style={styles.footer}>
          <TouchableOpacity style={styles.finishBtn} onPress={() => setFinishModalVisible(true)} activeOpacity={0.85}>
            <Ionicons name="flag" size={20} color="#0F172A" />
            <Text style={styles.finishBtnText}>Maçı bitir, skoru gir</Text>
          </TouchableOpacity>
        </View>
      )}
      


      {/* FINISH MODAL */}
      <Modal visible={finishModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Maç Sonucu</Text>
            <Text style={{color: '#94A3B8', textAlign: 'center', marginBottom: 20}}>Lütfen A Takımı ve B Takımı'nın skorlarını girin veya boş bırakarak devam edin.</Text>
            
            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20}}>
               <View style={{alignItems: 'center', flex: 1}}>
                  <Text style={{color: '#2196F3', fontWeight: 'bold', marginBottom: 10}}>{matchInfo.teamAName || 'A TAKIMI'}</Text>
                  <TextInput 
                     style={styles.ratingInput} 
                     keyboardType="numeric" 
                     maxLength={2}
                     value={scoreA}
                     onChangeText={(txt) => setScoreA(txt.replace(/[^0-9]/g, ''))}
                     placeholder="0"
                     placeholderTextColor="#94A3B8"
                  />
               </View>
               <Text style={{color: '#FFF', fontSize: 24, fontWeight: 'bold'}}>-</Text>
               <View style={{alignItems: 'center', flex: 1}}>
                  <Text style={{color: '#F44336', fontWeight: 'bold', marginBottom: 10}}>{matchInfo.teamBName || 'B TAKIMI'}</Text>
                  <TextInput 
                     style={styles.ratingInput} 
                     keyboardType="numeric" 
                     maxLength={2}
                     value={scoreB}
                     onChangeText={(txt) => setScoreB(txt.replace(/[^0-9]/g, ''))}
                     placeholder="0"
                     placeholderTextColor="#94A3B8"
                  />
               </View>
            </View>

            <View style={{maxHeight: 200, marginBottom: 20}}>
               <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
                  <Text style={{color: '#94A3B8', fontSize: 13, marginBottom: 10}}>Golcüler:</Text>
                  {activePlayers.map((p: any) => (
                     <View key={p.id} style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, backgroundColor: 'rgba(255,255,255,0.05)', padding: 10, borderRadius: 10}}>
                        <Text style={{color: '#FFF', flex: 1}} numberOfLines={1}>{p.name}{p.team === 'A' || p.team === 'B' ? ` (${p.team} Takımı)` : ''}</Text>
                        <View style={{flexDirection: 'row', alignItems: 'center'}}>
                           <TouchableOpacity style={{backgroundColor: '#334155', width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center'}} onPress={() => setPlayerGoals(prev => ({...prev, [p.id]: Math.max(0, (prev[p.id] || 0) - 1)}))}>
                              <Text style={{color: '#FFF', fontWeight: 'bold'}}>-</Text>
                           </TouchableOpacity>
                           <Text style={{color: '#00E676', fontWeight: 'bold', marginHorizontal: 15}}>{playerGoals[p.id] || 0} ⚽</Text>
                           <TouchableOpacity style={{backgroundColor: '#334155', width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center'}} onPress={() => setPlayerGoals(prev => ({...prev, [p.id]: (prev[p.id] || 0) + 1}))}>
                              <Text style={{color: '#FFF', fontWeight: 'bold'}}>+</Text>
                           </TouchableOpacity>
                        </View>
                     </View>
                  ))}
               </ScrollView>
            </View>

            <TouchableOpacity style={styles.saveBtn} onPress={submitFinishMatch}>
               <LinearGradient colors={['#EF4444', '#DC2626']} start={{x: 0, y: 0}} end={{x: 1, y: 0}} style={styles.saveBtnGradient}>
                 <Text style={[styles.saveBtnText, {color: '#FFF'}]}>MAÇI BİTİR VE KAYDET</Text>
               </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setFinishModalVisible(false)}>
               <Text style={[styles.cancelBtnText, {color: '#94A3B8'}]}>İptal</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* RATING MODAL */}
      <Modal visible={ratingModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{ratingTarget?.name} Skorla!</Text>
            
            <Text style={{ color: '#94A3B8', textAlign: 'center', marginBottom: 16 }}>Bu maçtaki performansına göre her özellik için bir seviye seç.</Text>
            {(['speed', 'shoot', 'pass', 'physique'] as const).map(skill => {
              const labelMap: any = { speed: 'Hız', shoot: 'Şut', pass: 'Pas', physique: 'Fizik' };
              return (
                <View key={skill} style={{ marginBottom: 14 }}>
                  <Text style={styles.ratingLabel}>{labelMap[skill]}</Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                    {RATING_LEVELS.map((lvl) => {
                      const on = ratingScores[skill] === lvl.value;
                      return (
                        <TouchableOpacity
                          key={lvl.value}
                          onPress={() => setRatingScores(prev => ({ ...prev, [skill]: lvl.value }))}
                          style={[styles.levelChip, on && { backgroundColor: '#FFC107', borderColor: '#FFC107' }]}
                        >
                          <Text style={[styles.levelChipText, on && { color: '#0F172A' }]}>{lvl.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              );
            })}

            <TouchableOpacity style={styles.saveBtn} onPress={submitRating}>
               <LinearGradient colors={['#FFC107', '#FF9800']} start={{x: 0, y: 0}} end={{x: 1, y: 0}} style={styles.saveBtnGradient}>
                 <Text style={styles.saveBtnText}>PUANI GÖNDER</Text>
               </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setRatingModalVisible(false)}>
               <Text style={styles.cancelBtnText}>İptal Et</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MVP MODAL */}
      <Modal visible={mvpModalVisible} transparent animationType="slide">
         <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
               <Text style={[styles.modalTitle, {color: '#FFD700'}]}>🏆 MVP Seçimi</Text>
               <Text style={{color: '#94A3B8', textAlign: 'center', marginBottom: 20}}>Size göre bu maçın yıldızı kimdi? Listeden bir oyuncu seçin.</Text>
               
               <ScrollView style={{maxHeight: 300, width: '100%'}}>
                  {activePlayers.filter((p: any) => p.id !== user.id).map((p: any, idx: number) => (
                     <TouchableOpacity 
                       key={idx} 
                       style={{flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255, 215, 0, 0.1)', padding: 15, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255, 215, 0, 0.3)'}}
                       onPress={() => submitMvpVote(p.id)}
                     >
                        <Text style={{color: '#FFD700', fontWeight: 'bold', fontSize: 18, marginRight: 15}}>{idx + 1}</Text>
                        <View style={{flex: 1}}>
                           <Text style={{color: '#FFF', fontSize: 16, fontWeight: 'bold'}}>{p.name}</Text>
                           <Text style={{color: '#A0A0A0', fontSize: 12}}>{p.position || 'Oyuncu'} • {p.team === 'A' ? 'A Takımı' : (p.team === 'B' ? 'B Takımı' : 'Belirsiz')}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color="#FFD700" />
                     </TouchableOpacity>
                  ))}
                  {activePlayers.length <= 1 && <Text style={{color:'#A0A0A0', textAlign:'center'}}>Seçilebilecek oyuncu yok.</Text>}
               </ScrollView>

               <TouchableOpacity style={[styles.cancelBtn, {marginTop: 15, width: '100%'}]} onPress={() => setMvpModalVisible(false)}>
                  <Text style={styles.cancelBtnText}>Vazgeç</Text>
               </TouchableOpacity>
            </View>
         </View>
      </Modal>

      {/* AI TEAM SUGGESTION MODAL WITH TACTICAL FIELD */}
      <Modal visible={suggestedTeamsModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%', borderTopColor: '#00E676', borderTopWidth: 2 }]}>
            <Text style={[styles.modalTitle, { color: '#00E676', fontSize: 18, marginBottom: 5 }]}>⚖️ Dengeli Takım Önerisi</Text>
            <Text style={{ color: '#94A3B8', textAlign: 'center', fontSize: 12, marginBottom: 15 }}>
              Oyuncuların puanları ve mevkileri dikkate alınarak iki takımın gücü eşitlendi.
            </Text>

            {suggestedStats && (
              <View style={styles.statsComparisonRow}>
                <View style={[styles.teamStrengthBox, { borderColor: '#2196F3' }]}>
                  <Text style={{ color: '#2196F3', fontSize: 12, fontWeight: 'bold' }}>A TAKIMI GÜCÜ</Text>
                  <Text style={{ color: '#FFF', fontSize: 24, fontWeight: '900' }}>{suggestedStats.teamA_overall}</Text>
                </View>
                <Text style={{ color: '#64748B', fontWeight: 'bold', fontSize: 18 }}>VS</Text>
                <View style={[styles.teamStrengthBox, { borderColor: '#F44336' }]}>
                  <Text style={{ color: '#F44336', fontSize: 12, fontWeight: 'bold' }}>B TAKIMI GÜCÜ</Text>
                  <Text style={{ color: '#FFF', fontSize: 24, fontWeight: '900' }}>{suggestedStats.teamB_overall}</Text>
                </View>
              </View>
            )}

            {/* Tactical Football Pitch View */}
            <View style={styles.pitchContainer}>
              {/* Pitch Line markings */}
              <View style={styles.pitchCenterLine} />
              <View style={styles.pitchCenterCircle} />
              <View style={styles.pitchTopBox} />
              <View style={styles.pitchBottomBox} />

              {/* Render Team A Suggested Players (Top Half) */}
              {(() => {
                const coords = getCoordinates(suggestedTeamA, true);
                return suggestedTeamA.map((p) => {
                  const pos = coords[p.id] || { x: 160, y: 100 };
                  const firstName = p.name ? p.name.split(' ')[0] : 'Oyuncu';
                  return (
                    <View key={p.id} style={[styles.pitchPlayerMarker, { left: pos.x - 18, top: pos.y - 18, backgroundColor: '#2196F3' }]}>
                      <Text style={styles.pitchPlayerText}>{p.overall}</Text>
                      <View style={styles.pitchPlayerNameTag}>
                        <Text style={styles.pitchPlayerNameText} numberOfLines={1}>{firstName}</Text>
                      </View>
                    </View>
                  );
                });
              })()}

              {/* Render Team B Suggested Players (Bottom Half) */}
              {(() => {
                const coords = getCoordinates(suggestedTeamB, false);
                return suggestedTeamB.map((p) => {
                  const pos = coords[p.id] || { x: 160, y: 340 };
                  const firstName = p.name ? p.name.split(' ')[0] : 'Oyuncu';
                  return (
                    <View key={p.id} style={[styles.pitchPlayerMarker, { left: pos.x - 18, top: pos.y - 18, backgroundColor: '#F44336' }]}>
                      <Text style={styles.pitchPlayerText}>{p.overall}</Text>
                      <View style={styles.pitchPlayerNameTag}>
                        <Text style={styles.pitchPlayerNameText} numberOfLines={1}>{firstName}</Text>
                      </View>
                    </View>
                  );
                });
              })()}
            </View>

            <TouchableOpacity style={styles.saveBtn} onPress={handleApplySuggestedTeams} disabled={saveTeamsLoading}>
               <LinearGradient colors={['#00C853', '#B2FF59']} start={{x: 0, y: 0}} end={{x: 1, y: 0}} style={styles.saveBtnGradient}>
                 <Text style={styles.saveBtnText}>{saveTeamsLoading ? 'KAYDEDİLİYOR...' : 'TAKIMLARI SAHAYA SÜR (KAYDET) ⚽'}</Text>
               </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelBtn} onPress={() => setSuggestedTeamsModalVisible(false)}>
               <Text style={[styles.cancelBtnText, { color: '#94A3B8' }]}>Vazgeç</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0F172A', ...(Platform.OS === 'web' ? { height: '100vh' as any, overflow: 'auto' as any } : {}) },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 15 },
  backButton: { padding: 5, marginLeft: -5 },
  headerTitle: { fontSize: 20, fontWeight: "bold", color: "#FFFFFF" },
  container: { flex: 1, paddingHorizontal: 20 },
  infoCard: { borderRadius: 20, padding: 20, marginTop: 10, borderWidth: 1, borderColor: "rgba(0, 230, 118, 0.2)" },
  infoTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  matchTitle: { fontSize: 22, fontWeight: "800", color: "#FFFFFF", flex: 1 },
  infoRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  infoIcon: { marginRight: 15 },
  infoText: { color: "#E2E8F0", fontSize: 16 },
  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.1)", marginVertical: 15 },
  organizerRow: { flexDirection: "row", alignItems: "center" },
  organizerAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(0, 230, 118, 0.1)", justifyContent: "center", alignItems: "center", marginRight: 10, borderWidth: 1, borderColor: "rgba(0, 230, 118, 0.3)" },
  organizerText: { color: "#94A3B8", fontSize: 14 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 30, marginBottom: 15 },
  sectionTitle: { fontSize: 18, fontWeight: "bold", color: "#FFFFFF" },
  divideButton: { backgroundColor: 'rgba(255, 193, 7, 0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255, 193, 7, 0.5)' },
  divideButtonText: { color: '#FFC107', fontWeight: 'bold', fontSize: 13 },
  teamsSplitContainer: { marginTop: 0 },
  teamContainer: { backgroundColor: "rgba(255, 255, 255, 0.02)", borderRadius: 20, padding: 15, borderWidth: 1, borderColor: "rgba(255, 255, 255, 0.05)", marginBottom: 15 },
  teamHeader: { fontSize: 16, fontWeight: 'bold', marginBottom: 15, textAlign: 'center' },
  teamABadge: { backgroundColor: 'rgba(33, 150, 243, 0.15)' },
  teamAText: { color: '#2196F3' },
  teamBBadge: { backgroundColor: 'rgba(244, 67, 54, 0.15)' },
  teamBText: { color: '#F44336' },
  playersContainer: { backgroundColor: "rgba(255, 255, 255, 0.03)", borderRadius: 20, padding: 15, borderWidth: 1, borderColor: "rgba(255, 255, 255, 0.05)" },
  playerCard: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 15, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.05)", paddingBottom: 15 },
  playerLeft: { flexDirection: "row", alignItems: "center" },
  playerAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#334155", justifyContent: "center", alignItems: "center", marginRight: 15 },
  playerInitial: { color: "#FFFFFF", fontWeight: "bold", fontSize: 16 },
  playerName: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  playerPosition: { color: "#94A3B8", fontSize: 13, marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusApproved: { backgroundColor: "rgba(0, 230, 118, 0.15)" },
  statusPending: { backgroundColor: "rgba(245, 158, 11, 0.15)" },
  statusText: { fontSize: 12, fontWeight: "bold" },
  statusTextApproved: { color: "#00E676" },
  statusTextPending: { color: "#F59E0B" },
  mvpCard: { backgroundColor: 'rgba(255, 215, 0, 0.08)', borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: 'rgba(255, 215, 0, 0.3)', alignItems: 'center' },
  mvpLabel: { color: '#FFD700', fontSize: 12, fontWeight: 'bold', letterSpacing: 1 },
  mvpName: { color: '#FFFFFF', fontSize: 20, fontWeight: '900', marginTop: 6 },
  mvpVotes: { color: '#FFD700', fontSize: 14, fontWeight: '600' },
  mvpEmpty: { color: '#94A3B8', fontSize: 14, marginTop: 6 },
  mvpBtn: { backgroundColor: '#FFD700', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24, marginTop: 12 },
  mvpBtnText: { color: '#0F172A', fontWeight: 'bold', fontSize: 15 },
  mvpHint: { color: '#94A3B8', fontSize: 12, marginTop: 10, textAlign: 'center' },
  locationCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#1E293B", borderRadius: 16, padding: 16, marginTop: 12, marginBottom: 20, borderWidth: 1, borderColor: "rgba(0, 230, 118, 0.2)" },
  locationName: { color: "#FFFFFF", fontSize: 16, fontWeight: "bold" },
  locationSub: { color: "#94A3B8", fontSize: 13, marginTop: 2 },
  footer: { position: "absolute", bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20, backgroundColor: "#0F172A", borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" },
  lockHint: { color: '#94A3B8', fontSize: 12, marginTop: 2 },
  lockedBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(148, 163, 184, 0.1)', borderRadius: 14, padding: 14 },
  lockedText: { color: '#CBD5E1', fontSize: 14, flex: 1, lineHeight: 20 },
  finishBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#00E676', borderRadius: 14, paddingVertical: 16 },
  finishBtnText: { color: '#0F172A', fontWeight: 'bold', fontSize: 16 },
  levelChip: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.04)' },
  levelChipText: { color: '#E2E8F0', fontSize: 12, fontWeight: '600' },
  answerPrompt: { color: "#94A3B8", fontSize: 13, textAlign: "center", marginBottom: 10 },
  answerRow: { flexDirection: "row", gap: 10 },
  answerBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5 },
  answerBtnText: { fontSize: 16, fontWeight: "bold" },
  tallyRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  tallyChip: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 12, borderWidth: 1, backgroundColor: "rgba(255,255,255,0.03)" },
  tallyNum: { fontSize: 22, fontWeight: "900" },
  tallyLabel: { color: "#94A3B8", fontSize: 11, marginTop: 2 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1E293B', borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 25, paddingBottom: 40, borderTopWidth: 1, borderTopColor: 'rgba(0, 230, 118, 0.3)' },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 20, textAlign: 'center' },
  ratingLabel: { color: '#FFF', fontSize: 16, fontWeight: 'bold', flex: 1 },
  ratingInput: { backgroundColor: 'rgba(0,0,0,0.3)', color: '#FFF', width: 60, textAlign: 'center', borderRadius: 8, height: 40, fontSize: 18, fontWeight: 'bold', marginRight: 10, borderWidth: 1, borderColor: '#FFC107' },
  saveBtn: { borderRadius: 16, overflow: 'hidden', marginBottom: 15, marginTop: 20 },
  saveBtnGradient: { paddingVertical: 18, alignItems: 'center' },
  saveBtnText: { color: '#000', fontSize: 16, fontWeight: 'bold', letterSpacing: 1 },
  cancelBtn: { paddingVertical: 15, alignItems: 'center' },
  cancelBtnText: { color: '#EF4444', fontSize: 16, fontWeight: 'bold' },
  statsComparisonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 20,
    marginBottom: 5
  },
  teamStrengthBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    marginHorizontal: 10
  },
  pitchContainer: {
    width: 320,
    height: 440,
    backgroundColor: '#1B5E20',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    position: 'relative',
    overflow: 'hidden',
    alignSelf: 'center',
    marginVertical: 10,
  },
  pitchCenterLine: {
    position: 'absolute',
    top: 220,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  pitchCenterCircle: {
    position: 'absolute',
    top: 180,
    left: 120,
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.5)',
  },
  pitchTopBox: {
    position: 'absolute',
    top: 0,
    left: 60,
    width: 200,
    height: 65,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    borderTopWidth: 0,
  },
  pitchBottomBox: {
    position: 'absolute',
    bottom: 0,
    left: 60,
    width: 200,
    height: 65,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    borderBottomWidth: 0,
  },
  pitchPlayerMarker: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  pitchPlayerText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  pitchPlayerNameTag: {
    position: 'absolute',
    bottom: -16,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    maxWidth: 70,
  },
  pitchPlayerNameText: {
    color: '#F8FAFC',
    fontSize: 8,
    fontWeight: 'bold',
  },
});
