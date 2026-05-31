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
  Platform
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { API_URL } from "../config/api";

const getCoordinates = (team: any[], isTeamA: boolean) => {
  const width = 320;
  const height = 440;
  
  // Group players by role
  const gk = team.filter((p: any) => (p.position || '').toLowerCase().includes('kaleci'));
  const def = team.filter((p: any) => (p.position || '').toLowerCase().includes('defans') || (p.position || '').toLowerCase().includes('stoper') || (p.position || '').toLowerCase().includes('bek'));
  const fwd = team.filter((p: any) => (p.position || '').toLowerCase().includes('forvet') || (p.position || '').toLowerCase().includes('santrafor') || (p.position || '').toLowerCase().includes('kanat'));
  // Anyone else is mid
  const mid = team.filter((p: any) => !gk.includes(p) && !def.includes(p) && !fwd.includes(p));

  const coords: { [userId: string]: { x: number; y: number } } = {};

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

export default function MatchDetailsScreen({ route, navigation }: any) {
  const matchInfo = route.params?.match || {};
  const user = route.params?.user || {};

  const [players, setPlayers] = useState<any[]>([]);
  const [isJoined, setIsJoined] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const [matchStatus, setMatchStatus] = useState(matchInfo.status || 'OPEN');
  const [matchScore, setMatchScore] = useState(matchInfo.score || '');
  const [matchTimestamp, setMatchTimestamp] = useState(matchInfo.matchTimestamp || 0);
  
  // Chat
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');

  // Finish Match
  const [finishModalVisible, setFinishModalVisible] = useState(false);
  const [scoreA, setScoreA] = useState('');
  const [scoreB, setScoreB] = useState('');
  const [playerGoals, setPlayerGoals] = useState<{[userId: string]: number}>({});

  // Rating
  const [ratingModalVisible, setRatingModalVisible] = useState(false);
  const [ratingTarget, setRatingTarget] = useState<any>(null);
  const [ratingScores, setRatingScores] = useState({ speed: 60, shoot: 60, pass: 60, physique: 60 });

  // MVP
  const [mvpModalVisible, setMvpModalVisible] = useState(false);
  const [matchMvp, setMatchMvp] = useState<any>(null);

  // Weather
  const [weather, setWeather] = useState<{temp: number, icon: string, desc: string} | null>(null);

  // Müsaitlik önerileri
  const [suggested, setSuggested] = useState<any[]>([]);

  // AI Team Suggestion Preview States
  const [suggestedTeamsModalVisible, setSuggestedTeamsModalVisible] = useState(false);
  const [suggestedTeamA, setSuggestedTeamA] = useState<any[]>([]);
  const [suggestedTeamB, setSuggestedTeamB] = useState<any[]>([]);
  const [suggestedStats, setSuggestedStats] = useState<{teamA_overall: number, teamB_overall: number} | null>(null);
  const [saveTeamsLoading, setSaveTeamsLoading] = useState(false);
  const [suggestedInfo, setSuggestedInfo] = useState<{
    dayOfWeek: number | null;
    matchMinutes: number | null;
    message?: string;
  } | null>(null);
  const [suggestedLoading, setSuggestedLoading] = useState(false);

  const fetchWeather = async (loc: string, matchDateStr: string) => {
    try {
       let lat = 41.0082; 
       let lon = 28.9784;

       try {
          const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(loc || 'İstanbul')}&count=1`);
          const geoData = await geoRes.json();
          if (geoData.results && geoData.results.length > 0) {
             lat = geoData.results[0].latitude;
             lon = geoData.results[0].longitude;
          }
       } catch(e) {} // Lokasyon bulunamazsa varsayılanda kal

       // Hava durumunu al (Günlük Tahmin)
       const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max&timezone=auto`);
       const weatherData = await weatherRes.json();
       
       if (weatherData && weatherData.daily) {
          let dayIndex = 0; // Default: Bugün
          if (matchDateStr) {
             // API tarih formatı "YYYY-MM-DD". Kullanıcının girdiği tarihte (örn: 15.04.2026) o gün ve ay uyuşuyor mu diye kaba bir kontrol yapalım.
             const foundIdx = weatherData.daily.time.findIndex((t: string) => {
                const parts = t.split('-');
                return matchDateStr.includes(parts[2]) && matchDateStr.includes(parts[1]);
             });
             if (foundIdx !== -1) dayIndex = foundIdx;
          }

          const code = weatherData.daily.weathercode[dayIndex];
          const temp = Math.round(weatherData.daily.temperature_2m_max[dayIndex]);
          let icon = '☀️'; let desc = 'Güneşli (Açık)';
          
          if (code >= 1 && code <= 3) { icon = '⛅'; desc = 'Bulutlu'; }
          else if (code >= 45 && code <= 48) { icon = '🌫'; desc = 'Sisli'; }
          else if (code >= 51 && code <= 67) { icon = '🌧'; desc = 'Yağmurlu'; }
          else if (code >= 71 && code <= 77) { icon = '❄️'; desc = 'Karlı'; }
          else if (code >= 80 && code <= 82) { icon = '🌦'; desc = 'Sağanak Bekleniyor'; }
          else if (code >= 95) { icon = '⛈️'; desc = 'Fırtına'; }
          
          setWeather({ temp, icon, desc });
       }
    } catch(e) {
       console.log('Weather err:', e);
    }
  };

  const fetchSuggested = async () => {
    if (!matchInfo.id) return;
    setSuggestedLoading(true);
    try {
      const res = await fetch(`${API_URL}/matches/${matchInfo.id}/suggested-players`);
      const data = await res.json();
      if (res.ok) {
        setSuggested(Array.isArray(data.suggested) ? data.suggested : []);
        setSuggestedInfo({
          dayOfWeek: data.dayOfWeek ?? null,
          matchMinutes: data.matchMinutes ?? null,
          message: data.message,
        });
      }
    } catch (e) {
      console.log("Öneriler alınamadı", e);
    }
    setSuggestedLoading(false);
  };

  const openAvailability = () => {
    navigation.navigate("Availability" as never, { user } as never);
  };

  useEffect(() => {
    if (matchInfo.id) {
      fetchMatchInfo();
      fetchPlayers();
      fetchMessages();
      fetchSuggested();
      fetchMvp();
      if (matchInfo.location) fetchWeather(matchInfo.location, String(matchInfo.date || ""));
    }
  }, [matchInfo.id]);

  const fetchMatchInfo = async () => {
    try {
      const res = await fetch(`${API_URL}/matches/${matchInfo.id}`);
      const data = await res.json();
      if (data.status) setMatchStatus(data.status);
      if (data.score) setMatchScore(data.score);
      if (data.matchTimestamp) setMatchTimestamp(data.matchTimestamp);
    } catch(e) {}
  };

  const fetchMvp = async () => {
    try {
      const res = await fetch(`${API_URL}/matches/${matchInfo.id}/mvp`);
      const data = await res.json();
      if (data.mvp) setMatchMvp(data.mvp);
    } catch(e) {}
  };

  const fetchPlayers = async () => {
    try {
      const res = await fetch(`${API_URL}/matches/${matchInfo.id}/players`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setPlayers(data);
        const userInMatch = data.some((p) => p.id === user.id);
        setIsJoined(userInMatch);
      }
    } catch (e) {
      console.log("Oyuncular getirilemedi", e);
    }
  };

  const fetchMessages = async () => {
    try {
      const res = await fetch(`${API_URL}/matches/${matchInfo.id}/messages`);
      const data = await res.json();
      if(Array.isArray(data)) setMessages(data);
    } catch(e) {}
  };

  const handleSendMessage = async () => {
    if(!newMessage.trim()) return;
    try {
       await fetch(`${API_URL}/matches/${matchInfo.id}/messages`, {
         method: 'POST',
         headers: {'Content-Type': 'application/json'},
         body: JSON.stringify({ userId: user.id, message: newMessage })
       });
       setNewMessage('');
       fetchMessages();
    } catch(e) {}
  };

  const submitFinishMatch = async () => {
    try {
      const finalScore = (scoreA && scoreB) ? `${scoreA} - ${scoreB}` : '';
      const scorersData = Object.entries(playerGoals).map(([userId, goals]) => ({userId, goals}));
      const res = await fetch(`${API_URL}/matches/${matchInfo.id}/finish`, { 
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ score: finalScore, scorers: scorersData })
      });
      if (res.ok) {
        setMatchStatus('COMPLETED');
        if (finalScore) setMatchScore(finalScore);
        setFinishModalVisible(false);
        fetchPlayers();
        fetchMessages();
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
    setRatingScores({ speed: 60, shoot: 60, pass: 60, physique: 60 });
    setRatingModalVisible(true);
  };

  const submitRating = async () => {
    if(!ratingTarget) return;
    try {
       const res = await fetch(`${API_URL}/matches/${matchInfo.id}/rate`, {
         method: 'POST',
         headers: {'Content-Type': 'application/json'},
         body: JSON.stringify({ 
            raterId: user.id, 
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
      const res = await fetch(`${API_URL}/matches/${matchInfo.id}/mvp`, {
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

  const leaveMatch = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/matches/${matchInfo.id}/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await res.json();
      if(res.ok) {
        setIsJoined(false);
        fetchPlayers();
      } else {
        Alert.alert("Başarısız", data.error || "Çıkış yapılamadı");
      }
    } catch (e) {
      Alert.alert("Hata", "Bağlantı sorunu");
    }
    setLoading(false);
  };

  const handleJoinLeave = async () => {
    if (isJoined) {
      if (Platform.OS === 'web') {
        if (window.confirm("Maçtan çıkmak istediğine emin misin?")) {
           await leaveMatch();
        }
      } else {
        Alert.alert("Emin misin?", "Maçtan çıkmak istediğine emin misin?", [
          { text: "İptal", style: "cancel" },
          { text: "Çık", style: "destructive", onPress: leaveMatch }
        ]);
      }
    } else {
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/matches/${matchInfo.id}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.id }),
        });
        const data = await res.json();
        if (res.ok) {
          setIsJoined(true);
          fetchPlayers();
          Alert.alert("Harika!", data.message || "Maça katıldın!");
        } else {
          Alert.alert("Hata", data.error || "Katılım başarısız oldu.");
        }
      } catch (e) {
        Alert.alert("Hata", "Sistem hatası yaşandı.");
      }
      setLoading(false);
    }
  };

  const handleCancelMatch = async () => {
    const performCancel = async () => {
      try {
        const res = await fetch(`${API_URL}/matches/${matchInfo.id}`, {
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
      const res = await fetch(`${API_URL}/matches/${matchInfo.id}/suggest-teams`);
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
      const res = await fetch(`${API_URL}/matches/${matchInfo.id}/save-teams`, {
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
  const reserves = players.filter((p: any) => p.status === 'RESERVE');
  const pendingPlayers = players.filter((p: any) => p.status === 'PENDING');
  const declinedPlayers = players.filter((p: any) => p.status === 'DECLINED');

  const teamA = activePlayers.filter((p: any) => p.team === 'A');
  const teamB = activePlayers.filter((p: any) => p.team === 'B');
  const unassigned = activePlayers.filter((p: any) => p.team !== 'A' && p.team !== 'B');
  const teamsDivided = teamA.length > 0 || teamB.length > 0;

  const renderPlayerCard = (player: any, idx: number, badgeText: string, badgeStyle: any, textStyle: any) => {
    const isCompleted = matchStatus === 'COMPLETED';
    const Wrapper: any = isCompleted ? TouchableOpacity : View;
    
    return (
      <Wrapper key={idx} style={styles.playerCard} onPress={isCompleted ? () => openRatingModal(player) : undefined}>
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
        <View style={[styles.statusBadge, isCompleted ? {backgroundColor: 'rgba(255, 193, 7, 0.2)'} : badgeStyle]}>
          <Text style={[styles.statusText, isCompleted ? {color: '#FFC107'} : textStyle]}>
            {isCompleted ? (player.id === user.id ? 'Sen' : 'Puanla ⭐') : String(badgeText)}
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
            fetchMessages();
            fetchSuggested();
            fetchMvp();
          }}
        >
          <Ionicons name="refresh" size={24} color="#00E676" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <LinearGradient colors={["#1E293B", "#0F172A"]} style={styles.infoCard}>
          <View style={styles.infoTop}>
            <Text style={styles.matchTitle}>{String(matchInfo.location || "Bilinmeyen Saha")}</Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={20} color="#00E676" style={styles.infoIcon} />
            <Text style={styles.infoText}>{String(matchInfo.date)} • {String(matchInfo.time)}</Text>
          </View>
          
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
            <Text style={styles.organizerText}>
              Durum: <Text style={styles.organizerName}>{matchStatus === 'COMPLETED' ? 'Tamamlandı' : 'Açık'}</Text>
            </Text>
            {matchStatus === 'OPEN' && (user.role === 'ORGANIZER' || matchInfo.creatorId === user.id) && (
              (matchTimestamp && Date.now() < matchTimestamp) ? (
                <TouchableOpacity style={{marginLeft: 'auto', backgroundColor: '#EF4444', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8}} onPress={handleCancelMatch}>
                   <Text style={{color: '#fff', fontSize: 13, fontWeight: 'bold'}}>Maçı İptal Et</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={{marginLeft: 'auto', backgroundColor: '#EF4444', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8}} onPress={() => setFinishModalVisible(true)}>
                   <Text style={{color: '#fff', fontSize: 13, fontWeight: 'bold'}}>Maçı Bitir</Text>
                </TouchableOpacity>
              )
            )}
          </View>
          {matchStatus === 'COMPLETED' && (matchScore || matchInfo.score) ? (
             <View style={{marginTop: 15, padding: 15, backgroundColor: 'rgba(255, 193, 7, 0.1)', borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255, 193, 7, 0.3)'}}>
                <Text style={{color: '#FFC107', fontSize: 13, fontWeight: 'bold', marginBottom: 5}}>MAÇ SONUCU</Text>
                <Text style={{color: '#FFF', fontSize: 24, fontWeight: '900', letterSpacing: 2}}>{matchInfo.teamAName || 'A Takımı'}  {matchScore || matchInfo.score}  {matchInfo.teamBName || 'B Takımı'}</Text>
             </View>
          ) : null}


        </LinearGradient>

        {matchStatus === "OPEN" && (
          <View style={styles.suggestSection}>
            <View style={styles.suggestHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.suggestTitle}>Müsaitliğe göre öneriler</Text>
                {suggestedInfo?.dayOfWeek != null && suggestedInfo?.matchMinutes != null ? (
                  <Text style={styles.suggestSub}>
                    Gün: {["Pz", "Pt", "Sa", "Ça", "Pe", "Cu", "Ct"][suggestedInfo.dayOfWeek] ?? suggestedInfo.dayOfWeek}{" "}
                    • Maç saati (dk): {suggestedInfo.matchMinutes} (
                    {String(Math.floor(suggestedInfo.matchMinutes / 60)).padStart(2, "0")}:
                    {String(suggestedInfo.matchMinutes % 60).padStart(2, "0")})
                  </Text>
                ) : suggestedInfo?.message ? (
                  <Text style={styles.suggestSub}>{suggestedInfo.message}</Text>
                ) : null}
              </View>
              <TouchableOpacity
                onPress={fetchSuggested}
                disabled={suggestedLoading}
                style={{ padding: 6 }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="refresh" size={20} color={suggestedLoading ? "#64748B" : "#00E676"} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={openAvailability} style={styles.availBtn} activeOpacity={0.85}>
              <Ionicons name="calendar-outline" size={18} color="#0F172A" style={{ marginRight: 8 }} />
              <Text style={styles.availBtnText}>Müsaitliklerimi düzenle</Text>
            </TouchableOpacity>
            {suggested.length > 0 ? (
              <View style={styles.suggestList}>
                {suggested.map((p: any) => (
                  <View key={p.id} style={styles.suggestRow}>
                    <View style={styles.playerAvatar}>
                      {p.avatar ? (
                        <Image
                          source={{ uri: p.avatar }}
                          style={{ width: 36, height: 36, borderRadius: 18 }}
                        />
                      ) : (
                        <Text style={styles.playerInitial}>
                          {String(p.name?.charAt(0) || "?")}
                        </Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.suggestName}>{String(p.name)}</Text>
                      <Text style={styles.suggestPos}>{String(p.position || "Oyuncu")}</Text>
                    </View>
                    {p.playedRecentGroupMatch ? (
                      <View style={styles.badgeDim}>
                        <Text style={styles.badgeDimText}>Son maçlarda oynadı</Text>
                      </View>
                    ) : (
                      <View style={styles.badgeOk}>
                        <Text style={styles.badgeOkText}>Öncelik</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            ) : !suggestedLoading && suggestedInfo?.dayOfWeek != null ? (
              <Text style={styles.suggestEmpty}>
                Bu aralıkta uygun (kadro dışı) grup üyesi yok. Müsaitlik ekle veya farklı saat dene.
              </Text>
            ) : null}
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Kadro ({String(activePlayers.length)}/{String(matchInfo.maxPlayers || 14)})</Text>
          {matchStatus === 'OPEN' && (
            <TouchableOpacity onPress={handleDivideTeams} style={styles.divideButton}>
              <Text style={styles.divideButtonText}>Takım Böl 🎲</Text>
            </TouchableOpacity>
          )}
        </View>

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
            {pendingPlayers.length > 0 && (
               <View style={{marginTop: 20}}>
                  <Text style={[styles.sectionTitle, {fontSize: 14, marginBottom: 10, color: '#A0A0A0'}]}>Cevap Bekleyenler ({pendingPlayers.length})</Text>
                  {pendingPlayers.map((player: any, idx: number) => renderPlayerCard(player, idx, "BEKLİYOR", {backgroundColor: 'rgba(255,255,255,0.1)'}, {color: '#94A3B8'}))}
               </View>
            )}
            {declinedPlayers.length > 0 && (
               <View style={{marginTop: 20}}>
                  <Text style={[styles.sectionTitle, {fontSize: 14, marginBottom: 10, color: '#F44336'}]}>Reddedenler ({declinedPlayers.length})</Text>
                  {declinedPlayers.map((player: any, idx: number) => renderPlayerCard(player, idx, "İPTAL", {backgroundColor: 'rgba(244,67,54,0.1)'}, {color: '#F44336'}))}
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

            {pendingPlayers.length > 0 || declinedPlayers.length > 0 ? (
               <View style={[styles.teamContainer, {borderColor: 'rgba(255,255,255,0.05)'}]}>
                  <Text style={[styles.teamHeader, { color: '#A0A0A0' }]}>Grup Üyeleri Durumu</Text>
                  {pendingPlayers.map((player: any, idx: number) => renderPlayerCard(player, idx, "BEKLİYOR", {backgroundColor: 'rgba(255,255,255,0.1)'}, {color: '#94A3B8'}))}
                  {declinedPlayers.map((player: any, idx: number) => renderPlayerCard(player, idx, "REDDETTİ", {backgroundColor: 'rgba(244,67,54,0.1)'}, {color: '#F44336'}))}
               </View>
            ) : null}
          </View>
        )}

        <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Soyunma Odası (Sohbet)</Text>
        </View>
        <View style={styles.chatContainer}>
            {messages.map(m => (
               <View key={m.id} style={[(m.name === user.name) ? styles.myMsg : styles.otherMsg]}>
                 <Text style={styles.msgName}>{(m.name === user.name) ? 'Sen' : m.name}</Text>
                 <Text style={styles.msgText}>{m.message}</Text>
               </View>
            ))}
            {messages.length === 0 && <Text style={{color:'#A0A0A0', alignSelf:'center', marginVertical:10}}>İlk mesajı sen gönder!</Text>}
            <View style={styles.chatInputRow}>
               <TextInput 
                  style={styles.chatInput} 
                  placeholder="Mesaj yaz..." 
                  placeholderTextColor="#888" 
                  value={newMessage} 
                  onChangeText={setNewMessage} 
               />
               <TouchableOpacity style={styles.chatSendBtn} onPress={handleSendMessage}>
                  <Ionicons name="send" size={20} color="#fff" />
               </TouchableOpacity>
            </View>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {matchStatus === 'OPEN' && (
        <View style={styles.footer}>
          <TouchableOpacity style={styles.actionBtn} activeOpacity={0.8} onPress={handleJoinLeave} disabled={loading}>
            <LinearGradient
              colors={isJoined ? ["#ef4444", "#dc2626"] : ["#00C853", "#B2FF59"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.actionBtnGradient}
            >
              <Text style={styles.actionBtnText}>{loading ? "BEKLEYİN..." : isJoined ? "MAÇTAN ÇIK" : "BEN DE VARIM (KATIL)"}</Text>
            </LinearGradient>
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
                  {players.map((p: any) => (
                     <View key={p.id} style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, backgroundColor: 'rgba(255,255,255,0.05)', padding: 10, borderRadius: 10}}>
                        <Text style={{color: '#FFF', flex: 1}} numberOfLines={1}>{p.name} ({p.team ? p.team + ' Takımı' : 'Yedek'})</Text>
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
            
            {(['speed', 'shoot', 'pass', 'physique'] as const).map(skill => {
              const labelMap: any = { speed: 'Hız', shoot: 'Şut', pass: 'Pas', physique: 'Fizik' };
              return (
                <View key={skill} style={styles.ratingRow}>
                  <Text style={styles.ratingLabel}>{labelMap[skill]}</Text>
                  <TextInput 
                    style={styles.ratingInput} 
                    keyboardType="numeric" 
                    value={String(ratingScores[skill])}
                    onChangeText={(val) => {
                      const num = parseInt(val) || 0;
                      if(num >= 0 && num <= 99) setRatingScores(prev => ({...prev, [skill]: num}));
                    }}
                  />
                  <Text style={{color:'#A0A0A0'}}>/ 99</Text>
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
            <Text style={[styles.modalTitle, { color: '#00E676', fontSize: 18, marginBottom: 5 }]}>🤖 Yapay Zeka Dengeli Takım Önerisi</Text>
            <Text style={{ color: '#94A3B8', textAlign: 'center', fontSize: 12, marginBottom: 15 }}>
              Oyuncuların güç puanları ve mevkileri analiz edilerek en adil dağılım yapılmıştır.
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
  organizerName: { color: "#FFFFFF", fontWeight: "600" },
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
  footer: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 20, backgroundColor: "#0F172A", borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.05)" },
  actionBtn: { borderRadius: 16, overflow: "hidden" },
  actionBtnGradient: { paddingVertical: 18, alignItems: "center" },
  actionBtnText: { color: "#000000", fontSize: 18, fontWeight: "bold" },
  
  chatContainer: { backgroundColor: "rgba(255, 255, 255, 0.03)", borderRadius: 20, padding: 15, borderWidth: 1, borderColor: "rgba(255, 255, 255, 0.05)" },
  myMsg: { backgroundColor: 'rgba(0, 230, 118, 0.15)', padding: 10, borderRadius: 10, marginBottom: 10, alignSelf: 'flex-end', minWidth: '50%' },
  otherMsg: { backgroundColor: 'rgba(255, 255, 255, 0.1)', padding: 10, borderRadius: 10, marginBottom: 10, alignSelf: 'flex-start', minWidth: '50%' },
  msgName: { fontSize: 11, color: '#A0A0A0', marginBottom: 4 },
  msgText: { color: '#FFF', fontSize: 14 },
  chatInputRow: { flexDirection: 'row', marginTop: 10, alignItems: 'center' },
  chatInput: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', color: '#FFF', borderRadius: 20, paddingHorizontal: 15, height: 40 },
  chatSendBtn: { backgroundColor: '#00E676', width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginLeft: 10 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1E293B', borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 25, paddingBottom: 40, borderTopWidth: 1, borderTopColor: 'rgba(0, 230, 118, 0.3)' },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 20, textAlign: 'center' },
  ratingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, backgroundColor: 'rgba(255,255,255,0.05)', padding: 15, borderRadius: 15 },
  ratingLabel: { color: '#FFF', fontSize: 16, fontWeight: 'bold', flex: 1 },
  ratingInput: { backgroundColor: 'rgba(0,0,0,0.3)', color: '#FFF', width: 60, textAlign: 'center', borderRadius: 8, height: 40, fontSize: 18, fontWeight: 'bold', marginRight: 10, borderWidth: 1, borderColor: '#FFC107' },
  saveBtn: { borderRadius: 16, overflow: 'hidden', marginBottom: 15, marginTop: 20 },
  saveBtnGradient: { paddingVertical: 18, alignItems: 'center' },
  saveBtnText: { color: '#000', fontSize: 16, fontWeight: 'bold', letterSpacing: 1 },
  cancelBtn: { paddingVertical: 15, alignItems: 'center' },
  cancelBtnText: { color: '#EF4444', fontSize: 16, fontWeight: 'bold' },

  suggestSection: {
    marginTop: 20,
    marginBottom: 4,
    backgroundColor: 'rgba(0, 230, 118, 0.06)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(0, 230, 118, 0.2)',
  },
  suggestHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  suggestTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  suggestSub: { color: '#94A3B8', fontSize: 12, marginTop: 4, lineHeight: 16 },
  availBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00E676',
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  availBtnText: { color: '#0F172A', fontSize: 14, fontWeight: '800' },
  suggestList: { marginTop: 4 },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  suggestName: { color: '#F8FAFC', fontSize: 15, fontWeight: '600' },
  suggestPos: { color: '#94A3B8', fontSize: 12, marginTop: 2 },
  suggestEmpty: { color: '#64748B', fontSize: 13, lineHeight: 18 },
  badgeOk: {
    backgroundColor: 'rgba(0, 230, 118, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeOkText: { color: '#00E676', fontSize: 10, fontWeight: '800' },
  badgeDim: {
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeDimText: { color: '#94A3B8', fontSize: 10, fontWeight: '700' },
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
  }
});
