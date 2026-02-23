import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { supabase } from "../../constants/supabaseClient";

/**
 * RESULTS TAB (READ-ONLY) — PPL NEXT
 *
 * ✅ Single source of truth: app_settings.current_season_id
 * ✅ Refresh on tab focus (no manual refresh)
 * ✅ Realtime: refresh scores instantly when match_scores change
 * ✅ Realtime: refresh matches instantly when matches change for current season
 * ✅ "Scroll from anywhere": header is inside main ScrollView
 */

type AppSettingsRow = { current_season_id: string | null };
type SeasonRow = { id: string; name: string | null };

type ScheduleWeekRow = {
  season_id: string;
  week: number;
  week_date: string | null;
};

type MatchRow = {
  id: string;
  season_id: string;
  week: number;
  division_id: string | null;
  match_time: string | null;
  court: number | null;
  team_a_id: string | null;
  team_b_id: string | null;
};

type TeamRow = { id: string; team_name: string | null };
type DivisionRow = { id: string; name: string | null };

type ScoreFields = { g1: string; g2: string; g3: string };

type MatchScoreRow = {
  match_id: string;
  team_a: any;
  team_b: any;
  verified: boolean;
  verified_by: string | null;
  verified_at: string | null;
  locked_at: string | null;
  locked_by: string | null;
};

const COLORS = {
  bg: "#FFFFFF",
  text: "#111827",
  subtext: "#374151",
  border: "#111827",
  headerBg: "#F5F5F5",
  overlay: "rgba(0,0,0,0.55)",
  blue: "#2563EB",
};

function formatTimeTo12Hour(t: string | null): string {
  if (!t) return "";
  const s = t.trim();
  const up = s.toUpperCase();
  if (up.includes("AM") || up.includes("PM")) return s;

  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return s;

  let hour = parseInt(m[1], 10);
  const minute = m[2];

  const ampm = hour >= 12 ? "PM" : "AM";
  hour = hour % 12;
  if (hour === 0) hour = 12;

  return `${hour}:${minute} ${ampm}`;
}

function timeToSortableMinutes(t: string | null): number {
  if (!t) return 999999;
  const s = t.trim();

  const m24 = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m24) {
    const hh = parseInt(m24[1], 10);
    const mm = parseInt(m24[2], 10);
    return hh * 60 + mm;
  }

  const up = s.toUpperCase();
  const m12 = up.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);
  if (m12) {
    let hh = parseInt(m12[1], 10);
    const mm = m12[2] ? parseInt(m12[2], 10) : 0;
    const ap = m12[3];
    if (hh === 12) hh = 0;
    let total = hh * 60 + mm;
    if (ap === "PM") total += 12 * 60;
    return total;
  }

  return 999999;
}

function formatWeekDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function pickDefaultWeek(weeks: ScheduleWeekRow[]): number | null {
  if (!weeks.length) return null;

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

  const dated = weeks
    .filter((w) => !!w.week_date && !isNaN(new Date(`${w.week_date as string}T00:00:00`).getTime()))
    .map((w) => ({ week: w.week, time: new Date(`${w.week_date as string}T00:00:00`).getTime() }))
    .sort((a, b) => a.time - b.time);

  if (dated.length) {
    const past = dated.filter((w) => w.time <= todayStart);
    if (past.length) return past[past.length - 1].week;
    return dated[0].week;
  }

  return [...weeks].sort((a, b) => a.week - b.week)[weeks.length - 1].week;
}

function asScoreFields(v: any): ScoreFields {
  const g1 = typeof v?.g1 === "string" ? v.g1 : "";
  const g2 = typeof v?.g2 === "string" ? v.g2 : "";
  const g3 = typeof v?.g3 === "string" ? v.g3 : "";
  return { g1, g2, g3 };
}

function toN(s: string) {
  const n = parseInt(s || "0", 10);
  return Number.isFinite(n) ? n : 0;
}

