import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { RootStackParamList } from "./src/navigation/types";
import AuthScreen from "./src/screens/AuthScreen";
import DashboardScreen from "./src/screens/DashboardScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import LeaderboardScreen from "./src/screens/LeaderboardScreen";
import MatchDetailsScreen from "./src/screens/MatchDetailsScreen";
import GroupDetailsScreen from "./src/screens/GroupDetailsScreen";

import { Platform, Alert, AlertButton } from "react-native";

if (Platform.OS === "web") {
  // React Native Web'de Alert.alert hiçbir şey göstermiyor (örn. "şifre hatalı" mesajı kayboluyordu).
  // Tarayıcının kendi pencerelerine yönlendiriyoruz: tek düğme -> alert, birden fazla -> confirm.
  (Alert as any).alert = (title: string, message?: string, buttons?: AlertButton[]) => {
    const text = [title, message].filter(Boolean).join("\n\n");
    if (!buttons || buttons.length <= 1) {
      window.alert(text);
      buttons?.[0]?.onPress?.();
      return;
    }
    const cancel = buttons.find((b) => b.style === "cancel");
    const action = buttons.find((b) => b.style !== "cancel") ?? buttons[buttons.length - 1];
    if (window.confirm(text)) action?.onPress?.();
    else cancel?.onPress?.();
  };

  const style = document.createElement("style");
  style.textContent = `
    html, body, #root {
      height: 100vh !important;
      overflow: hidden !important;
    }
  `;
  document.head.appendChild(style);
}

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Auth"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#0F172A" },
        }}
      >
        <Stack.Screen name="Auth" component={AuthScreen} />
        <Stack.Screen name="Dashboard" component={DashboardScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="Leaderboard" component={LeaderboardScreen} />
        <Stack.Screen name="MatchDetails" component={MatchDetailsScreen} />
        <Stack.Screen name="GroupDetails" component={GroupDetailsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
