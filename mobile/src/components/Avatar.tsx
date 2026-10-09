import React from 'react';
import { Image, Text, View, StyleSheet } from 'react-native';
import { displayName } from '../utils/format';

// Profil fotoğrafı (data URL), emoji avatar ("emoji:⚽") ya da adın baş harfi.
export const AVATAR_EMOJIS = ['⚽', '🧤', '🥅', '🏆', '🔥', '⚡', '🦁', '🐺', '🦅', '🐐', '🦈', '🐂', '🚀', '👑', '🎯', '💪', '😎', '🤠', '👽', '🤖'];

export const isEmojiAvatar = (a?: string | null) => typeof a === 'string' && a.startsWith('emoji:');

type Props = {
  user?: { name?: string | null; nickname?: string | null; avatar?: string | null; isGuest?: boolean } | null;
  avatar?: string | null; // user yerine doğrudan verilebilir
  size: number;
  initialColor?: string;
  initialStyle?: any;
};

export default function Avatar({ user, avatar, size, initialColor = '#00E676', initialStyle }: Props) {
  const a = avatar !== undefined ? avatar : user?.avatar;
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (isEmojiAvatar(a)) {
    return (
      <View style={[styles.center, box, { backgroundColor: 'rgba(255,255,255,0.06)' }]}>
        <Text style={{ fontSize: Math.round(size * 0.55), lineHeight: Math.round(size * 0.75) }}>{String(a).slice(6)}</Text>
      </View>
    );
  }
  if (a) return <Image source={{ uri: a }} style={box} />;
  const initial = (displayName(user) || '?').charAt(0).toLocaleUpperCase('tr-TR');
  return (
    <View style={[styles.center, box]}>
      <Text style={[{ color: initialColor, fontWeight: 'bold', fontSize: Math.round(size * 0.42) }, initialStyle]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({ center: { alignItems: 'center', justifyContent: 'center' } });
