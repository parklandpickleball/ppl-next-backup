import React, { useEffect, useRef, useState } from "react";
import { Stack, Redirect, usePathname } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppState, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { supabase } from "@/constants/supabaseClient";

const ACCEPTED_SEASON_KEY = "PPL_ACCEPTED_SEASON_ID_V3";
const LOCAL_TEAM_KEY = "PPL_LOCAL_TEAM_ID_V1";
const LOCAL_PLAYER_KEY = "PPL_LOCAL_PLAYER_NAME_V1";


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
  const [needsTeam, setNeedsTeam] = useState(false);
  const [needsPlayer, setNeedsPlayer] = useState(false);
  const checking = useRef(false);

  useEffect(() => {
    let appState = AppState.currentState;

    const check = async () => {
      if (checking.current) return;
      checking.current = true;
      try {
      // ✅ Always ensure a Supabase session exists before any checks
      if (Platform.OS !== "web") {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData?.session) {
          await supabase.auth.signInAnonymously();
        }
      }

      const { data, error } = await supabase
        .from("app_settings")
        .select("current_season_id")
        .single();

      const currentSeasonId = (data as any)?.current_season_id ?? "";
      const acceptedSeasonId = await getAcceptedSeasonId();

      // ✅ If Supabase failed (network error, offline, etc.) and user has a valid
      // local session, trust it — don't kick them out just because of a bad connection.
      if ((error || !currentSeasonId) && acceptedSeasonId) {
        const localTeamId = Platform.OS === "web"
          ? (window?.localStorage?.getItem(LOCAL_TEAM_KEY) ?? "")
          : ((await SecureStore.getItemAsync(LOCAL_TEAM_KEY)) ?? "");
        const localPlayerName = Platform.OS === "web"
          ? (window?.localStorage?.getItem(LOCAL_PLAYER_KEY) ?? "")
          : ((await SecureStore.getItemAsync(LOCAL_PLAYER_KEY)) ?? "");
        setLocked(false);
        setNeedsTeam(!localTeamId);
        setNeedsPlayer(!!localTeamId && !localPlayerName);
        setReady(true);
        return;
      }

      // ✅ lock if no accepted season, or season changed
      const shouldLock = !acceptedSeasonId || acceptedSeasonId !== currentSeasonId;

      const localTeamId = Platform.OS === "web"
        ? (window?.localStorage?.getItem(LOCAL_TEAM_KEY) ?? "")
        : ((await SecureStore.getItemAsync(LOCAL_TEAM_KEY)) ?? "");

      const localPlayerName = Platform.OS === "web"
        ? (window?.localStorage?.getItem(LOCAL_PLAYER_KEY) ?? "")
        : ((await SecureStore.getItemAsync(LOCAL_PLAYER_KEY)) ?? "");

      if (shouldLock) {
        await clearAcceptedSeasonId();
        setLocked(true);
        setNeedsTeam(false);
        setNeedsPlayer(false);
      } else {
        // ✅ If local says team is set, verify Supabase agrees
        if (localTeamId) {
          const userRes = await supabase.auth.getUser();
          const uid = userRes.data.user?.id ?? null;
          if (uid) {
            const { data: profile } = await supabase
              .from("user_season_profiles")
              .select("team_id")
              .eq("user_id", uid)
              .eq("season_id", currentSeasonId)
              .maybeSingle();

            if (!profile?.team_id) {
              if (Platform.OS === "web") {
                window?.localStorage?.removeItem(LOCAL_TEAM_KEY);
                window?.localStorage?.removeItem(LOCAL_PLAYER_KEY);
              } else {
                await SecureStore.deleteItemAsync(LOCAL_TEAM_KEY);
                await SecureStore.deleteItemAsync(LOCAL_PLAYER_KEY);
              }
              setLocked(false);
              setNeedsTeam(true);
              setNeedsPlayer(false);
              setReady(true);
              return;
            }
          }
        }

        setLocked(false);
        setNeedsTeam(!localTeamId);
        setNeedsPlayer(!!localTeamId && !localPlayerName);
      }

      setReady(true);
      } finally {
        checking.current = false;
      }
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
    // ✅ WEB ONLY: if someone visits the root site while "locked", send them to the public homepage
  // This prevents the hard gate from hijacking "/" before app/index.tsx can redirect.
  

        const isPublicWebRoute =
  Platform.OS === "web" &&
  (pathname === "" ||
    pathname === "/" ||
    pathname === "/home" ||
    pathname === "/register" ||
    pathname === "/member-login" ||
    pathname === "/attendance");





  // ✅ HARD GATE: if locked, force league-lock no matter where they are
  if (locked && !isOnLeagueLock && !isPublicWebRoute) {
    return <Redirect href="/league-lock" />;
  }

  // ✅ TEAM GATE: if unlocked but no team selected, force choose-team
  const isOnChooseTeam = pathname === "/choose-team";
  const isOnChoosePlayer = pathname === "/choose-player";
  const isOnAdmin = pathname.includes("admin");

  if (!locked && needsTeam && !isOnChooseTeam && !isOnChoosePlayer && !isOnAdmin && !isPublicWebRoute) {
    return <Redirect href="/choose-team" />;
  }

  if (!locked && needsPlayer && !isOnChoosePlayer && !isOnAdmin && !isPublicWebRoute) {
    return <Redirect href="/choose-player" />;
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
