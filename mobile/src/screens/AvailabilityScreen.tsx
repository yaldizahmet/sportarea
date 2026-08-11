import { apiFetch } from '../utils/api';
import React, { useState, useEffect, useCallback } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { API_URL } from "../config/api";

const DAYS: { label: string; value: number }[] = [
  { label: "Pazar", value: 0 },
  { label: "Pazartesi", value: 1 },
  { label: "Salı", value: 2 },
  { label: "Çarşamba", value: 3 },
  { label: "Perşembe", value: 4 },
  { label: "Cuma", value: 5 },
  { label: "Cumartesi", value: 6 },
];

type AvailabilityRow = {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: number;
  createdAt?: string;
};

export default function AvailabilityScreen({ route, navigation }: any) {
  const user = route.params?.user || {};
  const userId = user.id;

  const [rows, setRows] = useState<AvailabilityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [startTime, setStartTime] = useState("19:00");
  const [endTime, setEndTime] = useState("22:00");

  const fetchList = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await apiFetch(`${API_URL}/users/${userId}/availability`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setRows(data);
      }
    } catch (e) {
      console.log("availability fetch", e);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const addSlot = async () => {
    if (!userId) {
      Alert.alert("Eksik bilgi", "Kullanıcı kimliği (user.id) yok.");
      return;
    }
    try {
      const res = await apiFetch(`${API_URL}/users/${userId}/availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dayOfWeek, startTime, endTime }),
      });
      const data = await res.json();
      if (res.ok) {
        setStartTime("19:00");
        setEndTime("22:00");
        fetchList();
        Alert.alert("Kaydedildi", data.message || "Müsaitlik eklendi.");
      } else {
        Alert.alert("Hata", data.error || "Eklenemedi.");
      }
    } catch (e) {
      Alert.alert("Bağlantı", "Sunucuya ulaşılamadı.");
    }
  };

  const removeRow = (id: string) => {
    if (!userId) return;
    const go = async () => {
      try {
        const res = await apiFetch(`${API_URL}/users/${userId}/availability/${id}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (res.ok) {
          fetchList();
        } else {
          Alert.alert("Hata", data.error || "Silinemedi.");
        }
      } catch (e) {
        Alert.alert("Hata", "Sunucu hatası.");
      }
    };
    Alert.alert("Silinsin mi?", "Bu saat aralığını kaldırmak istiyor musun?", [
      { text: "İptal", style: "cancel" },
      { text: "Sil", style: "destructive", onPress: go },
    ]);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Müsaitlik</Text>
        <TouchableOpacity onPress={fetchList} style={styles.backButton}>
          <Ionicons name="refresh" size={22} color="#00E676" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
        <LinearGradient colors={["#1E293B", "#0F172A"]} style={styles.card}>
          <View style={styles.userRow}>
            <View style={styles.avatar}>
              {user.avatar ? (
                <Image source={{ uri: user.avatar }} style={styles.avatarImg} />
              ) : (
                <Text style={styles.avatarLetter}>{String(user.name?.charAt(0) || "?")}</Text>
              )}
            </View>
            <View>
              <Text style={styles.userName}>{String(user.name || "Oyuncu")}</Text>
              <Text style={styles.userHint}>Haftalık saat aralıkların maç önerilerinde kullanılır.</Text>
            </View>
          </View>
        </LinearGradient>

        <Text style={styles.sectionTitle}>Yeni aralık ekle</Text>
        <View style={styles.pickerRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {DAYS.map((d) => (
              <TouchableOpacity
                key={d.value}
                onPress={() => setDayOfWeek(d.value)}
                style={[styles.chip, dayOfWeek === d.value && styles.chipActive]}
              >
                <Text style={[styles.chipText, dayOfWeek === d.value && styles.chipTextActive]}>
                  {d.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.timeRow}>
          <View style={styles.timeField}>
            <Text style={styles.label}>Başlangıç</Text>
            <TextInput
              style={styles.input}
              value={startTime}
              onChangeText={setStartTime}
              placeholder="19:00"
              placeholderTextColor="#64748B"
            />
          </View>
          <View style={styles.timeField}>
            <Text style={styles.label}>Bitiş</Text>
            <TextInput
              style={styles.input}
              value={endTime}
              onChangeText={setEndTime}
              placeholder="22:00"
              placeholderTextColor="#64748B"
            />
          </View>
        </View>
        <Text style={styles.formatHint}>Saatler HH:mm (örn. 19:00) olmalı.</Text>

        <TouchableOpacity onPress={addSlot} style={styles.addBtn}>
          <LinearGradient
            colors={["#00E676", "#00C853"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.addBtnIn}
          >
            <Ionicons name="add-circle-outline" size={22} color="#0F172A" style={{ marginRight: 8 }} />
            <Text style={styles.addBtnText}>Aralığı kaydet</Text>
          </LinearGradient>
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Kayıtlı aralıklar {loading ? "…" : `(${rows.length})`}</Text>
        {rows.length === 0 && !loading ? (
          <Text style={styles.empty}>Henüz müsaitlik eklemedin. Örneğin Salı 19:00–22:00.</Text>
        ) : null}
        {rows.map((r) => {
          const dayLabel = DAYS.find((d) => d.value === r.dayOfWeek)?.label || String(r.dayOfWeek);
          return (
            <View key={r.id} style={styles.rowItem}>
              <View style={styles.rowLeft}>
                <Ionicons name="time-outline" size={22} color="#00E676" style={{ marginRight: 10 }} />
                <View>
                  <Text style={styles.rowDay}>{dayLabel}</Text>
                  <Text style={styles.rowTime}>
                    {r.startTime} – {r.endTime}
                  </Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => removeRow(r.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="trash-outline" size={22} color="#EF4444" />
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#0F172A" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backButton: { padding: 5 },
  headerTitle: { fontSize: 20, fontWeight: "bold", color: "#FFFFFF" },
  container: { flex: 1, paddingHorizontal: 20 },
  card: {
    borderRadius: 20,
    padding: 18,
    marginTop: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(0, 230, 118, 0.2)",
  },
  userRow: { flexDirection: "row", alignItems: "center" },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#334155",
    marginRight: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarImg: { width: 48, height: 48, borderRadius: 24 },
  avatarLetter: { color: "#FFF", fontSize: 20, fontWeight: "800" },
  userName: { color: "#FFF", fontSize: 18, fontWeight: "700" },
  userHint: { color: "#94A3B8", fontSize: 13, marginTop: 4, maxWidth: 260 },
  sectionTitle: { color: "#FFF", fontSize: 16, fontWeight: "700", marginBottom: 12, marginTop: 8 },
  pickerRow: { marginBottom: 16 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.06)",
    marginRight: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  chipActive: { backgroundColor: "rgba(0, 230, 118, 0.2)", borderColor: "rgba(0, 230, 118, 0.5)" },
  chipText: { color: "#94A3B8", fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: "#00E676" },
  timeRow: { flexDirection: "row", gap: 12, marginBottom: 6 },
  timeField: { flex: 1 },
  label: { color: "#94A3B8", fontSize: 12, marginBottom: 6 },
  input: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 46,
    color: "#FFF",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  formatHint: { color: "#64748B", fontSize: 12, marginBottom: 16 },
  addBtn: { borderRadius: 14, overflow: "hidden", marginBottom: 28 },
  addBtnIn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
  },
  addBtnText: { color: "#0F172A", fontSize: 16, fontWeight: "800" },
  empty: { color: "#64748B", fontSize: 14, lineHeight: 20 },
  rowItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  rowLeft: { flexDirection: "row", alignItems: "center" },
  rowDay: { color: "#E2E8F0", fontSize: 15, fontWeight: "700" },
  rowTime: { color: "#94A3B8", fontSize: 13, marginTop: 2 },
});
