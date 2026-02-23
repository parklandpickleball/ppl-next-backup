import React, { useCallback, useState } from "react";
import { SafeAreaView, StyleSheet, Text, View, Pressable, ActivityIndicator } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { supabase } from "../constants/supabaseClient";

type SettingsRow = {
  id: string;
  current_season_id: string | null;
  playoff_mode: boolean | null;
};

export default function PlayoffModeScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [settingsId, setSettingsId] = useState<string | null>(null);
const [currentSeasonName, setCurrentSeasonName] = useState<string | null>(null);
  const [playoffMode, setPlayoffMode] = useState<boolean>(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);

      const res = await supabase
        .from("app_settings")
        .select("id,current_season_id,playoff_mode")
        .limit(1)
        .maybeSingle();

      const row = res.data as SettingsRow | null;

      setSettingsId(row?.id ?? null);
if (row?.current_season_id) {
  const seasonRes = await supabase
    .from("seasons")
    .select("name")
    .eq("id", row.current_season_id)
    .maybeSingle();

  setCurrentSeasonName(seasonRes.data?.name ?? null);
} else {
  setCurrentSeasonName(null);
}
      setPlayoffMode(!!row?.playoff_mode);
    } finally {
      setLoading(false);
      setSaving(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const togglePlayoffMode = async () => {
    if (!settingsId || saving) return;

    const next = !playoffMode;
    setSaving(true);
    setPlayoffMode(next); // optimistic UI

    const { error } = await supabase
      .from("app_settings")
      .update({ playoff_mode: next })
      .eq("id", settingsId);

    if (error) {
      // revert if failed
      setPlayoffMode(!next);
    }

    setSaving(false);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Playoff Mode</Text>
        <Pressable style={styles.headerBack} onPress={() => router.back()}>
          <Text style={styles.headerBackText}>Return to Admin</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <View style={styles.wrap}>
          <View style={styles.card}>
            <Text style={styles.label}>Current Season ID</Text>
<Text style={styles.value}>{currentSeasonName ?? "None"}</Text>

            <View style={styles.divider} />

            <Text style={styles.label}>Playoff Mode</Text>
            <Text style={[styles.value, playoffMode ? styles.on : styles.off]}>
              {playoffMode ? "ON" : "OFF"}
            </Text>

            <Pressable
              style={[styles.btn, saving && styles.disabled]}
              onPress={togglePlayoffMode}
              disabled={saving || !settingsId}
            >
              <Text style={styles.btnText}>
                {saving ? "Saving..." : playoffMode ? "Turn OFF" : "Turn ON"}
              </Text>
            </Pressable>

            <Text style={styles.note}>
              Note: Turning OFF will not delete your playoff board data. It will repopulate when turned ON again.
            </Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },

  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderColor: "#eee",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  headerTitle: { fontSize: 22, fontWeight: "900" },
  headerBack: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#111827",
  },
  headerBackText: { color: "#fff", fontWeight: "900" },

  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  wrap: { padding: 16 },

  card: {
    backgroundColor: "#f3f4f6",
    borderRadius: 18,
    padding: 16,
  },
  label: { fontSize: 12, fontWeight: "900", color: "#6b7280" },
  value: { marginTop: 4, fontSize: 18, fontWeight: "900", color: "#111827" },

  on: { color: "#065f46" },
  off: { color: "#991b1b" },

  divider: { height: 1, backgroundColor: "#e5e7eb", marginVertical: 14 },

  btn: {
    marginTop: 14,
    backgroundColor: "#000",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "900", fontSize: 16 },

  note: { marginTop: 12, color: "#374151", fontWeight: "700", lineHeight: 18 },

  disabled: { opacity: 0.5 },
});
