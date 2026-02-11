import { Tabs, useRouter } from "expo-router";
import React, { useEffect, useRef } from "react";
import { AppState, AppStateStatus, Platform } from "react-native";

import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { supabase } from "@/constants/supabaseClient";
import { AdminSessionProvider } from "../../lib/adminSession";

export default function TabLayout() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const scheme = colorScheme ?? "light";

  const currentSeasonRef = useRef<string | null>(null);
  const kickedRef = useRef(false);
  const intervalRef = useRef<any>(null);

  const loadSeasonId = async () => {
    const { data, error } = await supabase
      .from("app_settings")
      .select("current_season_id")
      .single();

    if (error) {
      console.log("Season check: load error", error);
      return null;
    }
    return data?.current_season_id ?? null;
  };

  const kickToLeagueLock = async () => {
    if (kickedRef.current) return;
    kickedRef.current = true;

    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.log("Season kick: signOut error", e);
    }

    router.replace("/league-lock" as any);
  };

  const checkSeasonNow = async () => {
    const latest = await loadSeasonId();
    const prev = currentSeasonRef.current;

    // First run: just set baseline
    if (!prev) {
      currentSeasonRef.current = latest;
      return;
    }

    if (latest && latest !== prev) {
      console.log("✅ Season changed detected (poll/focus). Kicking user.", {
        from: prev,
        to: latest,
      });
      currentSeasonRef.current = latest;
      await kickToLeagueLock();
    }
  };

  useEffect(() => {
    let mounted = true;

    // 1) Baseline season on mount
    void (async () => {
      const initial = await loadSeasonId();
      if (!mounted) return;
      currentSeasonRef.current = initial;

      // 2) Start polling (reliable)
      intervalRef.current = setInterval(() => {
        void checkSeasonNow();
      }, 4000); // every 4 seconds
    })();

    // 3) Also re-check when app returns to foreground (reliable)
    const onAppStateChange = (state: AppStateStatus) => {
      if (state === "active") {
        void checkSeasonNow();
      }
    };

    const sub = AppState.addEventListener("change", onAppStateChange);

    // 4) Web: check on tab focus
    const onWindowFocus = () => void checkSeasonNow();
    if (Platform.OS === "web") {
      window.addEventListener("focus", onWindowFocus);
    }

    return () => {
      mounted = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      sub.remove();
      if (Platform.OS === "web") {
        window.removeEventListener("focus", onWindowFocus);
      }
    };
  }, []);

  return (
    <AdminSessionProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarButton: HapticTab,
          tabBarStyle: {
            backgroundColor: Colors[scheme].background,
            borderTopColor: "#ddd",
          },
          tabBarActiveTintColor: Colors[scheme].tint,
          tabBarInactiveTintColor: Colors[scheme].text,
          tabBarShowLabel: true,
        }}
      >
        <Tabs.Screen
          name="schedule"
          options={{
            title: "Schedule",
            tabBarIcon: ({ color }) => (
              <IconSymbol size={28} name="calendar" color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="scoring"
          options={{
            title: "Scoring",
            tabBarIcon: ({ color }) => (
              <IconSymbol size={28} name="pencil" color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="results"
          options={{
            title: "Results",
            tabBarIcon: ({ color }) => (
              <IconSymbol size={28} name="trophy" color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="standings"
          options={{
            title: "Standings",
            tabBarIcon: ({ color }) => (
              <IconSymbol size={28} name="list.bullet" color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="announcements"
          options={{
            title: "Announcements",
            tabBarIcon: ({ color }) => (
              <IconSymbol size={28} name="megaphone" color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="photos"
          options={{
            title: "Photos",
            tabBarIcon: ({ color }) => (
              <IconSymbol size={28} name="photo" color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="winners"
          options={{
            title: "Past Results",
            tabBarIcon: ({ color }) => (
              <IconSymbol size={28} name="rosette" color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="sponsors"
          options={{
            title: "Sponsors",
            tabBarIcon: ({ color }) => (
              <IconSymbol size={28} name="star" color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="admin"
          options={{
            title: "Admin",
            tabBarIcon: ({ color }) => (
              <IconSymbol size={28} name="gearshape" color={color} />
            ),
          }}
        />
      </Tabs>
    </AdminSessionProvider>
  );
}
