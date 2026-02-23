import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { supabase } from "../../constants/supabaseClient";

/**
 * USER SCHEDULE TAB (READ-ONLY)
 * ✅ Season is ALWAYS the source of truth from app_settings.current_season_id
 * ✅ Weeks + matches filtered by season_id (never mixes seasons)
 * ✅ Sorted by time then court
 * ✅ High-contrast Week dropdown modal (same style as rest of app)
 * ✅ Compact match layout for iPhone + web
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

const COLORS = {
  bg: "#FFFFFF",
  text: "#111827",
  subtext: "#374151",
  border: "#111827",
  cardBorder: "#E5E7EB",
  headerBg: "#F3F4F6",
  rowBorder: "#E5E7EB",
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

export default function ScheduleScreen() {
  const [loading, setLoading] = useState(true);

  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [seasonName, setSeasonName] = useState<string>("");

  const [weeks, setWeeks] = useState<ScheduleWeekRow[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);

  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [teamsById, setTeamsById] = useState<Record<string, string>>({});
  const [divisionsById, setDivisionsById] = useState<Record<string, string>>({});

  const [errorMsg, setErrorMsg] = useState<string>("");
  const [weekPickerOpen, setWeekPickerOpen] = useState(false);

  // (Button can exist now; filtering logic will be wired after team/player selection exists)
  const [showOnlyMine, setShowOnlyMine] = useState(false);
    // ✅ Gate selection: the user's chosen team for this season (used by "Show only my schedule")
 const [myTeamId, setMyTeamId] = useState<string | null>(null);

// ✅ Dues banner (dismissible)
const [myPlayerName, setMyPlayerName] = useState<string>("");
const [duesPaid, setDuesPaid] = useState(true);
const [duesDismissed, setDuesDismissed] = useState(false);


  const boot = useCallback(async () => {
    setLoading(true);
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
      setMatches([]);
      setLoading(false);
      setErrorMsg("Current season is not set.");
      return;
    }

    const sid = settings.current_season_id;
    setSeasonId(sid);

        // Load myTeamId from the Choose Team / Player gate
    try {
    
  const userRes = await supabase.auth.getUser();
  const uid = userRes.data.user?.id ?? null;

  if (uid) {
    const { data: profile } = await supabase
      .from("user_season_profiles")
      .select("team_id, player_name")
      .eq("user_id", uid)
      .eq("season_id", sid)
      .maybeSingle<any>();

    const teamId = profile?.team_id ?? null;
    const playerName = (profile?.player_name ?? "").trim();

    setMyTeamId(teamId);
    setMyPlayerName(playerName);

    // ✅ Dues check (based on teams.player1_paid / player2_paid)
    if (teamId) {
      const { data: teamRow } = await supabase
        .from("teams")
        .select("id, player1_name, player2_name, player1_paid, player2_paid")
        .eq("id", teamId)
        .eq("season_id", sid)
        .maybeSingle<any>();

      const p1Name = (teamRow?.player1_name ?? "").trim();
      const p2Name = (teamRow?.player2_name ?? "").trim();
      const p1Paid = !!teamRow?.player1_paid;
      const p2Paid = !!teamRow?.player2_paid;

      let isPaid = true;

      // If we can match which player they are, use that paid flag.
      if (playerName && p1Name && playerName.toLowerCase() === p1Name.toLowerCase()) isPaid = p1Paid;
      else if (playerName && p2Name && playerName.toLowerCase() === p2Name.toLowerCase()) isPaid = p2Paid;
      else {
        // Fallback: treat team paid only if BOTH are paid
        isPaid = p1Paid && p2Paid;
      }

      setDuesPaid(isPaid);

      // If they become paid, clear dismissal and hide banner
      if (isPaid) {
        setDuesDismissed(false);
      }
    } else {
      setMyTeamId(null);
      setMyPlayerName("");
      setDuesPaid(true);
      setDuesDismissed(false);
    }
  } else {
    setMyTeamId(null);
    setMyPlayerName("");
    setDuesPaid(true);
    setDuesDismissed(false);
  }
} catch {
  setMyTeamId(null);
  setMyPlayerName("");
  setDuesPaid(true);
  setDuesDismissed(false);
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
      setLoading(false);
      setErrorMsg("Could not load weeks.");
      return;
    }

    const safeWeeks = (weekRows ?? []) as ScheduleWeekRow[];
    setWeeks(safeWeeks);

    const keep =
      selectedWeek != null && safeWeeks.some((w) => w.week === selectedWeek) ? selectedWeek : null;

    setSelectedWeek(keep ?? pickDefaultWeek(safeWeeks));

    setLoading(false);
  }, [selectedWeek]);

  const loadWeek = useCallback(async () => {
    setErrorMsg("");
    setMatches([]);
    setTeamsById({});
    setDivisionsById({});

    if (!seasonId || selectedWeek == null) return;

    let q = supabase
  .from("matches")
  .select("id,season_id,week,division_id,match_time,court,team_a_id,team_b_id")
  .eq("season_id", seasonId)
  .eq("week", selectedWeek);

// ✅ Only apply filter when button is ON
if (showOnlyMine) {
  if (!myTeamId) {
    setErrorMsg("Your team is not set for this season.");
    setMatches([]);
    return;
  }

  q = q.or(`team_a_id.eq.${myTeamId},team_b_id.eq.${myTeamId}`);
}

const { data: matchRows, error: matchErr } = await q
  .order("match_time", { ascending: true })
  .order("court", { ascending: true });


    if (matchErr) {
      setErrorMsg("Could not load matches for this week.");
      return;
    }

    const safeMatches = ((matchRows ?? []) as MatchRow[]).slice();
    safeMatches.sort((a, b) => {
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

    const divisionIds = Array.from(
      new Set(
        safeMatches
          .map((m) => m.division_id)
          .filter((x): x is string => !!x)
      )
    );

    if (teamIds.length) {
      const { data: teamRows } = await supabase
        .from("teams")
        .select("id,team_name")
        .in("id", teamIds);

      const map: Record<string, string> = {};
      (teamRows as TeamRow[] | null)?.forEach((t) => {
        map[t.id] = t.team_name ?? "Team";
      });
      setTeamsById(map);
    }

    if (divisionIds.length) {
      const { data: divRows } = await supabase
        .from("divisions")
        .select("id,name")
        .in("id", divisionIds);

      const map: Record<string, string> = {};
      (divRows as DivisionRow[] | null)?.forEach((d) => {
        map[d.id] = d.name ?? "Division";
      });
      setDivisionsById(map);
    }
  }, [seasonId, selectedWeek, showOnlyMine, myTeamId]);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    void loadWeek();
  }, [loadWeek]);

  useFocusEffect(
  useCallback(() => {
    // ✅ Show banner again every time user returns to Schedule (unless they are paid)
    setDuesDismissed(false);
    void boot();
  }, [boot])
);

  useFocusEffect(
    useCallback(() => {
      void loadWeek();
    }, [loadWeek])
  );

  const selectedWeekRow = useMemo(() => {
    if (selectedWeek == null) return null;
    return weeks.find((w) => w.week === selectedWeek) ?? null;
  }, [weeks, selectedWeek]);

  const weekLabel = useMemo(() => {
    if (selectedWeek == null) return "Select Week";
    const d = formatWeekDate(selectedWeekRow?.week_date ?? null);
    return d ? `Week ${selectedWeek} • ${d}` : `Week ${selectedWeek}`;
  }, [selectedWeek, selectedWeekRow]);

  const tableDateLabel = useMemo(() => {
    return formatWeekDate(selectedWeekRow?.week_date ?? null);
  }, [selectedWeekRow]);

  const groups = useMemo(() => {
    const out: { divisionName: string; rows: MatchRow[] }[] = [];
    const map: Record<string, MatchRow[]> = {};

    matches.forEach((m) => {
      const divName =
        (m.division_id && divisionsById[m.division_id]) ||
        (m.division_id ? "Division" : "Unassigned Division");

      if (!map[divName]) map[divName] = [];
      map[divName].push(m);
    });

    // ✅ Division order: Beginner, Intermediate, Advanced, then alphabetical for anything else
    const DIVISION_ORDER: Record<string, number> = {
      beginner: 0,
      intermediate: 1,
      advanced: 2,
    };

    const normalize = (s: string) => s.trim().toLowerCase();

    Object.keys(map)
      .sort((a, b) => {
        const aKey = normalize(a);
        const bKey = normalize(b);

        const aRank = DIVISION_ORDER[aKey] ?? 999;
        const bRank = DIVISION_ORDER[bKey] ?? 999;

        if (aRank !== bRank) return aRank - bRank;
        return a.localeCompare(b);
      })
      .forEach((k) => out.push({ divisionName: k, rows: map[k] }));

    return out;
  }, [matches, divisionsById]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 10, color: COLORS.text }}>Loading schedule…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      {/* ✅ ONE scroll surface so you can scroll from the filters area too */}
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 30 }}>
        <View style={{ marginBottom: 10 }}>
          <Text style={{ fontSize: 22, fontWeight: "900", color: COLORS.text }}>
            Schedule
          </Text>
          <Text style={{ marginTop: 4, color: COLORS.subtext, fontWeight: "700" }}>
  {(() => {
    const seasonLabel = seasonName ? seasonName.replace(/^Season\s*/i, "").trim() : "";
    const latestWeek = weeks.length ? weeks[weeks.length - 1].week : null;

    if (!seasonLabel && latestWeek == null) return "Season";
    if (!seasonLabel) return `Week ${latestWeek}`;
    if (latestWeek == null) return `Season: ${seasonLabel}`;

    return `Season: ${seasonLabel} - Week ${latestWeek}`;
  })()}
