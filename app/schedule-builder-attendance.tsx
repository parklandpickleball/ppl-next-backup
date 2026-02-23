import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../constants/supabaseClient";

const FALLBACK_SEASON_ID = "60e682dc-25db-4480-a924-f326755eef79";

// ---------- helpers (defensive) ----------
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

export default function ScheduleBuilderAttendance() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const seasonId = String(params.seasonId ?? "") || FALLBACK_SEASON_ID;
  const week = Number(String(params.week ?? "0"));
  console.log("ATTENDANCE SCREEN seasonId/week:", seasonId, week);

  const [loading, setLoading] = useState(false);

  const [divisions, setDivisions] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);

  // attendanceState[team_id] = { player1_in, player2_in, division_id }
  const [attendanceState, setAttendanceState] = useState<
    Record<string, { player1_in: boolean; player2_in: boolean; division_id: string | null }>
  >({});

  const loadAll = useCallback(async () => {
    if (!seasonId || !week) return;

    setLoading(true);
    try {
      // 1) divisions
const divRes = await supabase
  .from("divisions")
  .select("*")
  .eq("season_id", seasonId);

if (divRes.error) {
  console.error("divisions load error:", divRes.error);
  setDivisions([]);
} else {
  const DIVISION_ORDER: Record<string, number> = {
    Beginner: 0,
    Intermediate: 1,
    Advanced: 2,
  };

  const divs = (divRes.data ?? []).slice().sort((a: any, b: any) => {
    const aName = String(a.name ?? "").trim();
    const bName = String(b.name ?? "").trim();

    const aRank = DIVISION_ORDER[aName] ?? 999;
    const bRank = DIVISION_ORDER[bName] ?? 999;

    if (aRank !== bRank) return aRank - bRank;
    return aName.localeCompare(bName);
  });

  setDivisions(divs);
}


      // 2) teams (NO order("name") - your table doesn't have teams.name)
      const teamRes = await supabase
        .from("teams")
        .select("*")
        .eq("season_id", seasonId);

      const ts = teamRes.data ?? [];
      setTeams(ts);

      // 3) attendance rows for that week
      const attRes = await supabase
        .from("attendance")
        .select("*")
        .eq("season_id", seasonId)
        .eq("week", week);

      const rows = attRes.data ?? [];
      const rowByTeam: Record<string, any> = {};
      for (const r of rows) {
        if (r?.team_id) rowByTeam[String(r.team_id)] = r;
      }

      // 4) build local state (default both IN)
      const next: Record<string, { player1_in: boolean; player2_in: boolean; division_id: string | null }> = {};
      for (const t of ts) {
        const tid = getUuid(t, ["id", "team_id"]);
        if (!tid) continue;

        const divId = getUuid(t, ["division_id"]) ?? null;
        const r = rowByTeam[tid];

        next[tid] = {
          player1_in: r?.player1_in === false ? false : true,
          player2_in: r?.player2_in === false ? false : true,
          division_id: r?.division_id ?? divId,
        };
      }

      setAttendanceState(next);
    } finally {
      setLoading(false);
    }
  }, [seasonId, week]);

  useEffect(() => {
    if (!week) {
      Alert.alert("Week missing", "Go back and pick a week first.");
      router.back();
      return;
    }
    loadAll();
  }, [week, loadAll, router]);

  const upsertAttendanceRow = useCallback(
    async (teamId: string, divisionId: string | null, p1: boolean, p2: boolean) => {
      await supabase
        .from("attendance")
        .upsert(
          {
            season_id: seasonId,
            week,
            team_id: teamId,
            division_id: divisionId,
            player1_in: p1,
            player2_in: p2,
          },
          { onConflict: "season_id,week,team_id" }
        );
    },
    [seasonId, week]
  );

  const togglePlayer = useCallback(
    (team: any, which: 1 | 2) => {
      const teamId = getUuid(team, ["id", "team_id"]);
      if (!teamId) return;

      const divId = getUuid(team, ["division_id"]) ?? null;

      setAttendanceState((prev) => {
        const cur = prev[teamId] ?? { player1_in: true, player2_in: true, division_id: divId };
        const next = {
          player1_in: which === 1 ? !cur.player1_in : cur.player1_in,
          player2_in: which === 2 ? !cur.player2_in : cur.player2_in,
          division_id: cur.division_id ?? divId,
        };

        // save (no popup)
        upsertAttendanceRow(teamId, next.division_id, next.player1_in, next.player2_in);

        return { ...prev, [teamId]: next };
      });
    },
    [upsertAttendanceRow]
  );

  const teamStatusColor = (teamId: string) => {
    const s = attendanceState[teamId];
    const p1 = s?.player1_in ?? true;
    const p2 = s?.player2_in ?? true;

    if (p1 && p2) return "#d6f5d6"; // green
    if (!p1 && !p2) return "#e0e0e0"; // grey
    return "#fff2b3"; // yellow
  };

