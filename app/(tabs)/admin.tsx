import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAdminSession } from "../../lib/adminSession";
import { supabase } from "../../constants/supabaseClient";
const ADMIN_CODE = "2468";

export default function AdminTab() {
    const [playoffMode, setPlayoffMode] = useState(false);
    useFocusEffect(
  React.useCallback(() => {
    const loadPlayoffMode = async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("playoff_mode")
        .limit(1)
        .maybeSingle();

      setPlayoffMode(!!data?.playoff_mode);
    };

    loadPlayoffMode();
  }, [])
);

  const { isAdminUnlocked, unlockAdmin, lockAdmin } = useAdminSession();

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [seasonName, setSeasonName] = useState<string>("Loading...");
  const [divisionsExist, setDivisionsExist] = useState(false);

  const title = useMemo(
    () => (isAdminUnlocked ? "Admin Dashboard" : "Admin Access"),
    [isAdminUnlocked]
  );

  // Load current season
  const loadCurrentSeason = useCallback(async () => {
    const settings = await supabase
      .from("app_settings")
      .select("current_season_id")
      .limit(1)
      .maybeSingle();

    const currentSeasonId = settings.data?.current_season_id ?? null;
    if (!currentSeasonId) {
      setSeasonName("Not set");
      setDivisionsExist(false);
      return;
    }

    const season = await supabase
      .from("seasons")
      .select("name")
      .eq("id", currentSeasonId)
      .limit(1)
      .maybeSingle();

    setSeasonName(season.data?.name ?? "Unknown");

    // Check if any divisions exist for this season
    const divisionsRes = await supabase
      .from("divisions")
      .select("id")
      .eq("season_id", currentSeasonId)
      .limit(1);

    setDivisionsExist((divisionsRes.data?.length ?? 0) > 0);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadCurrentSeason();
    }, [loadCurrentSeason])
  );

  const onUnlock = () => {
    if (code !== ADMIN_CODE) {
      setError("Incorrect code");
      return;
    }
    unlockAdmin();
    setCode("");
    setError(null);
  };

  if (!isAdminUnlocked) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.card}>
          <Text style={styles.title}>Admin Access</Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="Enter code"
            secureTextEntry
            keyboardType="number-pad"
            style={styles.input}
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable style={styles.bigBtn} onPress={onUnlock}>
            <Text style={styles.bigBtnText}>Unlock Admin</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.wrap}>
        {/* 1. Current Season */}
        <Pressable
          style={styles.bigBtn}
          onPress={() => router.push({ pathname: "/season-selector" } as any)}
        >
          <Text style={styles.bigBtnText}>Current Season: {seasonName}</Text>
        </Pressable>

        {/* 2. Division Setup */}
        <Pressable
          style={styles.bigBtn}
          onPress={() => router.push({ pathname: "/division-setup" } as any)}
        >
          <Text style={styles.bigBtnText}>
            Division Setup – Add / Delete Divisions
          </Text>
        </Pressable>

        {/* 3. Manage Teams (disabled if no divisions exist) */}
        <Pressable
          style={[styles.bigBtn, !divisionsExist && styles.disabled]}
          disabled={!divisionsExist}
          onPress={() => router.push({ pathname: "/manage-teams" } as any)}
        >
          <Text style={styles.bigBtnText}>Manage Teams</Text>
        </Pressable>

                {/* 4. Schedule Builder */}
        <Pressable
          style={styles.bigBtn}
          onPress={() => router.push({ pathname: "/schedule-builder" } as any)}
        >
          <Text style={styles.bigBtnText}>Schedule Builder</Text>
        </Pressable>

               {/* 5. Playoff Mode */}
        <Pressable
          style={[
            styles.bigBtn,
            playoffMode && { backgroundColor: "#065F46" }
          ]}
          onPress={() => router.push({ pathname: "/playoff-mode" } as any)}
        >
          <Text style={styles.bigBtnText}>
            {playoffMode
              ? "Playoff Mode - ACTIVATED"
              : "Playoff Mode - NOT ACTIVATED"}
          </Text>
        </Pressable>


        {/* 6. Lock Admin */}
        <Pressable style={[styles.bigBtn, styles.lockBtn]} onPress={lockAdmin}>
          <Text style={styles.bigBtnText}>Lock Admin</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  wrap: { padding: 16 },
  card: { padding: 16 },
  title: { fontSize: 22, fontWeight: "900", marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  error: { color: "red", marginBottom: 10 },
  bigBtn: {
    backgroundColor: "#000",
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
  },
  bigBtnText: { color: "#fff", fontSize: 18, fontWeight: "900" },
  lockBtn: { backgroundColor: "#111" },
  disabled: { opacity: 0.5 },
});