</Text>
        </View>

{/* ✅ DUES BANNER (dismissible) */}
{!duesPaid && !duesDismissed ? (
  <View
    style={{
      borderWidth: 2,
      borderColor: "#cc0000",
      backgroundColor: "#FEF3C7",
      borderRadius: 14,
      padding: 12,
      marginBottom: 12,
    }}
  >
    <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: "900", color: "#111", fontSize: 15 }}>
          ***LEAGUE DUES OUTSTANDING***
        </Text>
        <Text style={{ marginTop: 4, fontWeight: "800", color: "#111" }}>
          Please arrange payment with a league administrator at your earliest convenience.
        </Text>
      </View>

      <Pressable
        onPress={() => setDuesDismissed(true)}
        style={{
          width: 34,
          height: 34,
          borderRadius: 999,
          borderWidth: 2,
          borderColor: "#111",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#fff",
        }}
      >
        <Text style={{ fontWeight: "900", color: "#111", fontSize: 16 }}>✕</Text>
      </Pressable>
    </View>
  </View>
) : null}

{/* Week Dropdown */}
<Pressable
          onPress={() => setWeekPickerOpen(true)}
          style={{
            paddingVertical: 14,
            paddingHorizontal: 14,
            borderRadius: 14,
            borderWidth: 2,
            borderColor: COLORS.blue,
            backgroundColor: "#FFFFFF",
            marginBottom: 10,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontWeight: "900", fontSize: 16, color: COLORS.text }}>
              {weekLabel}
            </Text>
            <Text style={{ fontWeight: "900", fontSize: 16, color: COLORS.text }}>
              ▼
            </Text>
          </View>
          <Text style={{ marginTop: 4, color: COLORS.subtext, fontSize: 13, fontWeight: "700" }}>
            Tap to choose a different week
          </Text>
        </Pressable>

        {/* Filter toggle (placeholder until Team/Player selection exists) */}
        <Pressable
          onPress={() => setShowOnlyMine((v) => !v)}
          style={{
            alignSelf: "center",
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 12,
            borderWidth: 2,
            borderColor: COLORS.blue,
            backgroundColor: showOnlyMine ? "#DBEAFE" : "#FFFFFF",
            marginBottom: 12,
          }}
        >
          <Text style={{ fontWeight: "900", color: COLORS.text }}>
            {showOnlyMine ? "Showing only my schedule" : "Show only my schedule"}
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

        {weeks.length === 0 ? (
          <View style={{ padding: 14 }}>
            <Text style={{ fontWeight: "900", color: COLORS.text }}>No schedule weeks yet.</Text>
          </View>
        ) : selectedWeek == null ? (
          <View style={{ padding: 14 }}>
            <Text style={{ fontWeight: "900", color: COLORS.text }}>
              Select a week to view matches.
            </Text>
          </View>
        ) : matches.length === 0 ? (
          <View style={{ padding: 14 }}>
            <Text style={{ fontWeight: "900", color: COLORS.text }}>
              No matches scheduled for this week yet.
            </Text>
          </View>
        ) : (
          groups.map((group) => (
            <View key={group.divisionName} style={{ marginBottom: 16 }}>
              {/* Division header (bigger + highlighted) */}
              <View
                style={{
                  backgroundColor: "#DBEAFE",
                  borderWidth: 2,
                  borderColor: COLORS.blue,
                  borderRadius: 12,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  marginBottom: 10,
                }}
              >
                <Text style={{ fontSize: 18, fontWeight: "900", color: COLORS.text }}>
                  {group.divisionName}
                </Text>
              </View>

              <View style={{ gap: 10 }}>
                {group.rows.map((m) => {
                  const teamA = m.team_a_id ? teamsById[m.team_a_id] : null;
                  const teamB = m.team_b_id ? teamsById[m.team_b_id] : null;

                  const matchup = `${teamA ?? "TBD"} vs ${teamB ?? "TBD"}`;
                  const time = formatTimeTo12Hour(m.match_time);
                  const court = m.court != null ? String(m.court) : "";
                  const metaLine = `${tableDateLabel}${time ? " • " + time : ""}${court ? " • Court " + court : ""}`;

                  return (
                    <View
                      key={m.id}
                      style={{
                        borderWidth: 1,
                        borderColor: COLORS.rowBorder,
                        borderRadius: 14,
                        paddingVertical: 12,
                        paddingHorizontal: 12,
                        backgroundColor: "#FFFFFF",
                      }}
                    >
                      {/* Matchup (smaller than before) */}
                      <Text style={{ fontSize: 16, fontWeight: "900", color: COLORS.text }}>
                        {matchup}
                      </Text>

                      {/* One compact line under it */}
                      <Text style={{ marginTop: 6, fontSize: 14, fontWeight: "800", color: COLORS.subtext }}>
                        {metaLine}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ))
        )}

        <View style={{ height: 10 }} />
      </ScrollView>

      {/* Week Picker Modal */}
      <Modal visible={weekPickerOpen} transparent animationType="fade">
        <Pressable
          onPress={() => setWeekPickerOpen(false)}
          style={{
            flex: 1,
            backgroundColor: COLORS.overlay,
            padding: 18,
            justifyContent: "center",
          }}
        >
          <Pressable
            onPress={() => {}}
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

            <ScrollView>
              {weeks
                .slice()
                .sort((a, b) => a.week - b.week)
                .map((w) => {
                  const isSelected = w.week === selectedWeek;
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
                        borderColor: isSelected ? COLORS.blue : COLORS.rowBorder,
                        backgroundColor: isSelected ? "#DBEAFE" : "#FFFFFF",
                      }}
                    >
                      <Text style={{ fontWeight: "900", fontSize: 16, color: COLORS.text }}>
                        {label}
                      </Text>
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
              <Text style={{ fontWeight: "900", fontSize: 16, color: "#FFFFFF" }}>
                Close
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
