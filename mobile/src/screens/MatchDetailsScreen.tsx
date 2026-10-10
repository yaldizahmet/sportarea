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
  Share,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { API_URL } from "../config/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { matchLink } from "../utils/invite";
import { formatMatchDate, formatClock, formatMoney, shareOf, DAY_NAMES_SHORT, displayName, realNameHint } from "../utils/format";
import Avatar from "../components/Avatar";
import PitchView from "../components/PitchView";
import { computeLineup, ROLE_LABEL } from "../utils/lineup";

const EDIT_HOURS = ['18:00', '19:00', '20:00', '21:00', '22:00', '23:00', '00:00'];
const EDIT_LOCKOUTS = [0, 1, 3, 6, 12];
const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const pad2 = (n: number) => String(n).padStart(2, '0');
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
// Önümüzdeki 21 gün (bugün dahil), düzenleme penceresindeki gün seçimi için.
const upcomingDays = () => {
  const today = startOfDay(new Date());
  return Array.from({ length: 21 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));
};
const dayLabel = (d: Date, i: number) =>
  i === 0 ? 'Bugün' : i === 1 ? 'Yarın' : `${DAY_NAMES_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;


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
  const [fixingResult, setFixingResult] = useState(false); // bitmiş maçın sonucunu düzeltme
  const [scoreA, setScoreA] = useState('');
  const [scoreB, setScoreB] = useState('');
  const [playerGoals, setPlayerGoals] = useState<{ [id: string]: number }>({});

  // Rating
  const [ratingModalVisible, setRatingModalVisible] = useState(false);
  const [ratingTarget, setRatingTarget] = useState<any>(null);
  const [ratingScores, setRatingScores] = useState<Record<string, number | null>>({ speed: null, shoot: null, pass: null, physique: null });
  const [refreshing, setRefreshing] = useState(false);
  // Saha ücreti
  const [feeModal, setFeeModal] = useState(false);
  const [guestModal, setGuestModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [editLocation, setEditLocation] = useState('');
  const [editDay, setEditDay] = useState<Date | null>(null);
  const [editTime, setEditTime] = useState('21:00');
  const [editMax, setEditMax] = useState('14');
  const [editLock, setEditLock] = useState(3);
  const [editBusy, setEditBusy] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestBusy, setGuestBusy] = useState(false);
  const [feeInput, setFeeInput] = useState('');

  // MVP
  const [mvpModalVisible, setMvpModalVisible] = useState(false);
  const [matchMvp, setMatchMvp] = useState<any>(null);
  const [myMvpVote, setMyMvpVote] = useState<any>(null);

  // Weather
  const [weather, setWeather] = useState<{temp: number, icon: string, desc: string} | null>(null);

  // AI Team Suggestion Preview States
  const [suggestedTeamsModalVisible, setSuggestedTeamsModalVisible] = useState(false);
  // Takım penceresi: A / B / takımsız listeleri elle düzenlenir (oyuncuya dokun -> diğer takıma geçer).
  // Takımların görünümü: liste ya da saha şeması (seçim telefonda hatırlanır)
  const [teamView, setTeamView] = useState<'list' | 'pitch'>('list');
  const [scrollLocked, setScrollLocked] = useState(false); // sahada oyuncu sürüklenirken sayfa kaymasın
  useEffect(() => {
    AsyncStorage.getItem('teamView').then((v) => { if (v === 'pitch' || v === 'list') setTeamView(v); }).catch(() => {});
  }, []);
  const chooseTeamView = (v: 'list' | 'pitch') => {
    setTeamView(v);
    AsyncStorage.setItem('teamView', v).catch(() => {});
  };
  const [editA, setEditA] = useState<any[]>([]);
  const [editB, setEditB] = useState<any[]>([]);
  const [editNone, setEditNone] = useState<any[]>([]);
  const [lastSuggestion, setLastSuggestion] = useState<{ teamA: any[]; teamB: any[] } | null>(null);
  const [nameA, setNameA] = useState('A Takımı');
  const [editCapA, setEditCapA] = useState<string | null>(null);
  const [editCapB, setEditCapB] = useState<string | null>(null);
  const [nameB, setNameB] = useState('B Takımı');
  const [saveTeamsLoading, setSaveTeamsLoading] = useState(false);
  const [groupCreatorId, setGroupCreatorId] = useState(matchInfo.groupCreatorId || null);
  // Takım kurma, maçı bitirme ve iptal: maçı kuran ya da grubun kurucusu (sunucudaki kuralın aynısı)
  // Yetki sunucudan gelir (maçı kuran, grup kurucusu ya da grup yöneticisi); gelmeden önce eski kural.
  const isManager = matchInfo.canManage !== undefined
    ? Boolean(matchInfo.canManage)
    : matchInfo.creatorId === user.id || groupCreatorId === user.id;

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
      setMyMvpVote(data.myVote ?? null);
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

  // Bitmiş maç: skor ve golleri mevcut hâliyle doldurup düzeltme penceresini aç.
  const openFixResult = () => {
    const sc = String(matchScore || matchInfo.score || '');
    const m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(sc);
    setScoreA(m ? m[1] : '');
    setScoreB(m ? m[2] : '');
    const goals: { [id: string]: number } = {};
    players.forEach((p: any) => { if (p.status === 'ACTIVE' && p.goals > 0) goals[p.id] = p.goals; });
    setPlayerGoals(goals);
    setFixingResult(true);
    setFinishModalVisible(true);
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
        setMatchScore(finalScore);
        setFinishModalVisible(false);
        fetchPlayers();
        fetchMatchInfo();
        if (fixingResult) Alert.alert('Düzeltildi', 'Skor ve goller güncellendi.');
        else Alert.alert('Maç Bitti', 'Skor ve golcüler kaydedildi. Artık oyuncuları puanlayabilirsiniz!');
        setFixingResult(false);
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
    // Daha önce puanladıysa verdiği puanlar seçili gelir (değiştirip tekrar kaydedebilir).
    setRatingScores({
      speed: player.mySpeed ?? null,
      shoot: player.myShoot ?? null,
      pass: player.myPass ?? null,
      physique: player.myPhysique ?? null,
    });
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
         // Kartta hemen "✓ Puanladın" görünsün; ortalamalar için listeyi tazele.
         const r = ratingScores;
         setPlayers((prev) => prev.map((p: any) => p.id === ratingTarget.id
           ? { ...p, mySpeed: r.speed, myShoot: r.shoot, myPass: r.pass, myPhysique: r.physique }
           : p));
         fetchPlayers();
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
          setMatchStatus('CANCELLED');
          fetchMatchInfo();
        } else {
          Alert.alert("Hata", data.error || "Maç iptal edilemedi.");
        }
      } catch (e) {
        Alert.alert("Hata", "Bağlantı sorunu yaşandı.");
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm("Maç iptal edilsin mi? Kadro kayıtlı kalır, gruba iptal bildirimi gider.")) {
        await performCancel();
      }
    } else {
      Alert.alert(
        "Maçı İptal Et ❌",
        "Maç iptal edilsin mi? Kadro kayıtlı kalır, gruba iptal bildirimi gider. Maç saati geçmeden geri alabilirsin.",
        [
          { text: "Vazgeç", style: "cancel" },
          { text: "Evet, İptal Et", style: "destructive", onPress: performCancel }
        ]
      );
    }
  };

  // Kadroyu metin olarak paylaş (WhatsApp grubuna atmak için): kim var, kaç yer kaldı, kim cevap vermedi.
  const buildRosterText = () => {
    const nameOf = (p: any) => p.isGuest
      ? `${p.name} (misafir${p.invitedByName ? ` · ${displayName({ name: p.invitedByName, nickname: p.invitedByNickname })}` : ''})`
      : displayName(p) + (p.id === matchInfo.captainA || p.id === matchInfo.captainB ? ' (K)' : '');
    const max = Number(matchInfo.maxPlayers) || activePlayers.length;
    const lines: string[] = [];
    lines.push(`⚽ ${matchInfo.groupName ? `${matchInfo.groupName} · ` : ''}${formatMatchDate({ ...matchInfo, matchTimestamp })}`);
    lines.push(`📍 ${matchInfo.location || 'Saha belirtilmemiş'}`);
    if (isCancelled) {
      lines.push('', '❌ BU MAÇ İPTAL EDİLDİ');
    } else if (isCompleted) {
      const sc = matchScore || matchInfo.score;
      if (sc) lines.push(`🏁 Sonuç: ${matchInfo.teamAName || 'A Takımı'} ${sc} ${matchInfo.teamBName || 'B Takımı'}`);
    }
    lines.push('');
    const free = Math.max(0, max - activePlayers.length);
    lines.push(isCompleted ? `👥 Oynayanlar (${activePlayers.length})` : `👥 Kadro ${activePlayers.length}/${max}${!isCancelled ? (free > 0 ? ` · ${free} yer var` : ' · kadro dolu') : ''}`);
    if (teamsDivided && !isCancelled) {
      lines.push(`🔵 ${matchInfo.teamAName || 'A Takımı'}: ${teamA.map(nameOf).join(', ')}`);
      lines.push(`🔴 ${matchInfo.teamBName || 'B Takımı'}: ${teamB.map(nameOf).join(', ')}`);
      if (unassigned.length) lines.push(`⚪ Takımsız: ${unassigned.map(nameOf).join(', ')}`);
    } else {
      activePlayers.forEach((p: any, i: number) => lines.push(`${i + 1}. ${nameOf(p)}${isCompleted && p.goals > 0 ? ` ⚽${p.goals > 1 ? `x${p.goals}` : ''}` : ''}`));
    }
    if (!isCompleted && !isCancelled) {
      if (reserves.length) lines.push('', `🪑 Yedek: ${reserves.map(nameOf).join(', ')}`);
      if (maybePlayers.length) lines.push(`🤔 Belki: ${maybePlayers.map(nameOf).join(', ')}`);
      if (declinedPlayers.length) lines.push(`🚫 Yok: ${declinedPlayers.map(nameOf).join(', ')}`);
      if (pendingPlayers.length) lines.push(`⏳ Cevap vermeyen: ${pendingPlayers.map(nameOf).join(', ')}`);
      if (pitchFee && share) lines.push('', `💸 Saha ${formatMoney(pitchFee)} · kişi başı ~${formatMoney(share)}`);
    }
    lines.push('', isCompleted || isCancelled ? `Detaylar: ${matchLink(matchInfo.id)}` : `Varım / Yokum demek için: ${matchLink(matchInfo.id)}`);
    return lines.join('\n');
  };

  const handleShareRoster = async () => {
    const message = buildRosterText();
    // Bilgisayar tarayıcılarında paylaşım menüsü yok: panoya kopyala.
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && !(navigator as any).share) {
      try {
        await navigator.clipboard.writeText(message);
        Alert.alert('Kopyalandı', 'Kadro kopyalandı. WhatsApp grubuna yapıştırabilirsin.');
      } catch {
        Alert.alert('Kadro', message);
      }
      return;
    }
    try {
      await Share.share({ message });
    } catch (e) {
      Alert.alert('Hata', 'Paylaşım yapılamadı.');
    }
  };

  const handleRestoreMatch = async () => {
    try {
      const res = await apiFetch(`${API_URL}/matches/${matchInfo.id}/restore`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setMatchStatus('OPEN');
        fetchMatchInfo();
        fetchPlayers();
      } else Alert.alert('Olmadı', data.error || 'Geri alınamadı.');
    } catch (e) {
      Alert.alert('Hata', 'Bağlantı sorunu yaşandı.');
    }
  };

  // Takım penceresini aç: takımlar kuruluysa mevcut hâliyle, değilse dengeli öneriyle başlar.
  const openTeams = async () => {
    try {
      const res = await apiFetch(`${API_URL}/matches/${matchInfo.id}/suggest-teams`);
      const data = await res.json();
      if (!res.ok) {
        Alert.alert('Takım kurulamadı', data.error || 'Takım kurmak için kadroda en az 2 kişi olmalı.');
        return;
      }
      const sugA: any[] = data.teamA || [];
      const sugB: any[] = data.teamB || [];
      setLastSuggestion({ teamA: sugA, teamB: sugB });
      const overall = new Map<string, number>([...sugA, ...sugB].map((p: any) => [p.id, p.overall]));
      const withOverall = (p: any) => ({ ...p, overall: overall.get(p.id) ?? 65 });
      if (teamsDivided) {
        setEditA(teamA.map(withOverall));
        setEditB(teamB.map(withOverall));
        setEditNone(unassigned.map(withOverall));
      } else {
        setEditA(sugA);
        setEditB(sugB);
        setEditNone([]);
      }
      setNameA(String(matchInfo.teamAName || 'A Takımı'));
      setNameB(String(matchInfo.teamBName || 'B Takımı'));
      setEditCapA(teamsDivided ? (matchInfo.captainA ?? null) : null);
      setEditCapB(teamsDivided ? (matchInfo.captainB ?? null) : null);
      setSuggestedTeamsModalVisible(true);
    } catch (e) {
      Alert.alert('Hata', 'Bağlantı sorunu yaşandı.');
    }
  };

  // Oyuncuya dokununca diğer takıma geçer; takımsızsa daha az kişili takıma girer.
  const movePlayer = (p: any) => {
    const inA = editA.some((x) => x.id === p.id);
    const inB = editB.some((x) => x.id === p.id);
    const without = (list: any[]) => list.filter((x) => x.id !== p.id);
    // Takım değiştiren kaptan, kaptanlığını bırakır.
    if (p.id === editCapA) setEditCapA(null);
    if (p.id === editCapB) setEditCapB(null);
    if (inA) { setEditA(without(editA)); setEditB([...editB, p]); }
    else if (inB) { setEditB(without(editB)); setEditA([...editA, p]); }
    else {
      setEditNone(without(editNone));
      if (editA.length <= editB.length) setEditA([...editA, p]); else setEditB([...editB, p]);
    }
  };

  const applySuggestion = () => {
    if (!lastSuggestion) return;
    setEditCapA(null);
    setEditCapB(null);
    setEditA(lastSuggestion.teamA);
    setEditB(lastSuggestion.teamB);
    setEditNone([]);
  };

  // Rastgele karıştır: önce kaleciler iki takıma ayrılır, sonra kalanlar sırayla dağıtılır.
  const shuffleTeams = () => {
    const all = [...editA, ...editB, ...editNone];
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    const isGk = (p: any) => String(p.position || '').toLowerCase().includes('kaleci');
    const ordered = [...all.filter(isGk), ...all.filter((p) => !isGk(p))];
    const a: any[] = [];
    const b: any[] = [];
    ordered.forEach((p, i) => (i % 2 === 0 ? a : b).push(p));
    setEditA(a);
    setEditB(b);
    setEditNone([]);
    setEditCapA(null);
    setEditCapB(null);
  };

  const teamPower = (list: any[]) =>
    list.length ? Math.round(list.reduce((sum, p) => sum + (Number(p.overall) || 65), 0) / list.length) : 0;

  const saveTeamsEdit = async () => {
    setSaveTeamsLoading(true);
    try {
      const res = await apiFetch(`${API_URL}/matches/${matchInfo.id}/save-teams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamA: editA.map((p) => p.id),
          teamB: editB.map((p) => p.id),
          teamAName: nameA,
          teamBName: nameB,
          captainA: editCapA,
          captainB: editCapB,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuggestedTeamsModalVisible(false);
        await Promise.all([fetchPlayers(), fetchMatchInfo()]);
      } else {
        Alert.alert('Hata', data.error || 'Takımlar kaydedilemedi.');
      }
    } catch (e) {
      Alert.alert('Hata', 'Bağlantı sorunu yaşandı.');
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
  // Puanlama ilerlemesi: bu maçta oynayan diğer oyunculardan kaçını puanladım
  const rateable = iPlayed ? players.filter((p: any) => p.status === 'ACTIVE' && p.id !== user.id) : [];
  const rateTotal = rateable.length;
  const rateDone = rateable.filter((p: any) => p.mySpeed != null).length;

  // Maçın aşaması: açık -> kilitli (son değişiklik saati geçti) -> başladı -> tamamlandı
  const ts = Number(matchTimestamp) || 0;
  const lockHours = Number(matchInfo.lockoutHours ?? 0);
  const lockAt = ts ? ts - lockHours * 3600 * 1000 : 0;
  const now = Date.now();
  const isCancelled = matchStatus === 'CANCELLED';
  const phase: 'open' | 'locked' | 'started' | 'completed' | 'cancelled' =
    isCancelled ? 'cancelled' : isCompleted ? 'completed' : ts && now >= ts ? 'started' : lockAt && lockHours > 0 && now >= lockAt ? 'locked' : 'open';
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
  // Maça özel diziliş: sahada ve listede aynı roller (kaleci, defans...) görünür.
  const lineA = computeLineup(teamA, matchInfo.teamAFormation);
  const lineB = computeLineup(teamB, matchInfo.teamBFormation);
  const matchRoleOf = (id: string) => lineA.roleOf.get(id) ?? lineB.roleOf.get(id);
  const bySlot = (line: ReturnType<typeof computeLineup>) => (x: any, y: any) =>
    (line.slotOf.get(x.id) ?? 99) - (line.slotOf.get(y.id) ?? 99);
  // Kaptanlar: takımda olan kaptan geçerli. Diziliş kaptanda; takımın kaptanı yoksa yöneticide.
  const capA: string | null = matchInfo.captainA && teamA.some((p: any) => p.id === matchInfo.captainA) ? matchInfo.captainA : null;
  const capB: string | null = matchInfo.captainB && teamB.some((p: any) => p.id === matchInfo.captainB) ? matchInfo.captainB : null;
  const lineupOpen = !isCompleted && !isCancelled;
  const editableA = lineupOpen && (capA ? capA === user.id : isManager);
  const editableB = lineupOpen && (capB ? capB === user.id : isManager);
  const captainName = (id: string | null) => {
    const p = id ? players.find((x: any) => x.id === id) : null;
    return p ? displayName(p) : '';
  };
  const lineupViewerHint = !lineupOpen ? ''
    : (capA || capB)
      ? `Dizilişi kaptanlar ayarlıyor: ${capA ? `🔵 ${captainName(capA)}` : '🔵 yönetici'} · ${capB ? `🔴 ${captainName(capB)}` : '🔴 yönetici'}`
      : (isManager ? 'İpucu: "Takımları düzenle"den her takıma bir kaptan seçersen dizilişi kaptanlar ayarlar.' : 'Dizilişi yönetici ayarlıyor.');

  const saveLineup = async (c: { team: 'A' | 'B'; formation: string; slots: { userId: string; slot: number }[] }) => {
    // Hemen ekrana yansıt, sonra kaydet.
    const slotMap = new Map(c.slots.map((x) => [x.userId, x.slot]));
    setPlayers((prev) => prev.map((p: any) => (slotMap.has(p.id) ? { ...p, slot: slotMap.get(p.id) } : p)));
    setMatchInfo((prev: any) => ({ ...prev, [c.team === 'A' ? 'teamAFormation' : 'teamBFormation']: c.formation || null }));
    try {
      const res = await apiFetch(`${API_URL}/matches/${matchInfo.id}/lineup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: c.team, formation: c.formation || null, slots: c.slots }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        Alert.alert('Kaydedilemedi', d.error || 'Diziliş kaydedilemedi.');
        fetchPlayers();
        fetchMatchInfo();
      }
    } catch (e) {
      Alert.alert('Hata', 'Bağlantı sorunu yaşandı.');
    }
  };
  const myTeam = players.find((p: any) => p.id === user.id)?.team;
  const iAmCaptain = (myTeam === 'A' && matchInfo.captainA === user.id) || (myTeam === 'B' && matchInfo.captainB === user.id);
  const myTeamLabel = (teamsDivided && myTeam === 'A' ? `🔵 ${matchInfo.teamAName || 'A Takımı'}`
    : teamsDivided && myTeam === 'B' ? `🔴 ${matchInfo.teamBName || 'B Takımı'}` : '') + (teamsDivided && iAmCaptain ? ' · Kaptansın' : '');

  const pitchFee: number | null = matchInfo.pitchFee ?? null;
  const share = shareOf(pitchFee, activePlayers.length);
  const paidCount = activePlayers.filter((p: any) => p.paid).length;
  const me = players.find((p: any) => p.id === user.id);

  const saveFee = async () => {
    try {
      const res = await apiFetch(`${API_URL}/matches/${matchInfo.id}/fee`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fee: feeInput ? parseInt(feeInput, 10) : null }),
      });
      const data = await res.json();
      if (res.ok) {
        setMatchInfo((prev: any) => ({ ...prev, pitchFee: data.pitchFee }));
        setFeeModal(false);
      } else Alert.alert('Olmadı', data.error || 'Kaydedilemedi.');
    } catch (e) {
      Alert.alert('Hata', 'Bağlantı sorunu yaşandı.');
    }
  };

  const togglePaid = async (player: any) => {
    const paid = !player.paid;
    setPlayers((prev) => prev.map((p: any) => (p.id === player.id ? { ...p, paid } : p)));
    try {
      const res = await apiFetch(`${API_URL}/matches/${matchInfo.id}/paid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: player.id, paid }),
      });
      if (!res.ok) throw new Error();
    } catch (e) {
      setPlayers((prev) => prev.map((p: any) => (p.id === player.id ? { ...p, paid: !paid } : p)));
      Alert.alert('Hata', 'Kaydedilemedi.');
    }
  };

  // Maçı düzenle: mevcut bilgilerle pencereyi doldur. Gece maçı (00:00-05:59) bir önceki günün gecesi sayılır.
  const openEdit = () => {
    const ts = Number(matchTimestamp) || Date.now();
    const d = new Date(ts);
    const shown = new Date(d);
    if (d.getHours() < 6) shown.setDate(shown.getDate() - 1);
    setEditLocation(String(matchInfo.location || ''));
    setEditDay(startOfDay(shown));
    setEditTime(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`);
    setEditMax(String(matchInfo.maxPlayers || 14));
    setEditLock(Number(matchInfo.lockoutHours ?? 3));
    setEditModal(true);
  };
  const saveEdit = async () => {
    if (!editDay) return;
    const [h, min] = editTime.split(':').map((x) => parseInt(x, 10));
    const start = new Date(editDay);
    if (h < 6) start.setDate(start.getDate() + 1);
    start.setHours(h, min, 0, 0);
    setEditBusy(true);
    try {
      const res = await apiFetch(`${API_URL}/matches/${matchInfo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: editLocation,
          matchTimestamp: start.getTime(),
          maxPlayers: parseInt(editMax, 10),
          lockoutHours: editLock,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setEditModal(false);
        await Promise.all([fetchMatchInfo(), fetchPlayers()]);
      } else Alert.alert('Olmadı', data.error || 'Kaydedilemedi.');
    } catch (e) {
      Alert.alert('Hata', 'Bağlantı sorunu yaşandı.');
    }
    setEditBusy(false);
  };
  const editHours = EDIT_HOURS.includes(editTime) ? EDIT_HOURS : [editTime, ...EDIT_HOURS];
  const editLocks = EDIT_LOCKOUTS.includes(editLock) ? EDIT_LOCKOUTS : [...EDIT_LOCKOUTS, editLock].sort((a, b) => a - b);

  // Misafir: yanında getirdiğin, uygulamayı kullanmayan arkadaş. Adını yazman yeterli.
  const myGuests = players.filter((p: any) => p.isGuest && p.invitedBy === user.id);
  const addGuest = async () => {
    const name = guestName.trim();
    if (name.length < 2) return Alert.alert('Misafir', 'Misafirin adını yaz.');
    setGuestBusy(true);
    try {
      const res = await apiFetch(`${API_URL}/matches/${matchInfo.id}/guests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (res.ok) {
        setGuestName('');
        await fetchPlayers();
        if (data.guest?.status === 'RESERVE') Alert.alert('Yedeğe yazıldı', data.message);
      } else Alert.alert('Olmadı', data.error || 'Misafir eklenemedi.');
    } catch (e) {
      Alert.alert('Hata', 'Bağlantı sorunu yaşandı.');
    }
    setGuestBusy(false);
  };
  const removeGuest = (guest: any) => {
    Alert.alert('Misafiri çıkar', `${guest.name} kadrodan çıkarılsın mı?`, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Çıkar', style: 'destructive', onPress: async () => {
          try {
            const res = await apiFetch(`${API_URL}/matches/${matchInfo.id}/guests/${guest.id}`, { method: 'DELETE' });
            const data = await res.json();
            if (res.ok) fetchPlayers();
            else Alert.alert('Olmadı', data.error || 'Çıkarılamadı.');
          } catch (e) {
            Alert.alert('Hata', 'Bağlantı sorunu yaşandı.');
          }
        },
      },
    ]);
  };

  const renderPlayerCard = (player: any, idx: number, badgeText: string, badgeStyle: any, textStyle: any) => {
    // Puanlama: maç bitti, ben oynadım, o da oynadı ve kendim değilim.
    const canRate = iPlayed && player.status === 'ACTIVE' && player.id !== user.id;
    const rated = canRate && player.mySpeed != null;
    const Wrapper: any = canRate ? TouchableOpacity : View;

    return (
      <Wrapper key={player.id ?? idx} style={styles.playerCard} onPress={canRate ? () => openRatingModal(player) : undefined}>
        <View style={styles.playerLeft}>
          <View style={styles.playerAvatar}>
            <Avatar user={player} size={40} initialStyle={styles.playerInitial} />
          </View>
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.playerName} numberOfLines={1}>{displayName(player)}</Text>
            {player.isGuest ? (
              <Text style={styles.guestLine} numberOfLines={1}>
                {teamsDivided && (player.id === capA || player.id === capB) ? 'Ⓚ Kaptan · ' : ''}
                {teamsDivided && player.status === 'ACTIVE' && matchRoleOf(player.id) ? `${ROLE_LABEL[matchRoleOf(player.id)!]} · ` : ''}
                Misafir{player.invitedByName ? ` · ${player.invitedBy === user.id ? 'senin' : `${displayName({ name: player.invitedByName, nickname: player.invitedByNickname })} getirdi`}` : ''}
              </Text>
            ) : (
              <Text style={styles.playerPosition} numberOfLines={1}>
                {realNameHint(player) ? `${realNameHint(player)} · ` : ''}
                {teamsDivided && (player.id === capA || player.id === capB) ? 'Ⓚ Kaptan · ' : ''}
                {teamsDivided && player.status === 'ACTIVE' && matchRoleOf(player.id)
                  ? ROLE_LABEL[matchRoleOf(player.id)!]
                  : String(player.position || "Orta Saha")}
              </Text>
            )}
            {(player.goals > 0 || (isCompleted && player.matchRating != null)) && (
              <Text style={{color: '#00E676', fontSize: 12, marginTop: 3, fontWeight: 'bold'}}>
                {player.goals > 0 ? `⚽ ${player.goals} Gol` : ''}
                {player.goals > 0 && isCompleted && player.matchRating != null ? '  ' : ''}
                {isCompleted && player.matchRating != null ? <Text style={{ color: '#FFC107' }}>⭐ {player.matchRating} <Text style={{ color: '#94A3B8', fontWeight: 'normal' }}>({player.matchRatingCount} kişi)</Text></Text> : null}
              </Text>
            )}
            {pitchFee && !isCancelled && player.status === 'ACTIVE' ? (
              isManager ? (
                <TouchableOpacity onPress={() => togglePaid(player)} style={[styles.paidChip, player.paid && styles.paidChipOn]} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Text style={[styles.paidChipText, player.paid && { color: '#0F172A' }]}>{player.paid ? '✓ Ödedi' : 'Ödemedi'}</Text>
                </TouchableOpacity>
              ) : player.paid ? (
                <Text style={{ color: '#00E676', fontSize: 12, marginTop: 3 }}>✓ Ödedi</Text>
              ) : null
            ) : null}
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={[styles.statusBadge, rated ? { backgroundColor: 'rgba(0, 230, 118, 0.15)' } : canRate ? {backgroundColor: 'rgba(255, 193, 7, 0.2)'} : badgeStyle]}>
            <Text style={[styles.statusText, rated ? { color: '#00E676' } : canRate ? {color: '#FFC107'} : textStyle]}>
              {rated ? '✓ Puanladın' : canRate ? 'Puanla ⭐' : isCompleted && player.id === user.id ? 'Sen' : String(badgeText)}
            </Text>
          </View>
          {player.isGuest && !isCompleted && (player.invitedBy === user.id || isManager) ? (
            <TouchableOpacity onPress={() => removeGuest(player)} style={{ marginLeft: 8, padding: 4 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel={`${player.name} misafirini çıkar`}>
              <Ionicons name="close-circle-outline" size={22} color="#94A3B8" />
            </TouchableOpacity>
          ) : null}
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
        <View style={{ flexDirection: 'row' }}>
          <TouchableOpacity style={styles.backButton} onPress={handleShareRoster} accessibilityLabel="Kadroyu paylaş (üst)">
            <Ionicons name="share-social-outline" size={23} color="#38BDF8" />
          </TouchableOpacity>
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
      </View>

      <ScrollView
        style={styles.container}
        scrollEnabled={!scrollLocked}
        showsVerticalScrollIndicator={false}
        refreshControl={Platform.OS === 'web' ? undefined : <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00E676" colors={["#00E676"]} />}
      >
        <LinearGradient colors={["#1E293B", "#0F172A"]} style={styles.infoCard}>
          <View style={styles.infoTop}>
            <Text style={styles.matchTitle}>{String(matchInfo.location || "Bilinmeyen Saha")}</Text>
            {isManager && !isCompleted && !isCancelled ? (
              <TouchableOpacity onPress={openEdit} style={styles.editBtn} accessibilityLabel="Maçı düzenle" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="create-outline" size={18} color="#00E676" />
                <Text style={styles.editBtnText}>Düzenle</Text>
              </TouchableOpacity>
            ) : null}
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
              <Text style={[styles.organizerText, phase === 'cancelled' && { color: '#F87171', fontWeight: 'bold' }]}>
                {phase === 'cancelled' ? 'Maç iptal edildi'
                  : phase === 'completed' ? 'Maç tamamlandı'
                  : phase === 'started' ? 'Maç saati geldi, sonuç bekleniyor'
                  : phase === 'locked' ? 'Kadro kilitlendi'
                  : 'Kadro açık'}
              </Text>
              {phase === 'open' && lockAt > 0 && lockHours > 0 && (
                <Text style={styles.lockHint}>Son değişiklik: {formatClock(lockAt)}</Text>
              )}
            </View>
            {phase === 'cancelled' && isManager && ts > now && (
              <TouchableOpacity style={{backgroundColor: 'rgba(0, 230, 118, 0.12)', borderWidth: 1, borderColor: 'rgba(0, 230, 118, 0.45)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8}} onPress={handleRestoreMatch}>
                 <Text style={{color: '#00E676', fontSize: 13, fontWeight: 'bold'}}>İptali geri al</Text>
              </TouchableOpacity>
            )}
            {(phase === 'open' || phase === 'locked' || phase === 'started') && isManager && (
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
                {isManager ? (
                  <TouchableOpacity onPress={openFixResult} style={{ marginTop: 10 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={{ color: '#FFC107', fontSize: 13, textDecorationLine: 'underline' }}>Sonucu düzelt</Text>
                  </TouchableOpacity>
                ) : null}
             </View>
          ) : isCompleted && isManager ? (
             <TouchableOpacity onPress={openFixResult} style={{ marginTop: 14, alignSelf: 'center' }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
               <Text style={{ color: '#FFC107', fontSize: 13, textDecorationLine: 'underline' }}>Skor girilmemiş, eklemek için dokun</Text>
             </TouchableOpacity>
          ) : null}


        </LinearGradient>

        {/* Saha: her platformda çalışan tek tık yol tarifi */}
        {matchInfo.location && !isCompleted && !isCancelled ? (
          <TouchableOpacity activeOpacity={0.85} onPress={openDirections} style={styles.locationCard}>
            <Ionicons name="navigate-circle" size={36} color="#00E676" />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.locationName} numberOfLines={1}>{String(matchInfo.location)}</Text>
              <Text style={styles.locationSub}>Haritada aç / yol tarifi al</Text>
            </View>
            <Ionicons name="open-outline" size={18} color="#64748B" />
          </TouchableOpacity>
        ) : null}

        {pitchFee && !isCancelled ? (
          <View style={styles.feeCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.feeLabel}>💸 SAHA ÜCRETİ</Text>
              <Text style={styles.feeMain}>
                {formatMoney(pitchFee)}
                {share ? <Text style={styles.feeSub}>  ·  kişi başı {formatMoney(share)}</Text> : null}
              </Text>
              <Text style={styles.feeHint}>
                {!isCompleted ? 'Kadroya göre değişir; maç günü kesinleşir. ' : ''}
                {activePlayers.length > 0 ? `${paidCount}/${activePlayers.length} kişi ödedi.` : ''}
                {me?.status === 'ACTIVE' ? (me.paid ? ' Sen ödedin ✅' : ' Sen henüz ödemedin.') : ''}
              </Text>
            </View>
            {isManager && !isCancelled && (
              <TouchableOpacity onPress={() => { setFeeInput(String(pitchFee)); setFeeModal(true); }} style={{ padding: 6 }}>
                <Text style={styles.feeEdit}>Düzenle</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : isManager && !isCompleted && !isCancelled ? (
          <TouchableOpacity onPress={() => { setFeeInput(''); setFeeModal(true); }} style={styles.feeAdd}>
            <Ionicons name="cash-outline" size={18} color="#94A3B8" />
            <Text style={styles.feeAddText}>Saha ücreti ekle (kişi başı payı hesaplansın)</Text>
          </TouchableOpacity>
        ) : null}

        {isCompleted && (
          <View style={styles.mvpCard}>
            <Text style={styles.mvpLabel}>🏆 MAÇIN YILDIZI</Text>
            {matchMvp ? (
              <Text style={styles.mvpName}>{displayName(matchMvp)} <Text style={styles.mvpVotes}>· {String(matchMvp.voteCount)} oy</Text></Text>
            ) : (
              <Text style={styles.mvpEmpty}>Henüz kimse oy vermedi.</Text>
            )}
            {iPlayed ? (
              <>
                {myMvpVote ? (
                  <Text style={styles.mvpMine}>✓ Oyun: {displayName(myMvpVote)}</Text>
                ) : (
                  <TouchableOpacity style={styles.mvpBtn} onPress={() => setMvpModalVisible(true)} activeOpacity={0.85}>
                    <Text style={styles.mvpBtnText}>MVP'ye oy ver</Text>
                  </TouchableOpacity>
                )}
                <Text style={styles.mvpHint}>
                  {rateTotal > 0 && rateDone === rateTotal
                    ? `✓ ${rateTotal} oyuncunun hepsini puanladın. İstersen dokunup değiştirebilirsin.`
                    : `Takım arkadaşlarını puanlamak için aşağıda isimlerine dokun (${rateDone}/${rateTotal} puanladın).`}
                </Text>
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
          {isManager && !isCancelled && !isCompleted && activePlayers.length >= 2 && (
            <TouchableOpacity onPress={openTeams} style={styles.divideButton}>
              <Text style={styles.divideButtonText}>{teamsDivided ? 'Takımları düzenle' : 'Takım Böl 🎲'}</Text>
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

        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
          <TouchableOpacity style={[styles.guestBtn, styles.shareBtn]} onPress={handleShareRoster} activeOpacity={0.8} accessibilityLabel="Kadroyu paylaş">
            <Ionicons name="share-social-outline" size={18} color="#38BDF8" />
            <Text style={[styles.guestBtnText, { color: '#38BDF8' }]}>Kadroyu paylaş</Text>
          </TouchableOpacity>
          {!isCompleted && !isCancelled && (
            <TouchableOpacity style={styles.guestBtn} onPress={() => setGuestModal(true)} activeOpacity={0.8}>
              <Ionicons name="person-add-outline" size={18} color="#00E676" />
              <Text style={styles.guestBtnText} numberOfLines={1}>
                Misafir ekle{myGuests.length ? ` (${myGuests.length})` : ''}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {!teamsDivided && !isCancelled && activePlayers.length >= 2 ? (
          <View style={styles.teamsHint}>
            <Ionicons name="people-outline" size={16} color="#94A3B8" />
            <Text style={styles.teamsHintText}>
              {matchInfo.weekly && matchInfo.groupAutoTeams
                ? `Takımlar ${formatClock(ts - Math.max(lockHours, 2) * 3600 * 1000)}'de "Varım" diyenler arasından otomatik ve dengeli kurulacak.${isManager ? ' İstersen şimdi "Takım Böl" ile kendin de kurabilirsin.' : ''}`
                : isManager
                  ? 'Takımlar henüz belli değil. "Takım Böl"e bas; dengeli öneriyi istediğin gibi değiştirip kaydet.'
                  : 'Takımlar henüz belli değil. Yönetici böldüğünde burada iki takım olarak görünecek.'}
            </Text>
          </View>
        ) : null}

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
            <View style={styles.viewToggle}>
              {([['list', 'list-outline', 'Liste'], ['pitch', 'football-outline', 'Saha']] as const).map(([key, icon, label]) => (
                <TouchableOpacity key={key} onPress={() => chooseTeamView(key)} style={[styles.viewToggleBtn, teamView === key && styles.viewToggleOn]} accessibilityLabel={`Takımları ${label.toLowerCase()} olarak göster`}>
                  <Ionicons name={icon as any} size={16} color={teamView === key ? '#0F172A' : '#94A3B8'} />
                  <Text style={[styles.viewToggleText, teamView === key && { color: '#0F172A' }]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {teamView === 'pitch' ? (
              <PitchView
                teamA={teamA}
                teamB={teamB}
                nameA={String(matchInfo.teamAName || 'A Takımı')}
                nameB={String(matchInfo.teamBName || 'B Takımı')}
                formationA={matchInfo.teamAFormation}
                formationB={matchInfo.teamBFormation}
                editableA={editableA}
                editableB={editableB}
                captainIds={[capA, capB].filter(Boolean) as string[]}
                viewerHint={lineupViewerHint}
                onLineupChange={saveLineup}
                onDragActive={setScrollLocked}
                meId={user.id}
                onPressPlayer={iPlayed ? (p: any) => { if (p.id !== user.id) openRatingModal(p); } : undefined}
              />
            ) : (
            <>
            <LinearGradient colors={['rgba(33, 150, 243, 0.15)', 'rgba(33, 150, 243, 0.02)']} style={styles.teamContainer}>
              <Text style={[styles.teamHeader, { color: '#2196F3' }]}>🔵 {String(matchInfo.teamAName || 'A Takımı').toLocaleUpperCase('tr-TR')} ({teamA.length})</Text>
              {[...teamA].sort(bySlot(lineA)).map((player, idx) => renderPlayerCard(player, idx, String(matchInfo.teamAName || 'A Takımı'), styles.teamABadge, styles.teamAText))}
            </LinearGradient>

            <LinearGradient colors={['rgba(244, 67, 54, 0.15)', 'rgba(244, 67, 54, 0.02)']} style={styles.teamContainer}>
              <Text style={[styles.teamHeader, { color: '#F44336' }]}>🔴 {String(matchInfo.teamBName || 'B Takımı').toLocaleUpperCase('tr-TR')} ({teamB.length})</Text>
              {[...teamB].sort(bySlot(lineB)).map((player, idx) => renderPlayerCard(player, idx, String(matchInfo.teamBName || 'B Takımı'), styles.teamBBadge, styles.teamBText))}
            </LinearGradient>
            </>
            )}
            
            {unassigned.length > 0 ? (
              <View style={styles.teamContainer}>
                <Text style={[styles.teamHeader, { color: '#A0A0A0' }]}>Takımı belli olmayanlar ({unassigned.length})</Text>
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
            {myStatus === 'ACTIVE' ? `Kadrodasın ✅${myTeamLabel ? ` · ${myTeamLabel}` : ''}`
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
          <TouchableOpacity style={styles.finishBtn} onPress={() => { setFixingResult(false); setFinishModalVisible(true); }} activeOpacity={0.85}>
            <Ionicons name="flag" size={20} color="#0F172A" />
            <Text style={styles.finishBtnText}>Maçı bitir, skoru gir</Text>
          </TouchableOpacity>
        </View>
      )}
      


      {/* SAHA ÜCRETİ */}
      <Modal visible={feeModal} transparent animationType="fade" onRequestClose={() => setFeeModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Saha ücreti</Text>
            <Text style={{ color: '#94A3B8', textAlign: 'center', marginBottom: 16 }}>Toplam tutarı yaz; kişi başı pay sahada oynayan sayısına göre hesaplanır. Boş bırakırsan ücret kaldırılır.</Text>
            <TextInput
              style={styles.feeInput}
              value={feeInput}
              onChangeText={(t) => setFeeInput(t.replace(/[^0-9]/g, ''))}
              keyboardType="numeric"
              placeholder="Örn: 1400"
              placeholderTextColor="#64748B"
              autoFocus
            />
            {feeInput && activePlayers.length > 0 ? (
              <Text style={{ color: '#CBD5E1', textAlign: 'center', marginBottom: 12 }}>
                Şu anki kadroyla kişi başı {formatMoney(shareOf(parseInt(feeInput, 10), activePlayers.length))}
              </Text>
            ) : null}
            <TouchableOpacity style={styles.saveBtn} onPress={saveFee}>
              <LinearGradient colors={['#00C853', '#B2FF59']} start={{x: 0, y: 0}} end={{x: 1, y: 0}} style={styles.saveBtnGradient}>
                <Text style={styles.saveBtnText}>KAYDET</Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setFeeModal(false)}>
              <Text style={styles.cancelBtnText}>Vazgeç</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={editModal} transparent animationType="slide" onRequestClose={() => setEditModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>Maçı düzenle</Text>
              {matchInfo.groupId ? (
                <Text style={{ color: '#94A3B8', textAlign: 'center', marginBottom: 12, fontSize: 13 }}>
                  Sadece bu maç değişir. Her haftaki maçı değiştirmek için grubun "Haftalık maç" ayarını kullan. Saha ya da saat değişirse gruba bildirim gider.
                </Text>
              ) : null}

              <Text style={styles.editLabel}>Saha</Text>
              <TextInput
                style={[styles.feeInput, { textAlign: 'left', fontSize: 16, fontWeight: '600', width: '100%' }]}
                value={editLocation}
                onChangeText={setEditLocation}
                placeholder="Örn: Olimpik Halı Saha"
                placeholderTextColor="#64748B"
                maxLength={80}
              />

              <Text style={styles.editLabel}>Gün</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                {upcomingDays().map((d, i) => {
                  const on = editDay?.getTime() === d.getTime();
                  return (
                    <TouchableOpacity key={d.getTime()} onPress={() => setEditDay(d)} style={[styles.editChip, on && styles.editChipOn]}>
                      <Text style={[styles.editChipText, on && { color: '#0F172A' }]}>{dayLabel(d, i)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <Text style={styles.editLabel}>Saat</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                {editHours.map((h) => (
                  <TouchableOpacity key={h} onPress={() => setEditTime(h)} style={[styles.editChip, editTime === h && styles.editChipOn]}>
                    <Text style={[styles.editChipText, editTime === h && { color: '#0F172A' }]}>{h}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {parseInt(editTime, 10) < 6 && editDay ? (
                <Text style={{ color: '#94A3B8', fontSize: 12, marginBottom: 8 }}>{DAY_NAMES_SHORT[editDay.getDay()]} gecesi {editTime} (takvimde ertesi gün)</Text>
              ) : <View style={{ height: 8 }} />}

              <Text style={styles.editLabel}>Kişi sayısı</Text>
              <TextInput
                style={[styles.feeInput, { textAlign: 'left', fontSize: 16, width: '100%' }]}
                value={editMax}
                onChangeText={(t) => setEditMax(t.replace(/[^0-9]/g, ''))}
                keyboardType="numeric"
                maxLength={2}
              />

              <Text style={styles.editLabel}>Son değişiklik (maçtan kaç saat önce kilitlensin)</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 }}>
                {editLocks.map((h) => (
                  <TouchableOpacity key={h} onPress={() => setEditLock(h)} style={[styles.editChip, editLock === h && styles.editChipOn]}>
                    <Text style={[styles.editChipText, editLock === h && { color: '#0F172A' }]}>{h === 0 ? 'Kilitleme' : `${h} sa`}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity style={[styles.saveBtn, editBusy && { opacity: 0.6 }]} onPress={saveEdit} disabled={editBusy}>
                <LinearGradient colors={['#00C853', '#B2FF59']} start={{x: 0, y: 0}} end={{x: 1, y: 0}} style={styles.saveBtnGradient}>
                  <Text style={styles.saveBtnText}>{editBusy ? 'KAYDEDİLİYOR…' : 'KAYDET'}</Text>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditModal(false)}>
                <Text style={[styles.cancelBtnText, { color: '#CBD5E1' }]}>Vazgeç</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={guestModal} transparent animationType="fade" onRequestClose={() => setGuestModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Misafir ekle</Text>
            <Text style={{ color: '#94A3B8', textAlign: 'center', marginBottom: 16 }}>
              Yanında getirdiğin arkadaşlarının adını tek tek yaz. Uygulamayı yüklemelerine gerek yok; kadroda yer tutarlar ve saha ücretinden pay alırlar.
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TextInput
                style={[styles.feeInput, { flex: 1, width: undefined, minWidth: 0, marginBottom: 0, textAlign: 'left', fontSize: 16 }]}
                value={guestName}
                onChangeText={setGuestName}
                placeholder="Örn: Ali (Mehmet'in kuzeni)"
                placeholderTextColor="#64748B"
                maxLength={40}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={addGuest}
              />
              <TouchableOpacity onPress={addGuest} disabled={guestBusy} style={[styles.guestAddBtn, guestBusy && { opacity: 0.5 }]}>
                <Text style={styles.guestAddBtnText}>Ekle</Text>
              </TouchableOpacity>
            </View>
            {myGuests.length > 0 && (
              <View style={{ marginTop: 16 }}>
                <Text style={{ color: '#94A3B8', fontSize: 13, marginBottom: 6 }}>Senin misafirlerin ({myGuests.length})</Text>
                {myGuests.map((g: any) => (
                  <View key={g.id} style={styles.guestRow}>
                    <Text style={{ color: '#fff', flex: 1 }}>{String(g.name)}{g.status === 'RESERVE' ? '  · yedek' : ''}</Text>
                    <TouchableOpacity onPress={() => removeGuest(g)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle-outline" size={20} color="#94A3B8" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            <TouchableOpacity style={[styles.cancelBtn, { marginTop: 16 }]} onPress={() => setGuestModal(false)}>
              <Text style={[styles.cancelBtnText, { color: '#CBD5E1' }]}>Bitti</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* FINISH MODAL */}
      <Modal visible={finishModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{fixingResult ? 'Sonucu düzelt' : 'Maç Sonucu'}</Text>
            <Text style={{color: '#94A3B8', textAlign: 'center', marginBottom: 20}}>
              {fixingResult
                ? 'Skoru ve gol atanları düzelt. Bildirim tekrar gönderilmez.'
                : 'İki takımın skorunu gir ya da boş bırakarak devam et.'}
            </Text>
            
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
                        <Text style={{color: '#FFF', flex: 1}} numberOfLines={1}>{displayName(p)}{p.team === 'A' ? ` (${matchInfo.teamAName || 'A Takımı'})` : p.team === 'B' ? ` (${matchInfo.teamBName || 'B Takımı'})` : ''}</Text>
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
                 <Text style={[styles.saveBtnText, {color: '#FFF'}]}>{fixingResult ? 'DÜZELTMEYİ KAYDET' : 'MAÇI BİTİR VE KAYDET'}</Text>
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
            <Text style={styles.modalTitle}>{displayName(ratingTarget)} Skorla!</Text>
            
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
                           <Text style={{color: '#FFF', fontSize: 16, fontWeight: 'bold'}}>{displayName(p)}</Text>
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

      {/* TAKIMLAR: dengeli öneri, elle düzenleme, takım adları */}
      <Modal visible={suggestedTeamsModalVisible} transparent animationType="slide" onRequestClose={() => setSuggestedTeamsModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '92%' }]}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>Takımlar</Text>

              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
                <TextInput style={[styles.teamNameInput, { borderColor: 'rgba(33,150,243,0.6)' }]} value={nameA} onChangeText={setNameA} maxLength={20} placeholder="A Takımı" placeholderTextColor="#64748B" />
                <TextInput style={[styles.teamNameInput, { borderColor: 'rgba(244,67,54,0.6)' }]} value={nameB} onChangeText={setNameB} maxLength={20} placeholder="B Takımı" placeholderTextColor="#64748B" />
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                {[['Yelekliler', 'Yeleksizler'], ['Renkliler', 'Beyazlar'], ['A Takımı', 'B Takımı']].map(([a, b]) => (
                  <TouchableOpacity key={a} onPress={() => { setNameA(a); setNameB(b); }} style={styles.namePreset}>
                    <Text style={styles.namePresetText}>{a} / {b}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                {[{ list: editA, color: '#2196F3', name: nameA || 'A Takımı', cap: editCapA, setCap: setEditCapA }, { list: editB, color: '#F44336', name: nameB || 'B Takımı', cap: editCapB, setCap: setEditCapB }].map((col, ci) => (
                  <View key={ci} style={[styles.teamCol, { borderColor: col.color + '66' }]}>
                    <Text style={[styles.teamColTitle, { color: col.color }]} numberOfLines={1}>{col.name}</Text>
                    <Text style={styles.teamColMeta}>{col.list.length} kişi · güç {teamPower(col.list)}</Text>
                    {col.list.map((p) => (
                      <View key={p.id} style={[styles.teamChip, col.cap === p.id && { borderWidth: 1, borderColor: '#FACC15' }]}>
                        <TouchableOpacity onPress={() => movePlayer(p)} activeOpacity={0.7} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 }}>
                          <Text style={styles.teamChipName} numberOfLines={1}>{displayName(p)}</Text>
                          <Text style={styles.teamChipMeta}>
                            {String(p.position || '').toLowerCase().includes('kaleci') ? '🧤 ' : ''}{p.overall ?? ''}
                          </Text>
                        </TouchableOpacity>
                        {!p.isGuest ? (
                          <TouchableOpacity
                            onPress={() => col.setCap(col.cap === p.id ? null : p.id)}
                            style={[styles.capToggle, col.cap === p.id && styles.capToggleOn]}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            accessibilityLabel={`${displayName(p)} kaptan`}
                          >
                            <Text style={[styles.capToggleText, col.cap === p.id && { color: '#0F172A' }]}>K</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ))}
              </View>

              {editNone.length > 0 && (
                <View style={{ marginTop: 12 }}>
                  <Text style={styles.teamColMeta}>Takımsız ({editNone.length}) · dokun, bir takıma girsin</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {editNone.map((p) => (
                      <TouchableOpacity key={p.id} onPress={() => movePlayer(p)} style={[styles.teamChip, { paddingHorizontal: 10 }]}>
                        <Text style={styles.teamChipName}>{displayName(p)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              <Text style={{ color: '#64748B', fontSize: 12, textAlign: 'center', marginTop: 10 }}>
                Oyuncuya dokun, diğer takıma geçsin. K: takım kaptanı (dizilişi o ayarlar). Güç: oyuncuların aldığı puanların ortalaması.
              </Text>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <TouchableOpacity style={styles.teamToolBtn} onPress={applySuggestion}>
                  <Text style={styles.teamToolText}>⚖️ Dengeli öner</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.teamToolBtn} onPress={shuffleTeams}>
                  <Text style={styles.teamToolText}>🎲 Karıştır</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={[styles.saveBtn, { marginTop: 14 }]} onPress={saveTeamsEdit} disabled={saveTeamsLoading}>
                <LinearGradient colors={['#00C853', '#B2FF59']} start={{x: 0, y: 0}} end={{x: 1, y: 0}} style={styles.saveBtnGradient}>
                  <Text style={styles.saveBtnText}>{saveTeamsLoading ? 'KAYDEDİLİYOR...' : 'TAKIMLARI KAYDET'}</Text>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setSuggestedTeamsModalVisible(false)}>
                <Text style={[styles.cancelBtnText, { color: '#94A3B8' }]}>Vazgeç</Text>
              </TouchableOpacity>
            </ScrollView>
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
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: 'rgba(0, 230, 118, 0.1)', marginLeft: 10 },
  editBtnText: { color: '#00E676', fontWeight: '600', fontSize: 13 },
  editLabel: { color: '#94A3B8', fontSize: 13, marginBottom: 6, marginTop: 4 },
  editChip: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginRight: 8, marginBottom: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  editChipOn: { backgroundColor: '#00E676', borderColor: '#00E676' },
  editChipText: { color: '#E2E8F0', fontWeight: '600', fontSize: 14 },
  guestLine: { color: '#38BDF8', fontSize: 12, marginTop: 2 },
  guestBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(0, 230, 118, 0.45)', borderRadius: 12, paddingVertical: 11 },
  shareBtn: { borderStyle: 'solid', borderColor: 'rgba(56, 189, 248, 0.45)', backgroundColor: 'rgba(56, 189, 248, 0.08)' },
  guestBtnText: { color: '#00E676', fontWeight: '600', fontSize: 14 },
  guestAddBtn: { backgroundColor: '#00E676', borderRadius: 12, paddingHorizontal: 16, flexShrink: 0, paddingVertical: 14, marginLeft: 8 },
  guestAddBtnText: { color: '#0F172A', fontWeight: '700', fontSize: 15 },
  guestRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  sectionTitle: { fontSize: 18, fontWeight: "bold", color: "#FFFFFF" },
  divideButton: { backgroundColor: 'rgba(255, 193, 7, 0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255, 193, 7, 0.5)' },
  divideButtonText: { color: '#FFC107', fontWeight: 'bold', fontSize: 13 },
  teamsSplitContainer: { marginTop: 0 },
  viewToggle: { flexDirection: 'row', alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 4, marginBottom: 14 },
  viewToggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 9 },
  viewToggleOn: { backgroundColor: '#00E676' },
  viewToggleText: { color: '#94A3B8', fontWeight: '600', fontSize: 14 },
  teamsHint: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(148,163,184,0.08)', borderRadius: 12, padding: 12, marginBottom: 12 },
  teamsHintText: { color: '#94A3B8', fontSize: 13, flex: 1, lineHeight: 18 },
  teamNameInput: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', color: '#FFFFFF', borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, fontWeight: '600', minWidth: 0 },
  namePreset: { borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 12, paddingVertical: 6, marginRight: 8 },
  namePresetText: { color: '#CBD5E1', fontSize: 13 },
  teamCol: { flex: 1, borderWidth: 1, borderRadius: 14, padding: 10, backgroundColor: 'rgba(255,255,255,0.02)', minWidth: 0 },
  teamColTitle: { fontWeight: 'bold', fontSize: 15, textAlign: 'center' },
  teamColMeta: { color: '#94A3B8', fontSize: 12, textAlign: 'center', marginBottom: 8, marginTop: 2 },
  teamChip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9, marginBottom: 6 },
  teamChipName: { color: '#FFFFFF', fontSize: 14, fontWeight: '600', flexShrink: 1 },
  teamChipMeta: { color: '#94A3B8', fontSize: 12, marginLeft: 6 },
  capToggle: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(250,204,21,0.6)', alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  capToggleOn: { backgroundColor: '#FACC15', borderColor: '#FACC15' },
  capToggleText: { color: '#FACC15', fontSize: 11, fontWeight: '900' },
  teamToolBtn: { flex: 1, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', paddingVertical: 12, alignItems: 'center' },
  teamToolText: { color: '#E2E8F0', fontWeight: '600', fontSize: 14 },
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
  feeCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(244, 63, 94, 0.07)', borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: 'rgba(244, 63, 94, 0.3)' },
  feeLabel: { color: '#FB7185', fontSize: 12, fontWeight: 'bold', letterSpacing: 1 },
  feeMain: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', marginTop: 4 },
  feeSub: { color: '#CBD5E1', fontSize: 15, fontWeight: '600' },
  feeHint: { color: '#94A3B8', fontSize: 12, marginTop: 6, lineHeight: 17 },
  feeEdit: { color: '#00E676', fontWeight: 'bold' },
  feeAdd: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(148, 163, 184, 0.4)', marginBottom: 20 },
  feeAddText: { color: '#94A3B8', fontSize: 14 },
  feeInput: { backgroundColor: 'rgba(0,0,0,0.25)', color: '#FFFFFF', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, fontSize: 22, fontWeight: 'bold', textAlign: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', marginBottom: 12 },
  paidChip: { alignSelf: 'flex-start', marginTop: 5, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(148, 163, 184, 0.5)' },
  paidChipOn: { backgroundColor: '#00E676', borderColor: '#00E676' },
  paidChipText: { color: '#CBD5E1', fontSize: 12, fontWeight: 'bold' },
  mvpCard: { backgroundColor: 'rgba(255, 215, 0, 0.08)', borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: 'rgba(255, 215, 0, 0.3)', alignItems: 'center' },
  mvpLabel: { color: '#FFD700', fontSize: 12, fontWeight: 'bold', letterSpacing: 1 },
  mvpName: { color: '#FFFFFF', fontSize: 20, fontWeight: '900', marginTop: 6 },
  mvpVotes: { color: '#FFD700', fontSize: 14, fontWeight: '600' },
  mvpEmpty: { color: '#94A3B8', fontSize: 14, marginTop: 6 },
  mvpBtn: { backgroundColor: '#FFD700', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24, marginTop: 12 },
  mvpMine: { color: '#FFD700', fontWeight: '600', fontSize: 14, marginTop: 12 },
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
});
