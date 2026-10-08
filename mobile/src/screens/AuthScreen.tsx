import { apiFetch } from '../utils/api';
import React, { useState, useRef, useEffect } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TextInput, 
  TouchableOpacity, 
  Animated, 
  KeyboardAvoidingView, 
  Platform,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../config/api';
import { captureInviteFromUrl, getPendingInvite, previewInvite } from '../utils/invite';

export default function AuthScreen({ navigation }: any) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  // Kayıtlı oturum kontrolü sürerken giriş formu yerine açılış ekranı gösterilir.
  // Render'ın ücretsiz sunucusu uykudaysa ilk istek 30-60 sn sürebilir.
  const [checking, setChecking] = useState(true);
  const [slowServer, setSlowServer] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [invite, setInvite] = useState<{ name: string; memberCount: number } | null>(null);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;
  const spinValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (loading) {
      Animated.loop(
        Animated.timing(spinValue, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        })
      ).start();
    } else {
      spinValue.setValue(0);
    }
  }, [loading]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg']
  });

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        friction: 5,
        tension: 40,
        useNativeDriver: true,
      })
    ]).start();
  }, [isLogin]);

  const checkToken = async () => {
    setCheckFailed(false);
    setChecking(true);
    const slowTimer = setTimeout(() => setSlowServer(true), 3500);
    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) return;
      const res = await apiFetch(`${API_URL}/me`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.user) {
        navigation.replace('Dashboard', { user: data.user });
        return;
      }
      // Oturum geçersiz (süresi dolmuş vb.): girişe dön
      await AsyncStorage.removeItem('userToken');
    } catch (e) {
      // Ağ hatası: oturumu silme, tekrar denemeyi teklif et
      setCheckFailed(true);
      return;
    } finally {
      clearTimeout(slowTimer);
      setSlowServer(false);
      setChecking(false);
    }
  };

  useEffect(() => {
    (async () => {
      // Davet linkiyle gelindiyse grubu göster; yeni gelen büyük ihtimalle kayıt olacak.
      await captureInviteFromUrl();
      const code = await getPendingInvite();
      if (code) {
        const p = await previewInvite(code);
        if (p) {
          setInvite(p);
          if (!(await AsyncStorage.getItem('userToken'))) setIsLogin(false);
        }
      }
    })();
    checkToken();
  }, []);

  const handleAuth = async () => {
    const problem = !email.trim() || !password
      ? 'E-posta ve şifre gerekli.'
      : !isLogin && !fullName.trim()
        ? 'Adını yaz, gruptakiler seni tanısın.'
        : !isLogin && password.length < 6
          ? 'Şifre en az 6 karakter olmalı.'
          : null;
    if (problem) {
      Alert.alert('Eksik bilgi', problem);
      return;
    }
    try {
      setLoading(true);
      const endpoint = isLogin ? `${API_URL}/login` : `${API_URL}/register`;
      
      const payload = isLogin 
        ? { email: email.trim(), password }
        : { name: fullName.trim(), email: email.trim(), password };

      const response = await apiFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      
      if (!response.ok) {
        Alert.alert("Hata", data.error);
        return;
      }
      
      if (data.token) {
        await AsyncStorage.setItem('userToken', data.token);
      }
      
      // Navigate to Dashboard
      navigation.replace('Dashboard', { user: data.user });
      
    } catch (error) {
      console.error('Auth Request Error:', error);
      Alert.alert(
        "Bağlantı Hatası", 
        "Sunucuya ulaşılamadı. Lütfen internet bağlantınızı ve sunucunun çalıştığını kontrol edin."
      );
    } finally {
      setLoading(false);
    }
  };

  if (checking || checkFailed) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 30 }]}>
        <StatusBar style="light" />
        <LinearGradient colors={['#0F2027', '#203A43', '#2C5364']} style={StyleSheet.absoluteFillObject} />
        <Ionicons name="football" size={64} color="#00E676" />
        <Text style={[styles.title, { marginTop: 16 }]}>SporArea</Text>
        {checkFailed ? (
          <>
            <Text style={styles.splashText}>Sunucuya ulaşılamadı. İnternet bağlantını kontrol edip tekrar dene.</Text>
            <TouchableOpacity style={styles.retryButton} onPress={checkToken}>
              <Text style={styles.retryButtonText}>Tekrar dene</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <ActivityIndicator color="#00E676" style={{ marginTop: 24 }} />
            <Text style={styles.splashText}>
              {slowServer ? 'Sunucu uyanıyor, ilk açılış yarım dakika kadar sürebilir…' : 'Giriş yapılıyor…'}
            </Text>
          </>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      
      {/* Background Gradient */}
      <LinearGradient
        colors={['#0F2027', '#203A43', '#2C5364']}
        style={StyleSheet.absoluteFillObject}
      />

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        enabled={Platform.OS === 'ios'}
        style={{ flex: 1 }}
      >
        <ScrollView 
          contentContainerStyle={styles.contentContainer} 
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View 
            style={[
              styles.headerContainer, 
              { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }
            ]}
          >
            <Animated.View style={[styles.iconContainer, { transform: [{ rotate: spin }] }]}>
              <Ionicons name="football" size={54} color="#00E676" />
            </Animated.View>
            <Text style={styles.title}>SporArea</Text>
            <Text style={styles.subtitle}>Sahanın Hakimi Ol</Text>
          </Animated.View>

          {invite && (
            <View style={styles.inviteBanner}>
              <Ionicons name="people" size={22} color="#00E676" />
              <Text style={styles.inviteBannerText}>
                <Text style={{ fontWeight: 'bold', color: '#FFFFFF' }}>{invite.name}</Text> grubuna davet edildin
                {invite.memberCount ? ` (${invite.memberCount} kişi)` : ''}. {isLogin ? 'Giriş yap' : 'Kayıt ol'}, gruba otomatik katılacaksın.
              </Text>
            </View>
          )}

          <Animated.View 
            style={[
              styles.formContainer,
              { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }
            ]}
          >
            {!isLogin && (
               <View style={[styles.inputContainer, focusedInput === 'name' && styles.inputFocused]}>
               <Ionicons name="person-outline" size={20} color={focusedInput === 'name' ? '#00E676' : '#A0A0A0'} style={styles.inputIcon} />
               <TextInput
                 style={styles.input}
                 placeholder="Ad Soyad"
                 placeholderTextColor="#A0A0A0"
                 value={fullName}
                 onChangeText={setFullName}
                 onFocus={() => setFocusedInput('name')}
                 onBlur={() => setFocusedInput(null)}
               />
             </View>
            )}
            <View style={[styles.inputContainer, focusedInput === 'email' && styles.inputFocused]}>
              <Ionicons name="mail-outline" size={20} color={focusedInput === 'email' ? '#00E676' : '#A0A0A0'} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="E-posta"
                placeholderTextColor="#A0A0A0"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                onFocus={() => setFocusedInput('email')}
                onBlur={() => setFocusedInput(null)}
              />
            </View>

            <View style={[styles.inputContainer, focusedInput === 'password' && styles.inputFocused]}>
              <Ionicons name="lock-closed-outline" size={20} color={focusedInput === 'password' ? '#00E676' : '#A0A0A0'} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder={isLogin ? "Şifre" : "Şifre (en az 6 karakter)"}
                placeholderTextColor="#A0A0A0"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                onFocus={() => setFocusedInput('password')}
                onBlur={() => setFocusedInput(null)}
              />
            </View>


            <View style={{ height: 16 }} />

            <Animated.View style={{ transform: [{ scale: buttonScale }] }}>
              <TouchableOpacity 
                activeOpacity={0.8} 
                onPress={handleAuth} 
                disabled={loading}
                onPressIn={() => Animated.spring(buttonScale, { toValue: 0.95, useNativeDriver: true }).start()}
                onPressOut={() => Animated.spring(buttonScale, { toValue: 1, useNativeDriver: true }).start()}
              >
                <LinearGradient
                  colors={['#00C853', '#B2FF59']}
                  start={{x: 0, y: 0}}
                  end={{x: 1, y: 0}}
                  style={[styles.button, loading && { opacity: 0.7 }]}
                >
                  <Text style={styles.buttonText}>{loading ? 'YÜKLENİYOR...' : (isLogin ? 'GİRİŞ YAP' : 'KAYIT OL')}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>

            <View style={styles.switchContainer}>
              <Text style={styles.switchLabel}>
                {isLogin ? "Hesabın yok mu? " : "Zaten üye misin? "}
              </Text>
              <TouchableOpacity onPress={() => {
                  fadeAnim.setValue(0);
                  slideAnim.setValue(20);
                  setIsLogin(!isLogin);
                  setFullName('');
                }}>
                <Text style={styles.switchButton}>{isLogin ? "Yeni Kayıt" : "Giriş Yap"}</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  splashText: { color: '#CBD5E1', fontSize: 15, textAlign: 'center', marginTop: 16, lineHeight: 22, maxWidth: 320 },
  retryButton: { backgroundColor: '#00E676', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, marginTop: 24 },
  retryButtonText: { color: '#0F172A', fontWeight: 'bold', fontSize: 16 },
  inviteBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(0, 230, 118, 0.12)', borderWidth: 1, borderColor: 'rgba(0, 230, 118, 0.4)', borderRadius: 16, padding: 14, marginBottom: 20 },
  inviteBannerText: { flex: 1, color: '#CBD5E1', fontSize: 14, lineHeight: 20 },
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  contentContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: 50,
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0, 230, 118, 0.3)',
    marginBottom: 20,
    shadowColor: '#00E676',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  title: {
    fontSize: 42,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 16,
    color: '#BDBDBD',
    marginTop: 5,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  formContainer: {
    width: '100%',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 16,
    height: 60,
    marginBottom: 15,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  inputFocused: {
    borderColor: '#00E676',
    backgroundColor: 'rgba(0, 230, 118, 0.05)',
  },
  inputIcon: {
    marginRight: 15,
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
    height: '100%',
  },
  button: {
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#00E676',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 15,
    elevation: 8,
  },
  buttonText: {
    color: '#000000',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  switchContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 30,
  },
  switchLabel: {
    color: '#A0A0A0',
    fontSize: 15,
  },
  switchButton: {
    color: '#00E676',
    fontSize: 15,
    fontWeight: 'bold',
  },
});
