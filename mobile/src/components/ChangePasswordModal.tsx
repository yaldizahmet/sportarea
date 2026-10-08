import React, { useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { apiFetch } from '../utils/api';
import { API_URL } from '../config/api';

// Şifre değiştirme penceresi.
// forced: geçici şifreyle giriş yapıldıysa mevcut şifre sorulmaz ve pencere kapatılamaz.
export default function ChangePasswordModal({ visible, forced, onDone, onCancel }: {
  visible: boolean;
  forced?: boolean;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => { setCurrent(''); setNext(''); setAgain(''); };

  const save = async () => {
    if (next.length < 6) return Alert.alert('Kısa şifre', 'Yeni şifre en az 6 karakter olmalı.');
    if (next !== again) return Alert.alert('Eşleşmiyor', 'Yeni şifreyi iki kez aynı yazmalısın.');
    if (!forced && !current) return Alert.alert('Eksik', 'Mevcut şifreni yaz.');
    setSaving(true);
    try {
      const res = await apiFetch(`${API_URL}/me/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(forced ? { newPassword: next } : { currentPassword: current, newPassword: next }),
      });
      const data = await res.json();
      if (res.ok) {
        reset();
        Alert.alert('Tamam', data.message || 'Şifren güncellendi.');
        onDone();
      } else {
        Alert.alert('Olmadı', data.error || 'Şifre güncellenemedi.');
      }
    } catch (e) {
      Alert.alert('Hata', 'Bağlantı sorunu yaşandı.');
    }
    setSaving(false);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { if (!forced) { reset(); onCancel?.(); } }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{forced ? 'Yeni şifreni belirle' : 'Şifre değiştir'}</Text>
          {forced && (
            <Text style={styles.subtitle}>Geçici şifreyle giriş yaptın. Devam etmek için kendine yeni bir şifre belirle.</Text>
          )}
          {!forced && (
            <TextInput style={styles.input} placeholder="Mevcut şifre" placeholderTextColor="#64748B" secureTextEntry value={current} onChangeText={setCurrent} />
          )}
          <TextInput style={styles.input} placeholder="Yeni şifre (en az 6 karakter)" placeholderTextColor="#64748B" secureTextEntry value={next} onChangeText={setNext} />
          <TextInput style={styles.input} placeholder="Yeni şifre (tekrar)" placeholderTextColor="#64748B" secureTextEntry value={again} onChangeText={setAgain} />
          <TouchableOpacity style={styles.primary} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color="#0F172A" /> : <Text style={styles.primaryText}>Kaydet</Text>}
          </TouchableOpacity>
          {!forced && (
            <TouchableOpacity style={styles.secondary} onPress={() => { reset(); onCancel?.(); }}>
              <Text style={styles.secondaryText}>Vazgeç</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1E293B', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 36 },
  title: { color: '#FFFFFF', fontSize: 22, fontWeight: 'bold', marginBottom: 8 },
  subtitle: { color: '#CBD5E1', fontSize: 14, lineHeight: 20, marginBottom: 16 },
  input: { backgroundColor: 'rgba(0,0,0,0.25)', color: '#FFFFFF', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginTop: 10 },
  primary: { backgroundColor: '#00E676', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 18 },
  primaryText: { color: '#0F172A', fontWeight: 'bold', fontSize: 16 },
  secondary: { alignItems: 'center', paddingVertical: 14 },
  secondaryText: { color: '#94A3B8', fontWeight: '600', fontSize: 15 },
});