function totalOf(fields: ScoreFields) {
  return toN(fields.g1) + toN(fields.g2) + toN(fields.g3);
}

// empty string = not entered; "0" counts as entered
function isEnteredScore(v: string) {
  return (v ?? "").trim() !== "";
}
function gameEnteredPair(a: string, b: string) {
  return isEnteredScore(a) && isEnteredScore(b);
}
function enteredGamesCount(teamA: ScoreFields, teamB: ScoreFields) {
  const a = [teamA.g1, teamA.g2, teamA.g3];
  const b = [teamB.g1, teamB.g2, teamB.g3];
  let entered = 0;
  for (let i = 0; i < 3; i++) {
    if (!gameEnteredPair(a[i], b[i])) continue;
    entered += 1;
  }
  return entered;
}

type DivisionChoice = { id: string; name: string };

export default function ResultsScreen() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [loading, setLoading] = useState(true);

  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [seasonName, setSeasonName] = useState<string>("");

  const [weeks, setWeeks] = useState<ScheduleWeekRow[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<number | "ALL" | null>(null);

  const [weekPickerOpen, setWeekPickerOpen] = useState(false);

  const [divisionPickerOpen, setDivisionPickerOpen] = useState(false);
  const [divisionChoices, setDivisionChoices] = useState<DivisionChoice[]>([]);
  const [selectedDivisionId, setSelectedDivisionId] = useState<string | "ALL">("ALL");

  const [search, setSearch] = useState("");
  const [onlyMine, setOnlyMine] = useState(false); // wired later
  const [myTeamId, setMyTeamId] = useState<string | null>(null);


  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [teamsById, setTeamsById] = useState<Record<string, string>>({});
  const [divisionsById, setDivisionsById] = useState<Record<string, string>>({});
  const [scoresByMatchId, setScoresByMatchId] = useState<Record<string, MatchScoreRow>>({});

  const [errorMsg, setErrorMsg] = useState("");

  // Realtime channel ref
  const channelRef = useRef<any>(null);

  const selectedWeekRow = useMemo(() => {
    if (selectedWeek == null || selectedWeek === "ALL") return null;
    return weeks.find((w) => w.week === selectedWeek) ?? null;
  }, [weeks, selectedWeek]);

  const weekLabel = useMemo(() => {
    if (selectedWeek == null) return "Select Week";
    if (selectedWeek === "ALL") return "All Weeks";
    const d = formatWeekDate(selectedWeekRow?.week_date ?? null);
    return d ? `Week ${selectedWeek} • ${d}` : `Week ${selectedWeek}`;
  }, [selectedWeek, selectedWeekRow]);

  const selectedDivisionLabel = useMemo(() => {
    if (selectedDivisionId === "ALL") return "All Divisions";
    const found = divisionChoices.find((d) => d.id === selectedDivisionId);
    return found?.name ?? "Division";
  }, [selectedDivisionId, divisionChoices]);

  const refreshScoresOnly = useCallback(async (matchIds: string[]) => {
    if (!matchIds.length) {
      setScoresByMatchId({});
      return;
    }

    const { data: scoreRows, error: scoreErr } = await supabase
      .from("match_scores")
      .select("match_id,team_a,team_b,verified,verified_by,verified_at,locked_at,locked_by")
      .in("match_id", matchIds);

    if (scoreErr) {
      setScoresByMatchId({});
      setErrorMsg((prev) => prev || "Could not load match scores.");
      return;
    }

    const map: Record<string, MatchScoreRow> = {};
    (scoreRows as MatchScoreRow[] | null)?.forEach((r) => {
      map[String(r.match_id)] = r;
    });
    setScoresByMatchId(map);
  }, []);

  const loadSeasonWeeksDivisions = useCallback(async (): Promise<string | null> => {
    setErrorMsg("");

    const { data: settings, error: settingsError } = await supabase
      .from("app_settings")
      .select("current_season_id")
      .single<AppSettingsRow>();

    if (settingsError || !settings?.current_season_id) {
      setSeasonId(null);
      setSeasonName("");
      setWeeks([]);
      setSelectedWeek(null);
      setDivisionChoices([]);
      setDivisionsById({});
      setErrorMsg("Current season is not set.");
      return null;
    }

    const sid = settings.current_season_id;
    setSeasonId(sid);

        // Load myTeamId from Choose Team / Player gate
    try {
      const userRes = await supabase.auth.getUser();
      const uid = userRes.data.user?.id ?? null;

      if (uid) {
        const { data: profile } = await supabase
          .from("user_season_profiles")
          .select("team_id")
          .eq("user_id", uid)
          .eq("season_id", sid)
          .maybeSingle<any>();

        setMyTeamId(profile?.team_id ?? null);
      } else {
        setMyTeamId(null);
      }
    } catch {
      setMyTeamId(null);
    }

    const { data: season } = await supabase
      .from("seasons")
      .select("id,name")
      .eq("id", sid)
      .single<SeasonRow>();

    setSeasonName(season?.name ?? "");

    const { data: weekRows, error: weekErr } = await supabase
      .from("schedule_weeks")
      .select("season_id,week,week_date")
      .eq("season_id", sid)
      .order("week", { ascending: true });

    if (weekErr) {
      setWeeks([]);
      setSelectedWeek(null);
      setErrorMsg("Could not load weeks.");
      return sid;
    }

    const safeWeeks = (weekRows ?? []) as ScheduleWeekRow[];
    setWeeks(safeWeeks);

    // keep current selection if still valid, else pick default
    setSelectedWeek((prev) => {
      if (prev === "ALL") return "ALL";
      if (prev != null && safeWeeks.some((w) => w.week === prev)) return prev;
      const def = pickDefaultWeek(safeWeeks);
      return def ?? null;
    });

    // IMPORTANT: divisions list for picker should be season-scoped
    const { data: divRows } = await supabase
      .from("divisions")
      .select("id,name")
      .eq("season_id", sid)
      .order("name", { ascending: true });

    const divSafe = (divRows ?? []) as DivisionRow[];

    const divMap: Record<string, string> = {};
    divSafe.forEach((d) => (divMap[d.id] = d.name ?? "Division"));
    setDivisionsById(divMap);

    const choices: DivisionChoice[] = divSafe.map((d) => ({
      id: d.id,
      name: d.name ?? "Division",
    }));
    setDivisionChoices(choices);

    // if current selectedDivisionId isn't valid for this season, reset to ALL
    setSelectedDivisionId((prev) => {
      if (prev === "ALL") return "ALL";
      if (choices.some((c) => c.id === prev)) return prev;
      return "ALL";
    });

    return sid;
  }, []);

  const loadMatchesAndLookups = useCallback(async (sid: string, wk: number | "ALL" | null, divId: string | "ALL") => {
    setErrorMsg("");
    setMatches([]);
    setTeamsById({});
    setScoresByMatchId({});

    let q = supabase
      .from("matches")
      .select("id,season_id,week,division_id,match_time,court,team_a_id,team_b_id")
      .eq("season_id", sid);

    if (wk != null && wk !== "ALL") q = q.eq("week", wk);
    if (divId !== "ALL") q = q.eq("division_id", divId);

        // ✅ Show only my results (gate-selected team)
    if (onlyMine) {
      if (!myTeamId) {
        setErrorMsg("Your team is not set for this season.");
        setMatches([]);
        return { safeMatches: [], matchIds: [] };
      }

      q = q.or(`team_a_id.eq.${myTeamId},team_b_id.eq.${myTeamId}`);
    }

    const { data: matchRows, error: matchErr } = await q
      .order("week", { ascending: true })
      .order("match_time", { ascending: true })
      .order("court", { ascending: true });

    if (matchErr) {
      setErrorMsg("Could not load results for these filters.");
      return { safeMatches: [] as MatchRow[], matchIds: [] as string[] };
    }

    const safeMatches = ((matchRows ?? []) as MatchRow[]).slice();
    safeMatches.sort((a, b) => {
      if (a.week !== b.week) return a.week - b.week;
      const ta = timeToSortableMinutes(a.match_time);
      const tb = timeToSortableMinutes(b.match_time);
      if (ta !== tb) return ta - tb;
      return (a.court ?? 0) - (b.court ?? 0);
    });

    setMatches(safeMatches);

    const teamIds = Array.from(
      new Set(
        safeMatches
          .flatMap((m) => [m.team_a_id, m.team_b_id])
          .filter((x): x is string => !!x)
      )
    );

    if (teamIds.length) {
      const { data: teamRows } = await supabase.from("teams").select("id,team_name").in("id", teamIds);
      const map: Record<string, string> = {};
      (teamRows as TeamRow[] | null)?.forEach((t) => (map[t.id] = t.team_name ?? "Team"));
      setTeamsById(map);
    }

    const matchIds = safeMatches.map((m) => m.id);
    if (matchIds.length) {
      await refreshScoresOnly(matchIds);
    }

    return { safeMatches, matchIds };
    }, [refreshScoresOnly, onlyMine, myTeamId]);

  const fullRefresh = useCallback(async () => {
    setLoading(true);

    const sid = await loadSeasonWeeksDivisions();
    if (!sid) {
      setMatches([]);
      setTeamsById({});
      setScoresByMatchId({});
      setLoading(false);
      return;
    }

    // IMPORTANT: Use latest state values after season load
    // We read selectedWeek/selectedDivisionId via setState, so use current values in this tick:
    // best effort: use current state values; focus refresh will run again if user changes filters.
    const wk = selectedWeek;
    const divId = selectedDivisionId;

    await loadMatchesAndLookups(sid, wk, divId);

    setLoading(false);
  }, [loadSeasonWeeksDivisions, loadMatchesAndLookups, selectedWeek, selectedDivisionId]);

  // Initial load
  useEffect(() => {
    void fullRefresh();
  }, [fullRefresh]);

  // ✅ Refresh when user navigates back to this tab (this is what you want)
  useFocusEffect(
    useCallback(() => {
      void fullRefresh();
    }, [fullRefresh])
  );

  // ✅ REALTIME: listen for match_scores + matches changes
  useEffect(() => {
    if (!seasonId) return;

    // cleanup any previous channel
    if (channelRef.current) {
      try {
        supabase.removeChannel(channelRef.current);
      } catch {}
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`results_realtime_${seasonId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "match_scores" },
        async () => {
          // refresh scores only for currently loaded matches (fast)
          const ids = matches.map((m) => m.id);
          await refreshScoresOnly(ids);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches", filter: `season_id=eq.${seasonId}` },
        async () => {
          // matches changed in this season -> refresh
          await fullRefresh();
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        try {
          supabase.removeChannel(channelRef.current);
        } catch {}
        channelRef.current = null;
      }
    };
  }, [seasonId, matches, refreshScoresOnly, fullRefresh]);

  // When filters change, reload matches (no need to reload season)
  useEffect(() => {
    const run = async () => {
      if (!seasonId) return;
      await loadMatchesAndLookups(seasonId, selectedWeek, selectedDivisionId);
    };
    void run();
  }, [seasonId, selectedWeek, selectedDivisionId, loadMatchesAndLookups]);

  const filteredMatches = useMemo(() => {
    const q = (search ?? "").trim().toLowerCase();
    if (!q) return matches;

    return matches.filter((m) => {
      const a = m.team_a_id ? (teamsById[m.team_a_id] ?? "").toLowerCase() : "";
      const b = m.team_b_id ? (teamsById[m.team_b_id] ?? "").toLowerCase() : "";
      return a.includes(q) || b.includes(q);
    });
  }, [matches, search, teamsById]);

  const grouped = useMemo(() => {
    const map: Record<string, MatchRow[]> = {};
    filteredMatches.forEach((m) => {
      const divName =
        (m.division_id && divisionsById[m.division_id]) ||
        (m.division_id ? "Division" : "Unassigned Division");
      if (!map[divName]) map[divName] = [];
      map[divName].push(m);
    });

    return Object.keys(map)
      .sort((a, b) => a.localeCompare(b))
      .map((k) => ({ divisionName: k, rows: map[k] }));
  }, [filteredMatches, divisionsById]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 10, color: COLORS.text }}>Loading results…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: 14, paddingBottom: 40, backgroundColor: COLORS.bg }}
      keyboardShouldPersistTaps="always"
    >
      <Text style={{ fontSize: 24, fontWeight: "900", color: COLORS.text, marginBottom: 6 }}>Results</Text>
      <Text style={{ color: COLORS.subtext, fontWeight: "700", marginBottom: 12 }}>
  {(() => {
    const seasonLabel = seasonName ? seasonName.replace(/^Season\s*/i, "").trim() : "";
    const latestWeek = weeks.length ? weeks[weeks.length - 1].week : null;

    if (!seasonLabel && latestWeek == null) return "Season";
    if (!seasonLabel) return `Week ${latestWeek}`;
    if (latestWeek == null) return `Season: ${seasonLabel}`;

    return `Season: ${seasonLabel} - Week ${latestWeek}`;
  })()}
</Text>

      {/* Week dropdown (NEW APP STYLE) */}
      <Pressable
        onPress={() => setWeekPickerOpen(true)}
        style={{
          paddingVertical: 14,
          paddingHorizontal: 14,
          borderRadius: 14,
          borderWidth: 2,
          borderColor: COLORS.blue,
          backgroundColor: "#FFFFFF",
          marginBottom: 12,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontWeight: "900", fontSize: 16, color: COLORS.text }}>{weekLabel}</Text>
          <Text style={{ fontWeight: "900", fontSize: 16, color: COLORS.text }}>▼</Text>
        </View>
        <Text style={{ marginTop: 4, color: COLORS.subtext, fontSize: 13, fontWeight: "700" }}>
          Tap to choose a different week
        </Text>
      </Pressable>

      {/* Division dropdown (NEW APP STYLE) */}
      <Pressable
        onPress={() => setDivisionPickerOpen(true)}
        style={{
          paddingVertical: 14,
          paddingHorizontal: 14,
          borderRadius: 14,
          borderWidth: 2,
          borderColor: COLORS.blue,
          backgroundColor: "#FFFFFF",
          marginBottom: 12,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontWeight: "900", fontSize: 16, color: COLORS.text }}>{selectedDivisionLabel}</Text>
          <Text style={{ fontWeight: "900", fontSize: 16, color: COLORS.text }}>▼</Text>
        </View>
        <Text style={{ marginTop: 4, color: COLORS.subtext, fontSize: 13, fontWeight: "700" }}>
          Tap to choose a division
        </Text>
      </Pressable>

      {/* Search */}
      <View
        style={{
          borderWidth: 2,
          borderColor: COLORS.blue,
          borderRadius: 14,
          paddingHorizontal: 12,
          paddingVertical: Platform.OS === "web" ? 10 : 8,
          backgroundColor: "#fff",
          marginBottom: 12,
        }}
      >
        <Text style={{ fontWeight: "900", color: COLORS.text, marginBottom: 6 }}>Search</Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Type a player or team name (e.g., brandon)"
          autoCapitalize="none"
          autoCorrect={false}
          underlineColorAndroid="transparent"
          style={{
            borderWidth: 1,
            borderColor: "#D1D5DB",
            borderRadius: 10,
            padding: 12,
            fontWeight: "800",
          }}
        />
      </View>

      {/* Only mine toggle (placeholder) */}
      <Pressable
        onPress={() => setOnlyMine((v) => !v)}
        style={{
          borderWidth: 2,
          borderColor: COLORS.blue,
          backgroundColor: onlyMine ? "#DBEAFE" : "#FFFFFF",
          paddingVertical: 12,
          paddingHorizontal: 14,
          borderRadius: 14,
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <Text style={{ fontWeight: "900", color: COLORS.text }}>
{onlyMine ? "Showing only my results" : "Show only my results"}
        </Text>
      </Pressable>

      {errorMsg ? (
        <View
          style={{
            padding: 12,
            borderRadius: 12,
            backgroundColor: "#FEE2E2",
            borderWidth: 1,
            borderColor: "#EF4444",
            marginBottom: 12,
          }}
        >
          <Text style={{ fontWeight: "900", color: "#991B1B" }}>{errorMsg}</Text>
        </View>
      ) : null}

      {seasonId == null ? (
        <Text style={{ fontWeight: "900", color: COLORS.text }}>Current season is not set.</Text>
      ) : filteredMatches.length === 0 ? (
        <Text style={{ fontWeight: "900", color: COLORS.text }}>No results found for these filters.</Text>
      ) : (
        <View style={{ gap: 18 }}>
          {grouped.map((group) => (
            <View key={group.divisionName}>
              <Text style={{ fontSize: 20, fontWeight: "900", marginBottom: 10, color: COLORS.text }}>
                {group.divisionName}
              </Text>

              <View style={{ gap: 14 }}>
                {group.rows.map((m) => {
                  const teamAName = m.team_a_id ? teamsById[m.team_a_id] : "Team A";
                  const teamBName = m.team_b_id ? teamsById[m.team_b_id] : "Team B";

                  const p = scoresByMatchId[m.id];
                  const aFields = asScoreFields(p?.team_a);
                  const bFields = asScoreFields(p?.team_b);

                  const aTotal = totalOf(aFields);
                  const bTotal = totalOf(bFields);

                  const enteredGames = p ? enteredGamesCount(aFields, bFields) : 0;
                  const label = enteredGames === 0 ? null : enteredGames < 3 ? "PARTIAL" : "COMPLETED";
                  const labelColor = label === "COMPLETED" ? "green" : label === "PARTIAL" ? "red" : "black";

                  const verifiedLabel = p?.verified ? `Verified by ${p.verified_by ?? "UNKNOWN"}` : "Not verified yet";

                  const time = formatTimeTo12Hour(m.match_time);
                  const courtNum = m.court != null ? String(m.court) : "";

                  return (
                    <View
                      key={m.id}
                      style={{
                        borderWidth: 2,
                        borderColor: "#000",
                        borderRadius: 10,
                        overflow: "hidden",
                        backgroundColor: "white",
                      }}
                    >
                      <View
                        style={{
                          paddingVertical: 8,
                          paddingHorizontal: 10,
                          borderBottomWidth: 1,
                          borderBottomColor: "#000",
                        }}
                      >
                        <Text style={{ fontWeight: "900" }}>
                          Week {m.week}
                          {time ? ` • ${time}` : ""}
                          {courtNum ? ` • Court ${courtNum}` : ""}
                        </Text>

                        <Text style={{ marginTop: 4, color: "#333", fontWeight: "700" }}>
                          {verifiedLabel}
                          {label ? (
                            <>
                              {" • "}
                              <Text style={{ color: labelColor, fontWeight: "900" }}>{label}</Text>
                            </>
                          ) : null}
                        </Text>
                      </View>

                      <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator>
                        <View style={{ minWidth: isLandscape ? 700 : 700 }}>
                          <View
                            style={{
                              flexDirection: "row",
                              borderBottomWidth: 1,
                              borderBottomColor: "#000",
                              paddingVertical: 8,
                              backgroundColor: COLORS.headerBg,
                            }}
                          >
                            <Text style={{ width: 110, fontWeight: "900", textAlign: "center" }}>TIME</Text>
                            <Text style={{ width: 90, fontWeight: "900", textAlign: "center" }}>COURT #</Text>
                            <Text style={{ flex: 2, fontWeight: "900", textAlign: "center" }}>TEAM NAME</Text>
                            <Text style={{ width: 90, fontWeight: "900", textAlign: "center" }}>G1</Text>
                            <Text style={{ width: 90, fontWeight: "900", textAlign: "center" }}>G2</Text>
                            <Text style={{ width: 90, fontWeight: "900", textAlign: "center" }}>G3</Text>
                            <Text style={{ width: 90, fontWeight: "900", textAlign: "center" }}>TOTAL</Text>
                          </View>

                          <View style={{ flexDirection: "row", paddingVertical: 10, alignItems: "center" }}>
                            <Text style={{ width: 110, textAlign: "center" }}>{time || ""}</Text>
                            <Text style={{ width: 90, textAlign: "center" }}>{courtNum || ""}</Text>
                            <Text style={{ flex: 2, textAlign: "center" }} numberOfLines={1}>
                              {teamAName}
                            </Text>

                            <Text style={{ width: 90, textAlign: "center" }}>{aFields.g1 || "-"}</Text>
                            <Text style={{ width: 90, textAlign: "center" }}>{aFields.g2 || "-"}</Text>
                            <Text style={{ width: 90, textAlign: "center" }}>{aFields.g3 || "-"}</Text>

                            <Text style={{ width: 90, textAlign: "center", fontWeight: "900" }}>{aTotal}</Text>
                          </View>

                          <View style={{ height: 1, backgroundColor: "#000" }} />

                          <View style={{ flexDirection: "row", paddingVertical: 10, alignItems: "center" }}>
                            <Text style={{ width: 110, textAlign: "center" }}>{time || ""}</Text>
                            <Text style={{ width: 90, textAlign: "center" }}>{courtNum || ""}</Text>
                            <Text style={{ flex: 2, textAlign: "center" }} numberOfLines={1}>
                              {teamBName}
                            </Text>

                            <Text style={{ width: 90, textAlign: "center" }}>{bFields.g1 || "-"}</Text>
                            <Text style={{ width: 90, textAlign: "center" }}>{bFields.g2 || "-"}</Text>
                            <Text style={{ width: 90, textAlign: "center" }}>{bFields.g3 || "-"}</Text>

                            <Text style={{ width: 90, textAlign: "center", fontWeight: "900" }}>{bTotal}</Text>
                          </View>
                        </View>
                      </ScrollView>
                    </View>
                  );
                })}
              </View>

              <View style={{ height: 6 }} />
            </View>
          ))}
        </View>
      )}

      {/* Week Picker Modal */}
      <Modal visible={weekPickerOpen} transparent animationType="fade">
        <Pressable
          onPress={() => setWeekPickerOpen(false)}
          style={{ flex: 1, backgroundColor: COLORS.overlay, padding: 18, justifyContent: "center" }}
        >
          <View
            onStartShouldSetResponder={() => true}
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: 16,
              padding: 14,
              maxHeight: "75%",
              borderWidth: 2,
              borderColor: COLORS.border,
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: "900", marginBottom: 12, color: COLORS.text }}>
              Choose Week
            </Text>

            <ScrollView keyboardShouldPersistTaps="always">
              <Pressable
                onPress={() => {
                  setSelectedWeek("ALL");
                  setWeekPickerOpen(false);
                }}
                style={{
                  paddingVertical: 14,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  marginBottom: 10,
                  borderWidth: 2,
                  borderColor: selectedWeek === "ALL" ? COLORS.blue : "#D1D5DB",
                  backgroundColor: selectedWeek === "ALL" ? "#DBEAFE" : "#FFFFFF",
                }}
              >
                <Text style={{ fontWeight: "900", fontSize: 16, color: COLORS.text }}>All Weeks</Text>
              </Pressable>

              {weeks
                .slice()
                .sort((a, b) => a.week - b.week)
                .map((w) => {
                  const isSelected = selectedWeek === w.week;
                  const d = formatWeekDate(w.week_date);
                  const label = d ? `Week ${w.week} • ${d}` : `Week ${w.week}`;

                  return (
                    <Pressable
                      key={w.week}
                      onPress={() => {
                        setSelectedWeek(w.week);
                        setWeekPickerOpen(false);
                      }}
                      style={{
                        paddingVertical: 14,
                        paddingHorizontal: 12,
                        borderRadius: 12,
                        marginBottom: 10,
                        borderWidth: 2,
                        borderColor: isSelected ? COLORS.blue : "#D1D5DB",
                        backgroundColor: isSelected ? "#DBEAFE" : "#FFFFFF",
                      }}
                    >
                      <Text style={{ fontWeight: "900", fontSize: 16, color: COLORS.text }}>{label}</Text>
                    </Pressable>
                  );
                })}
            </ScrollView>

            <Pressable
              onPress={() => setWeekPickerOpen(false)}
              style={{
                marginTop: 10,
                paddingVertical: 14,
                borderRadius: 12,
                alignItems: "center",
                backgroundColor: COLORS.blue,
              }}
            >
              <Text style={{ fontWeight: "900", fontSize: 16, color: "#FFFFFF" }}>Close</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Division Picker Modal */}
      <Modal visible={divisionPickerOpen} transparent animationType="fade">
        <Pressable
          onPress={() => setDivisionPickerOpen(false)}
          style={{ flex: 1, backgroundColor: COLORS.overlay, padding: 18, justifyContent: "center" }}
        >
          <View
            onStartShouldSetResponder={() => true}
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: 16,
              padding: 14,
              maxHeight: "75%",
              borderWidth: 2,
              borderColor: COLORS.border,
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: "900", marginBottom: 12, color: COLORS.text }}>
              Choose Division
            </Text>

            <ScrollView keyboardShouldPersistTaps="always">
              <Pressable
                onPress={() => {
                  setSelectedDivisionId("ALL");
                  setDivisionPickerOpen(false);
                }}
                style={{
                  paddingVertical: 14,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  marginBottom: 10,
                  borderWidth: 2,
                  borderColor: selectedDivisionId === "ALL" ? COLORS.blue : "#D1D5DB",
                  backgroundColor: selectedDivisionId === "ALL" ? "#DBEAFE" : "#FFFFFF",
                }}
              >
                <Text style={{ fontWeight: "900", fontSize: 16, color: COLORS.text }}>All Divisions</Text>
              </Pressable>

              {divisionChoices.map((d) => {
                const isSelected = selectedDivisionId === d.id;
                return (
                  <Pressable
                    key={d.id}
                    onPress={() => {
                      setSelectedDivisionId(d.id);
                      setDivisionPickerOpen(false);
                    }}
                    style={{
                      paddingVertical: 14,
                      paddingHorizontal: 12,
                      borderRadius: 12,
                      marginBottom: 10,
                      borderWidth: 2,
                      borderColor: isSelected ? COLORS.blue : "#D1D5DB",
                      backgroundColor: isSelected ? "#DBEAFE" : "#FFFFFF",
                    }}
                  >
                    <Text style={{ fontWeight: "900", fontSize: 16, color: COLORS.text }}>{d.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Pressable
              onPress={() => setDivisionPickerOpen(false)}
              style={{
                marginTop: 10,
                paddingVertical: 14,
                borderRadius: 12,
                alignItems: "center",
                backgroundColor: COLORS.blue,
              }}
            >
              <Text style={{ fontWeight: "900", fontSize: 16, color: "#FFFFFF" }}>Close</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}