const groupedTeams = useMemo(() => {
  // Build a map: division name -> division id (so we can group even if teams store the name)
  const divNameToId: Record<string, string> = {};
  for (const d of divisions) {
    const did = getUuid(d, ["id", "division_id"]);
    const dname = getStr(d, ["name", "division_name"], "").trim().toLowerCase();
    if (did && dname) divNameToId[dname] = did;
  }

  const byDiv: Record<string, any[]> = {};

  for (const t of teams) {
    // Try ALL common ways Manage Teams might store the division
    let divId =
  getUuid(t, ["division_id", "divisionId", "division_uuid", "division"]) ||
  null;


    // If Manage Teams stored the division NAME instead of UUID, map it
    if (!divId) {
      const maybeName =
        getStr(t, ["division", "division_name", "divisionName"], "").trim().toLowerCase();
      if (maybeName && divNameToId[maybeName]) divId = divNameToId[maybeName];
    }

    const key = divId ?? "unassigned";
    if (!byDiv[key]) byDiv[key] = [];
    byDiv[key].push(t);
  }

  return byDiv;
}, [teams, divisions]);


  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Attendance</Text>

        <Pressable
  style={styles.backBtn}
  onPress={() => {
    // ✅ Web: force navigation (works even after refresh / no history)
    if (typeof window !== "undefined") {
      window.location.href = `/schedule-builder?seasonId=${seasonId}&week=${week}`;
      return;
    }
    // ✅ Native: normal navigation
    router.replace(`/schedule-builder?seasonId=${seasonId}&week=${week}` as any);
  }}
>
  <Text style={styles.backBtnText}>Back</Text>
