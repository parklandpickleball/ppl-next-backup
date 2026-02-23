import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { supabase } from "../constants/supabaseClient";

type AppSettingsRow = { current_season_id: string | null };

const FALLBACK_SEASON_ID = "60e682dc-25db-4480-a924-f326755eef79";

type PlayerPick = {
  teamId: string;
  divisionId: string | null;
  teamName: string;
  playerWhich: 1 | 2;
  playerName: string;
};

const getStr = (obj: any, keys: string[], fallback = "") => {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return fallback;
};
const getUuid = (obj: any, keys: string[]) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.length >= 8) return v;
  }
  return null;
};

export default function PublicAttendancePage() {
  const params = useLocalSearchParams();

  const [seasonId, setSeasonId] = useState<string>(FALLBACK_SEASON_ID);

  // week can be passed in link like /attendance?week=8
  const initialWeek = useMemo(() => {
    const raw = String(params.week ?? "").trim();
    const w = Number(raw);
    return Number.isFinite(w) && w > 0 ? w : 0;
  }, [params.week]);

  const [weekInput, setWeekInput] = useState(initialWeek ? String(initialWeek) : "");
  const [week, setWeek] = useState<number>(initialWeek);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [teams, setTeams] = useState<any[]>([]);
  const [divisions, setDivisions] = useState<any[]>([]);

  const [search, setSearch] = useState("");
    const [selected, setSelected] = useState<PlayerPick | null>(null);
      const [attendanceMap, setAttendanceMap] = useState<Record<string, "IN" | "OUT">>({});

  const [lastSaved, setLastSaved] = useState<{
    week: number;
    teamId: string;
    playerWhich: 1 | 2;
    status: "IN" | "OUT";
  } | null>(null);

  useEffect(() => {
    const loadSeason = async () => {
      // Single source of truth: app_settings.current_season_id
      const res = await supabase.from("app_settings").select("current_season_id").maybeSingle<AppSettingsRow>();
      const sid = res.data?.current_season_id ?? null;
      setSeasonId(sid || FALLBACK_SEASON_ID);
    };

    loadSeason();
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!seasonId) return;

      setLoading(true);
      try {
        const divRes = await supabase.from("divisions").select("*").eq("season_id", seasonId);
        setDivisions(divRes.data ?? []);

        const teamRes = await supabase.from("teams").select("*").eq("season_id", seasonId);
        setTeams(teamRes.data ?? []);
      } finally {
        setLoading(false);
      }
    };
      useEffect(() => {
    const loadAttendance = async () => {
      if (!seasonId || !week) return;

      const { data } = await supabase
        .from("attendance")
        .select("*")
        .eq("season_id", seasonId)
        .eq("week", week);

      if (!data) return;

      const map: Record<string, "IN" | "OUT"> = {};

      for (const row of data) {
        if (row.player1_in !== null) {
          map[`${row.team_id}-1`] = row.player1_in ? "IN" : "OUT";
        }
        if (row.player2_in !== null) {
          map[`${row.team_id}-2`] = row.player2_in ? "IN" : "OUT";
        }
      }

      setAttendanceMap(map);
    };

    loadAttendance();
  }, [seasonId, week]);

    load();
  }, [seasonId]);

  const players: PlayerPick[] = useMemo(() => {
    const out: PlayerPick[] = [];

    for (const t of teams) {
      const teamId = getUuid(t, ["id", "team_id"]);
      if (!teamId) continue;

      const teamName = getStr(t, ["team_name", "name"], "Team");
      const divisionId = getUuid(t, ["division_id"]) ?? null;

      const p1 = getStr(t, ["player1_name", "player1", "p1_name"], "").trim();
      const p2 = getStr(t, ["player2_name", "player2", "p2_name"], "").trim();

      if (p1) {
        out.push({
          teamId,
          divisionId,
          teamName,
          playerWhich: 1,
          playerName: p1,
        });
      }
      if (p2) {
        out.push({
          teamId,
          divisionId,
          teamName,
          playerWhich: 2,
          playerName: p2,
        });
      }
    }

    // sort A-Z
    return out.sort((a, b) => a.playerName.localeCompare(b.playerName));
  }, [teams]);

  const filteredPlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return players;
    return players.filter((p) => {
      const label = `${p.playerName} ${p.teamName}`.toLowerCase();
      return label.includes(q);
    });
  }, [players, search]);

  const weekOk = useMemo(() => Number.isFinite(week) && week > 0, [week]);

  const applyWeek = () => {
    const w = Number(String(weekInput ?? "").trim());
    if (!Number.isFinite(w) || w <= 0) {
      Alert.alert("Week required", "Type the week number (example: 8).");
      return;
    }
    setWeek(w);
  };

  const submit = async (inOrOut: "IN" | "OUT") => {
    if (!weekOk) {
      Alert.alert("Week required", "Type the week number first.");
      return;
    }
    if (!selected) {
      Alert.alert("Pick your name", "Search and tap your name first.");
      return;
    }

    setSaving(true);
    try {
      // Read existing row so we preserve the other player state
      const existingRes = await supabase
        .from("attendance")
        .select("*")
        .eq("season_id", seasonId)
        .eq("week", week)
        .eq("team_id", selected.teamId)
        .maybeSingle();

      const existing = existingRes.data ?? null;

      const currentP1 = existing?.player1_in === false ? false : true;
      const currentP2 = existing?.player2_in === false ? false : true;

      const nextP1 = selected.playerWhich === 1 ? inOrOut === "IN" : currentP1;
      const nextP2 = selected.playerWhich === 2 ? inOrOut === "IN" : currentP2;

      const upRes = await supabase
        .from("attendance")
        .upsert(
          {
            season_id: seasonId,
            week,
            team_id: selected.teamId,
            division_id: selected.divisionId,
            player1_in: nextP1,
            player2_in: nextP2,
          },
          { onConflict: "season_id,week,team_id" }
        );

      if (upRes.error) {
        Alert.alert("Error", upRes.error.message);
        return;
      }

            setLastSaved({
        week,
        teamId: selected.teamId,
        playerWhich: selected.playerWhich,
        status: inOrOut,
      });
setAttendanceMap((prev) => ({
  ...prev,
  [`${selected.teamId}-${selected.playerWhich}`]: inOrOut,
}));
      Alert.alert("Saved", `${selected.playerName} marked ${inOrOut} for Week ${week}.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>PPL Attendance</Text>
        <Text style={styles.sub}>Pick your name, then tap IN or OUT.</Text>
        <Text style={{ marginTop: 6, fontWeight: "800", color: "#444" }}>Season: {seasonId}</Text>
<Text style={{ marginTop: 2, fontWeight: "800", color: "#444" }}>Teams loaded: {teams.length}</Text>
      </View>

      <View style={styles.weekBox}>
        <Text style={styles.weekLabel}>Week</Text>
        <TextInput
          value={weekInput}
          onChangeText={setWeekInput}
          placeholder="e.g. 8"
          keyboardType="numeric"
          style={styles.weekInput}
        />
        <Pressable style={styles.weekBtn} onPress={applyWeek}>
          <Text style={styles.weekBtnText}>Set</Text>
        </Pressable>
      </View>

      {!weekOk && <Text style={styles.warn}>⚠️ Week is required before submitting.</Text>}

      <View style={styles.searchBox}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search your name…"
          style={styles.searchInput}
        />
      </View>

      {loading ? (
        <View style={{ padding: 16 }}>
          <ActivityIndicator />
          <Text style={{ marginTop: 10, fontWeight: "800", color: "#444" }}>Loading players…</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 }}>
                    {filteredPlayers.map((p) => {
            const isSel =
              selected?.teamId === p.teamId &&
              selected?.playerWhich === p.playerWhich &&
              selected?.playerName === p.playerName;

            const status = attendanceMap[`${p.teamId}-${p.playerWhich}`];

            return (
              <Pressable
                key={`${p.teamId}-${p.playerWhich}-${p.playerName}`}
                onPress={() => setSelected(p)}
                style={[
  styles.pickRow,
  status === "IN" && styles.pickRowSelectedIn,
  status === "OUT" && styles.pickRowSelectedOut,
  isSel && !status && styles.pickRowSelected,
]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.pickName}>{p.playerName}</Text>
                  <Text style={styles.pickMeta}>
                    {p.teamName} • Player {p.playerWhich}
                  </Text>
                </View>
                <Text style={styles.pickRight}>
  {status === "IN" ? "IN" : status === "OUT" ? "OUT" : isSel ? "✓" : ""}
</Text>
              </Pressable>
            );
          })}

          {filteredPlayers.length === 0 && (
            <Text style={{ fontWeight: "800", color: "#666" }}>
              No matches. Try a different search.
            </Text>
          )}
        </ScrollView>
      )}

      <View style={styles.bottomBar}>
        <Pressable
          disabled={saving}
          style={[styles.actionBtn, styles.inBtn, saving && { opacity: 0.6 }]}
          onPress={() => submit("IN")}
        >
          <Text style={styles.actionText}>✅ I’M IN</Text>
        </Pressable>

        <Pressable
          disabled={saving}
          style={[styles.actionBtn, styles.outBtn, saving && { opacity: 0.6 }]}
          onPress={() => submit("OUT")}
        >
          <Text style={styles.actionText}>❌ I’M OUT</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  header: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  title: { fontSize: 26, fontWeight: "900" },
  sub: { marginTop: 6, fontWeight: "800", color: "#333" },

  weekBox: {
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingBottom: 8,
  },
  weekLabel: { fontWeight: "900" },
  weekInput: {
    flex: 1,
    borderWidth: 2,
    borderColor: "#111",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontWeight: "900",
  },
  weekBtn: {
    backgroundColor: "#111",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  weekBtnText: { color: "#fff", fontWeight: "900" },
  warn: { paddingHorizontal: 16, paddingBottom: 6, color: "#b45309", fontWeight: "900" },

  searchBox: { paddingHorizontal: 16, paddingBottom: 10 },
  searchInput: {
    borderWidth: 2,
    borderColor: "#111",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontWeight: "900",
  },

  pickRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#e6e6e6",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 10,
    backgroundColor: "#fff",
  },
  pickRowSelected: {
    borderColor: "#111",
    backgroundColor: "#FEF3C7",
  },
    pickRowSelectedIn: {
    borderColor: "#16a34a",
    backgroundColor: "#DCFCE7",
  },
  pickRowSelectedOut: {
    borderColor: "#dc2626",
    backgroundColor: "#FEE2E2",
  },
  pickName: { fontWeight: "900", fontSize: 16, color: "#111" },
  pickMeta: { marginTop: 2, fontWeight: "800", color: "#555" },
  pickRight: { width: 24, textAlign: "right", fontWeight: "900", fontSize: 18 },

  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#eee",
    backgroundColor: "#fff",
    gap: 10,
  },
  actionBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  inBtn: { backgroundColor: "#16a34a" },
  outBtn: { backgroundColor: "#dc2626" },
  actionText: { color: "#fff", fontWeight: "900", fontSize: 16 },
});