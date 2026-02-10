import React, { useEffect, useState } from "react";
import { Stack, Redirect, usePathname } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppState, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { supabase } from "@/constants/supabaseClient";

const ACCEPTED_SEASON_KEY = "PPL_ACCEPTED_SEASON_ID_V3";


async function getAcceptedSeasonId(): Promise<string> {
  try {
    if (Platform.OS === "web") {
      return window?.localStorage?.getItem(ACCEPTED_SEASON_KEY) ?? "";
    }
    return (await SecureStore.getItemAsync(ACCEPTED_SEASON_KEY)) ?? "";
  } catch {
    return "";
  }
}

async function clearAcceptedSeasonId(): Promise<void> {
  try {
    if (Platform.OS === "web") {
      window?.localStorage?.removeItem(ACCEPTED_SEASON_KEY);
      return;
    }
    await SecureStore.deleteItemAsync(ACCEPTED_SEASON_KEY);
  } catch {
    // ignore
  }
}

export default function RootLayout() {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(true);

  useEffect(() => {
    let appState = AppState.currentState;

    const check = async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("current_season_id")
        .single();

      const currentSeasonId = (data as any)?.current_season_id ?? "";
      const acceptedSeasonId = await getAcceptedSeasonId();

      // ✅ lock if no accepted season, or season changed
      const shouldLock = !acceptedSeasonId || acceptedSeasonId !== currentSeasonId;

      if (shouldLock) {
        await clearAcceptedSeasonId();
        setLocked(true);
      } else {
        setLocked(false);
      }

      setReady(true);
    };

    void check();

    const sub = AppState.addEventListener("change", (nextState) => {
      if (appState.match(/inactive|background/) && nextState === "active") {
        void check();
      }
      appState = nextState;
    });

    return () => sub.remove();
  }, []);

  // Wait until we know locked/unlocked
  if (!ready) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]} />
      </SafeAreaProvider>
    );
  }

  const isOnLeagueLock = pathname === "/league-lock";


  // ✅ HARD GATE: if locked, force league-lock no matter where they are
  if (locked && !isOnLeagueLock) {
    return <Redirect href="/league-lock" />;
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="league-lock" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