</Pressable>
      </View>

      <Text style={styles.sub}>
        Week {week} • Tap player names to toggle IN/OUT
      </Text>
 


      {loading ? (
        <Text style={styles.notice}>Loading…</Text>
      ) : teams.length === 0 ? (
        <Text style={styles.notice}>
          No teams found for this season. Go to Manage Teams and confirm teams exist.
        </Text>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {divisions.map((d) => {
            const divId = getUuid(d, ["id", "division_id"]) ?? "unassigned";
            const divName = getStr(d, ["name", "division_name"], "Division");
            const list = groupedTeams[divId] ?? [];

            if (list.length === 0) return null;

            return (
              <View key={divId} style={styles.divBlock}>
                <Text style={styles.divTitle}>{divName}</Text>

                {/* header */}
                <View style={[styles.row, styles.rowHeader]}>
                  <Text style={[styles.cellTeam, styles.headerText]}>Team</Text>
                  <Text style={[styles.cell, styles.headerText]}>Player 1</Text>
                  <Text style={[styles.cell, styles.headerText]}>Player 2</Text>
                  <Text style={[styles.cellStatus, styles.headerText]}>Status</Text>
                </View>

                {list.map((t: any) => {
                  const tid = getUuid(t, ["id", "team_id"]);
                  if (!tid) return null;

                  const teamName = getStr(t, ["name", "team_name"], "Team");
                  const p1 = getStr(t, ["player1_name", "player1", "p1_name"], "Player 1");
                  const p2 = getStr(t, ["player2_name", "player2", "p2_name"], "Player 2");

                  const s = attendanceState[tid] ?? { player1_in: true, player2_in: true, division_id: divId };
                  const bg = teamStatusColor(tid);

                  const statusText =
                    s.player1_in && s.player2_in
                      ? "IN"
                      : !s.player1_in && !s.player2_in
                      ? "OUT"
                      : "MIXED";

                  return (
                    <View key={tid} style={[styles.row, { backgroundColor: bg }]}>
                      <Text style={styles.cellTeam}>{teamName}</Text>

                      <Pressable
                        style={[styles.pill, s.player1_in ? styles.inPill : styles.outPill]}
                        onPress={() => togglePlayer(t, 1)}
                      >
                        <Text style={styles.pillText}>{p1}</Text>
                      </Pressable>

                      <Pressable
                        style={[styles.pill, s.player2_in ? styles.inPill : styles.outPill]}
                        onPress={() => togglePlayer(t, 2)}
                      >
                        <Text style={styles.pillText}>{p2}</Text>
                      </Pressable>

                      <Text style={styles.cellStatus}>{statusText}</Text>
                    </View>
                  );
                })}
              </View>
            );
          })}

          {(groupedTeams["unassigned"] ?? []).length > 0 && (
            <View style={styles.divBlock}>
              <Text style={styles.divTitle}>Unassigned Teams</Text>

              <View style={[styles.row, styles.rowHeader]}>
                <Text style={[styles.cellTeam, styles.headerText]}>Team</Text>
                <Text style={[styles.cell, styles.headerText]}>Player 1</Text>
                <Text style={[styles.cell, styles.headerText]}>Player 2</Text>
                <Text style={[styles.cellStatus, styles.headerText]}>Status</Text>
              </View>

              {(groupedTeams["unassigned"] ?? []).map((t: any) => {
                const tid = getUuid(t, ["id", "team_id"]);
                if (!tid) return null;

                const teamName = getStr(t, ["name", "team_name"], "Team");
                const p1 = getStr(t, ["player1_name", "player1", "p1_name"], "Player 1");
                const p2 = getStr(t, ["player2_name", "player2", "p2_name"], "Player 2");

                const s = attendanceState[tid] ?? { player1_in: true, player2_in: true, division_id: null };
                const bg = teamStatusColor(tid);

                const statusText =
                  s.player1_in && s.player2_in
                    ? "IN"
                    : !s.player1_in && !s.player2_in
                    ? "OUT"
                    : "MIXED";

                return (
                  <View key={tid} style={[styles.row, { backgroundColor: bg }]}>
                    <Text style={styles.cellTeam}>{teamName}</Text>

                    <Pressable
                      style={[styles.pill, s.player1_in ? styles.inPill : styles.outPill]}
                      onPress={() => togglePlayer(t, 1)}
                    >
                      <Text style={styles.pillText}>{p1}</Text>
                    </Pressable>

                    <Pressable
                      style={[styles.pill, s.player2_in ? styles.inPill : styles.outPill]}
                      onPress={() => togglePlayer(t, 2)}
                    >
                      <Text style={styles.pillText}>{p2}</Text>
                    </Pressable>

                    <Text style={styles.cellStatus}>{statusText}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },

  headerRow: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 26, fontWeight: "900" },
  sub: { paddingHorizontal: 16, color: "#333", fontWeight: "800", marginBottom: 8 },

  backBtn: {
    backgroundColor: "#000",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  backBtnText: { color: "#fff", fontWeight: "900" },

  notice: { paddingHorizontal: 16, paddingTop: 12, color: "#666", fontWeight: "800" },

  divBlock: { marginBottom: 18 },
  divTitle: { fontSize: 18, fontWeight: "900", marginBottom: 8 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e6e6e6",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  rowHeader: { backgroundColor: "#f3f3f3" },
  headerText: { fontWeight: "900" },

  cellTeam: { flex: 2, fontWeight: "900" },
  cell: { flex: 2, textAlign: "center", fontWeight: "900" },
  cellStatus: { flex: 1, textAlign: "center", fontWeight: "900" },

  pill: {
    flex: 2,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignItems: "center",
    marginHorizontal: 4,
  },
  inPill: { backgroundColor: "#2ecc71" },
  outPill: { backgroundColor: "#e74c3c" },
  pillText: { color: "#fff", fontWeight: "900", textAlign: "center" },
});
