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
import AvailabilityScreen from "./src/screens/AvailabilityScreen";

import { Platform } from "react-native";

if (Platform.OS === "web") {
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
        <Stack.Screen name="Availability" component={AvailabilityScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
