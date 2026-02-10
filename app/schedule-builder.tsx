import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Platform,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useRouter } from "expo-router";
import { supabase } from "../constants/supabaseClient";

const DIVISION_ORDER: Record<string, number> = {
  Advanced: 0,
  Intermediate: 1,
  Beginner: 2,
};

const FALLBACK_SEASON_ID = "60e682dc-25db-4480-a924-f326755eef79";

// ✅ WEB ONLY: remember last selected week after refresh (NO AsyncStorage, NO router)
const STORAGE_KEY_SELECTED_WEEK = "SB_SELECTED_WEEK_V1";

type WeekItem = { label: string; weekNumber: number; weekDate?: string | null };

type DivisionRow = { id: string; name: string };
type TeamRow = {
  id: string;
  season_id: string;
  division: string;
  team_name: string;
  player1_name?: string | null;
  player2_name?: string | null;

  // ✅ NEW: soft-deactivate support
  is_active?: boolean | null;
};

type MatchRow = {
  id: string;
  season_id: string;
  week: number;
  division_id: string;
  match_time: string; // DB column (can be "5:45 PM" OR "17:45:00" etc)
  court: number;
  team_a_id: string;
  team_b_id: string;
  created_at?: string;
};

type MatchDisplay = {
  id: string;
  header: string;
  sub: string;
  playedCount: number;
  division_id: string;
  match_time: string;
  court: number;
  team_a_id: string;
  team_b_id: string;
};

/* ------------------ ✅ TIME HELPERS: NO 24-HOUR ANYWHERE ------------------ */
function parseTimeToMinutes(raw: string): number | null {
  if (!raw) return null;
  const s = String(raw).trim();

  // 12-hour: "5:45 PM"
  const ampmMatch = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampmMatch) {
    let hh = Number(ampmMatch[1]);
    const mm = Number(ampmMatch[2]);
    const ap = String(ampmMatch[3]).toUpperCase();

    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    if (hh < 1 || hh > 12 || mm < 0 || mm > 59) return null;

    if (ap === "AM") {
      if (hh === 12) hh = 0;
    } else {
      if (hh !== 12) hh += 12;
    }
    return hh * 60 + mm;
  }

  // 24-hour (or time type coming from DB): "17:45" or "17:45:00"
  const t24 = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (t24) {
    const hh = Number(t24[1]);
    const mm = Number(t24[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return hh * 60 + mm;
  }

  return null;
}

function formatMinutesTo12(mins: number): string {
  let hh = Math.floor(mins / 60);
  const mm = mins % 60;
  const ampm = hh >= 12 ? "PM" : "AM";
  let displayH = hh % 12;
  if (displayH === 0) displayH = 12;
  return `${displayH}:${String(mm).padStart(2, "0")} ${ampm}`;
}

function normalizeTo12Hour(raw: string): string {
  const mins = parseTimeToMinutes(raw);
  if (mins == null) return raw; // fallback
  return formatMinutesTo12(mins);
}

async function confirmBeforeSave(title: string, message: string): Promise<boolean> {
  if (Platform.OS === "web") {
    // eslint-disable-next-line no-alert
    return window.confirm(`${title}\n\n${message}`);
  }

  return await new Promise<boolean>((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "OK", onPress: () => resolve(true) },
    ]);
  });
}

const TIMES = (() => {
  const out: string[] = [];
  const startMinutes = 17 * 60;
  const endMinutes = 22 * 60;
  for (let m = startMinutes; m <= endMinutes; m += 15) {
    out.push(formatMinutesTo12(m));
  }
  return out;
})();

const COURTS = Array.from({ length: 15 }, (_, i) => i + 1);

function formatDateLong(d: Date) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(d);
  } catch {
    return d.toDateString();
  }
}

function weekdayName(d: Date) {
  try {
    return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(d);
  } catch {
    return "";
  }
}

function ymdFromDate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getSavedWeekNumber(): number | null {
  if (Platform.OS !== "web") return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY_SELECTED_WEEK);
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  } catch {
    return null;
  }
}

function saveWeekNumber(n: number) {
  if (Platform.OS !== "web") return;
  try {
    window.localStorage.setItem(STORAGE_KEY_SELECTED_WEEK, String(n));
  } catch {}
}
function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    // eslint-disable-next-line no-alert
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message, [{ text: "OK" }]);
}

export default function ScheduleBuilder() {
  const router = useRouter();

  const [seasonId, setSeasonId] = useState<string>(FALLBACK_SEASON_ID);

  const [seasonLabel, setSeasonLabel] = useState<string>("");

  const [weeks, setWeeks] = useState<WeekItem[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<WeekItem | null>(null);
  const [weekPanelOpen, setWeekPanelOpen] = useState(false);

  const [addWeekOpen, setAddWeekOpen] = useState(false);
  const [newWeekText, setNewWeekText] = useState("");

  const [datePanelOpen, setDatePanelOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [webDate, setWebDate] = useState<string>(() => ymdFromDate(new Date()));

  const [divisions, setDivisions] = useState<DivisionRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [attendanceByTeamId, setAttendanceByTeamId] = useState<Record<string, { p1: boolean; p2: boolean }>>({});

  const [selectedDivisionId, setSelectedDivisionId] = useState<string | null>(null);

  const [timePanelOpen, setTimePanelOpen] = useState(false);
  const [selectedTime, setSelectedTime] = useState<string>(TIMES[0]); // always 12-hour
  const [selectedCourt, setSelectedCourt] = useState<number>(1);

  const [teamAId, setTeamAId] = useState<string | null>(null);
  const [teamBId, setTeamBId] = useState<string | null>(null);

  // ✅ TOOLTIP STATE (fixed, always-visible area)
  const [teamBTooltipData, setTeamBTooltipData] = useState<{ timesPlayed: number; lastWeek?: number } | null>(null);

  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);

  // ✅ NEW: remember what the match originally had (so old matches with inactive teams can still be edited)
  const [editingOriginalTeamAId, setEditingOriginalTeamAId] = useState<string | null>(null);
  const [editingOriginalTeamBId, setEditingOriginalTeamBId] = useState<string | null>(null);

  const [debugMsg, setDebugMsg] = useState<string>("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [pendingDeleteWeek, setPendingDeleteWeek] = useState<WeekItem | null>(null);

  const [clearWeekConfirmOpen, setClearWeekConfirmOpen] = useState(false);
  const [clearWeekText, setClearWeekText] = useState("");

  // season matches for badge math
  const [seasonMatches, setSeasonMatches] = useState<
    Array<Pick<MatchRow, "id" | "week" | "match_time" | "court" | "team_a_id" | "team_b_id" | "created_at">>
  >([]);

  /* ------------------ LOAD SEASON ------------------ */
  const loadSeason = useCallback(async () => {
    const settings = await supabase
      .from("app_settings")
      .select("current_season_id")
      .limit(1)
      .maybeSingle();

    const sid = settings.data?.current_season_id ?? FALLBACK_SEASON_ID;
    setSeasonId(sid);

    // ✅ SAFEST: select("*") so this cannot fail from a bad column name
    const seasonRes = await supabase
      .from("seasons")
      .select("*")
      .eq("id", sid)
      .maybeSingle();

    const row: any = seasonRes.data ?? null;

    // try a bunch of common column names that different versions might use
    const num =
      row?.season_number ??
      row?.season_num ??
      row?.seasonNumber ??
      row?.season ??
      row?.number ??
      row?.season_no ??
      row?.seasonid;

    const text =
      (num !== null && num !== undefined && String(num).trim() !== "")
        ? `Season ${num}`
        : String(row?.label ?? row?.name ?? "").trim();

    setSeasonLabel(text);
  }, []);

  /* ------------------ LOAD WEEKS ------------------ */
  const loadWeeks = useCallback(
    async (sid: string) => {
      const res = await supabase
        .from("schedule_weeks")
        .select("week, week_date")
        .eq("season_id", sid)
        .order("week", { ascending: true });

      const data = res.data ?? [];
      const mapped: WeekItem[] = data
        .map((r: any) => ({
          label: `Week ${Number(r.week)}`,
          weekNumber: Number(r.week),
          weekDate: r.week_date ?? null,
        }))
        .filter((w) => Number.isFinite(w.weekNumber) && w.weekNumber > 0);

      setWeeks(mapped);

      // ✅ WEB: restore last selected week after refresh
      const saved = getSavedWeekNumber();
      if (saved && mapped.length > 0) {
        const found = mapped.find((x) => x.weekNumber === saved) ?? null;
        if (found) {
          setSelectedWeek(found);
          return;
        }
      }

      // fallback behavior
      if (!selectedWeek && mapped.length > 0) setSelectedWeek(mapped[0]);
    },
    [selectedWeek]
  );

  // ✅ WEB: save selection any time week changes (prevents reset to Week 1 on refresh)
  useEffect(() => {
    if (!selectedWeek) return;
    saveWeekNumber(selectedWeek.weekNumber);
  }, [selectedWeek]);

  /* ------------------ LOAD DIVISIONS ------------------ */
  const loadDivisions = useCallback(
    async (sid: string) => {
      const res = await supabase.from("divisions").select("id, name").eq("season_id", sid);

      if (res.error) {
        console.error("loadDivisions error:", res.error);
        setDivisions([]);
        return;
      }

      const DIVISION_ORDER_LOCAL: Record<string, number> = {
        Beginner: 0,
        Intermediate: 1,
        Advanced: 2,
      };

      const list: DivisionRow[] = (res.data ?? [])
        .map((d: any) => ({
          id: String(d.id),
          name: String(d.name ?? "Division"),
        }))
        .sort((a, b) => {
          const aName = a.name.trim();
          const bName = b.name.trim();

          const aRank = DIVISION_ORDER_LOCAL[aName] ?? 999;
          const bRank = DIVISION_ORDER_LOCAL[bName] ?? 999;

          if (aRank !== bRank) return aRank - bRank;
          return aName.localeCompare(bName);
        });

      setDivisions(list);
      if (!selectedDivisionId && list.length > 0) {
        setSelectedDivisionId(list[0].id);
      }
    },
    [selectedDivisionId]
  );

  /* ------------------ LOAD TEAMS ------------------ */
  const loadTeams = useCallback(async (sid: string) => {
    // ✅ NEW: includes is_active for deactivation logic (NO other logic changes)
    const res = await supabase
      .from("teams")
      .select("id, season_id, division, team_name, player1_name, player2_name, is_active")
      .eq("season_id", sid)
      .order("team_name", { ascending: true });

    setTeams((res.data ?? []) as any);
  }, []);

  /* ------------------ LOAD ATTENDANCE ------------------ */
  const loadAttendance = useCallback(async (sid: string, weekNum: number) => {
    const res = await supabase
      .from("attendance")
      .select("season_id, week, team_id, player1_in, player2_in")
      .eq("season_id", sid)
      .eq("week", weekNum);

    const map: Record<string, { p1: boolean; p2: boolean }> = {};
    for (const r of res.data ?? []) {
      map[String((r as any).team_id)] = {
        p1: (r as any).player1_in ?? true,
        p2: (r as any).player2_in ?? true,
      };
    }
    setAttendanceByTeamId(map);
  }, []);

  /* ------------------ LOAD MATCHES (week) ------------------ */
  const loadMatches = useCallback(async (sid: string, weekNum: number) => {
    const res = await supabase
      .from("matches")
      .select("id, season_id, week, division_id, match_time, court, team_a_id, team_b_id, created_at")
      .eq("season_id", sid)
      .eq("week", weekNum);

    setMatches((res.data ?? []) as any);
  }, []);

  /* ------------------ LOAD ALL SEASON MATCHES (badges) ------------------ */
  const loadSeasonMatchesForBadges = useCallback(async (sid: string) => {
    const res = await supabase
      .from("matches")
      .select("id, week, match_time, court, team_a_id, team_b_id, created_at")
      .eq("season_id", sid);

    setSeasonMatches((res.data ?? []) as any);
  }, []);

  /* ------------------ INITIAL LOAD ------------------ */
  useEffect(() => {
    (async () => {
      await loadSeason();
    })();
  }, [loadSeason]);

  useEffect(() => {
    if (!seasonId) return;
    loadWeeks(seasonId);
    loadDivisions(seasonId);
    loadTeams(seasonId);
    loadSeasonMatchesForBadges(seasonId);
  }, [seasonId, loadWeeks, loadDivisions, loadTeams, loadSeasonMatchesForBadges]);

  useEffect(() => {
    if (!seasonId || !selectedWeek) return;
    loadAttendance(seasonId, selectedWeek.weekNumber);
    loadMatches(seasonId, selectedWeek.weekNumber);
  }, [seasonId, selectedWeek, loadAttendance, loadMatches]);

  /* ------------------ SYNC DATE ------------------ */
  useEffect(() => {
    if (!selectedWeek?.weekDate) return;
    const [y, m, d] = String(selectedWeek.weekDate).split("-").map(Number);
    if (!y || !m || !d) return;
    const next = new Date(y, m - 1, d);
    if (!isNaN(next.getTime())) {
      setSelectedDate(next);
      if (Platform.OS === "web") {
        setWebDate(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
      }
    }
  }, [selectedWeek]);

  const formattedDate = useMemo(() => formatDateLong(selectedDate), [selectedDate]);
  const bannerText = selectedWeek
    ? `YOU ARE CURRENTLY SCHEDULING FOR ${selectedWeek.label} – ${formattedDate}`
    : "SELECT A WEEK AND DATE TO BEGIN";

  /* ------------------ WEEK ACTIONS ------------------ */
  const addWeek = async () => {
    const n = Number(newWeekText.trim());
    if (!Number.isFinite(n) || n <= 0) {
      Alert.alert("Invalid week", "Enter a valid week number (example: 6).");
      return;
    }

    const insertRes = await supabase
      .from("schedule_weeks")
      .upsert({ season_id: seasonId, week: n, week_date: null }, { onConflict: "season_id,week" });

    if (insertRes.error) {
      Alert.alert("Error", insertRes.error.message);
      return;
    }

    await loadWeeks(seasonId);
    const w = { label: `Week ${n}`, weekNumber: n, weekDate: null as any };
    setSelectedWeek(w);
    saveWeekNumber(n);

    setAddWeekOpen(false);
    setNewWeekText("");
    setWeekPanelOpen(false);
  };

  const requestDeleteWeek = (w: WeekItem) => {
    setPendingDeleteWeek(w);
    setConfirmText("");
    setConfirmOpen(true);
  };

  const confirmDeleteWeek = async () => {
    if (!pendingDeleteWeek) return;

    if (confirmText.trim() !== "DELETE") {
      Alert.alert("Not deleted", 'You must type "DELETE" exactly.');
      return;
    }

    const weekNum = pendingDeleteWeek.weekNumber;

    const delMatches = await supabase.from("matches").delete().eq("season_id", seasonId).eq("week", weekNum);
    if (delMatches.error) {
      Alert.alert("Error", delMatches.error.message);
      return;
    }

    const delAtt = await supabase.from("attendance").delete().eq("season_id", seasonId).eq("week", weekNum);
    if (delAtt.error) {
      Alert.alert("Error", delAtt.error.message);
      return;
    }

    const delWeek = await supabase.from("schedule_weeks").delete().eq("season_id", seasonId).eq("week", weekNum);
    if (delWeek.error) {
      Alert.alert("Error", delWeek.error.message);
      return;
    }

    await loadWeeks(seasonId);
    await loadSeasonMatchesForBadges(seasonId);

    if (selectedWeek?.weekNumber === weekNum) {
      setSelectedWeek(null);
      setMatches([]);
    }

    setConfirmOpen(false);
    setPendingDeleteWeek(null);
    setConfirmText("");
    setWeekPanelOpen(false);
  };

  /* ------------------ DATE SAVE ------------------ */
  const onNativeDateChange = async (_event: any, date?: Date) => {
    if (!date) return;
    setSelectedDate(date);
    if (!selectedWeek) return;

    const iso = ymdFromDate(date);

    await supabase
      .from("schedule_weeks")
      .upsert({ season_id: seasonId, week: selectedWeek.weekNumber, week_date: iso }, { onConflict: "season_id,week" });

    await loadWeeks(seasonId);
  };

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const [y, m, d] = webDate.split("-").map(Number);
    if (!y || !m || !d) return;
    const next = new Date(y, m - 1, d);
    if (!isNaN(next.getTime())) setSelectedDate(next);
  }, [webDate]);

  const saveWebDate = useCallback(async () => {
    if (!selectedWeek) return;
    const [y, m, d] = webDate.split("-").map(Number);
    if (!y || !m || !d) return;

    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

    await supabase
      .from("schedule_weeks")
      .upsert({ season_id: seasonId, week: selectedWeek.weekNumber, week_date: iso }, { onConflict: "season_id,week" });

    await loadWeeks(seasonId);
    setDatePanelOpen(false);
  }, [seasonId, selectedWeek, webDate, loadWeeks]);

  /* ------------------ ATTENDANCE NAV ------------------ */
  const openAttendance = () => {
    if (!selectedWeek) {
      Alert.alert("Pick a week first", "Choose a Week before setting attendance.");
      return;
    }
    router.push({
      pathname: "/schedule-builder-attendance" as any,
      params: { seasonId, week: String(selectedWeek.weekNumber) },
    } as any);
  };

  /* ------------------ TEAM FILTERING ------------------ */
  const teamById = useMemo(() => {
    const m = new Map<string, TeamRow>();
    for (const t of teams) m.set(t.id, t);
    return m;
  }, [teams]);

  const isTeamActive = useCallback(
    (tid: string | null | undefined) => {
      if (!tid) return false;
      const t = teamById.get(String(tid));
      // default = active if missing (so you don’t break anything if old rows exist)
      return t?.is_active === false ? false : true;
    },
    [teamById]
  );

  const teamsInSelectedDivision = useMemo(() => {
    if (!selectedDivisionId) return [];

    const list = teams.filter((t) => String(t.division) === String(selectedDivisionId));

    // ✅ Default: hide inactive teams from scheduling
    const activeOnly = list.filter((t) => (t.is_active === false ? false : true));

    // ✅ BUT: if editing an existing match that already used an inactive team,
    // include it so Edit mode doesn’t break (grey + disabled)
    const includeIds = new Set<string>();
    if (editingMatchId && teamAId) includeIds.add(teamAId);
    if (editingMatchId && teamBId) includeIds.add(teamBId);

    const extras: TeamRow[] = [];
    for (const id of includeIds) {
      const found = list.find((t) => String(t.id) === String(id));
      if (found && found.is_active === false && !activeOnly.some((x) => x.id === found.id)) {
        extras.push(found);
      }
    }

    return [...extras, ...activeOnly];
  }, [teams, selectedDivisionId, editingMatchId, teamAId, teamBId]);

  const teamNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of teams) m.set(t.id, t.team_name);
    return m;
  }, [teams]);

  const divisionNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of divisions) m.set(d.id, d.name);
    return m;
  }, [divisions]);

  // ✅ Attendance helpers (ONLY logic needed for your requested behavior)
  const isTeamFullyIn = useCallback(
    (teamId: string) => {
      const att = attendanceByTeamId[teamId];
      if (!att) return true;

      const p1 = att.p1 ?? true;
      const p2 = att.p2 ?? true;

      // ✅ Schedulable unless BOTH players are OUT
      return !(!p1 && !p2);
    },
    [attendanceByTeamId]
  );

  const isTeamSubNeeded = useCallback(
    (teamId: string) => {
      const att = attendanceByTeamId[teamId];
      if (!att) return false;

      const p1 = att.p1 ?? true;
      const p2 = att.p2 ?? true;

      // ✅ Exactly one OUT => sub needed
      return (p1 && !p2) || (!p1 && p2);
    },
    [attendanceByTeamId]
  );

  /* ------------------ ✅ MATCH CONSTRAINTS (TIME = MINUTES, NOT STRING) ------------------ */
  const selectedTimeMinutes = useMemo(() => parseTimeToMinutes(selectedTime) ?? -1, [selectedTime]);

  const bookedCourtsForTime = useMemo(() => {
    const s = new Set<number>();
    for (const m of matches) {
      const mm = parseTimeToMinutes(m.match_time);
      if (mm != null && mm === selectedTimeMinutes) {
        s.add(Number(m.court));
      }
    }
    return s;
  }, [matches, selectedTimeMinutes]);

  const scheduledTeamsForTime = useMemo(() => {
    const s = new Set<string>();
    for (const m of matches) {
      const mm = parseTimeToMinutes(m.match_time);
      if (mm != null && mm === selectedTimeMinutes) {
        s.add(m.team_a_id);
        s.add(m.team_b_id);
      }
    }
    return s;
  }, [matches, selectedTimeMinutes]);

  /* ------------------ ✅ BADGE COUNTS ACROSS ALL WEEKS ------------------ */
  const priorCountByMatchId = useMemo(() => {
    const list = [...seasonMatches].sort((a, b) => {
      const wa = Number((a as any).week) || 0;
      const wb = Number((b as any).week) || 0;
      if (wa !== wb) return wa - wb;

      const ma = parseTimeToMinutes((a as any).match_time) ?? 0;
      const mb = parseTimeToMinutes((b as any).match_time) ?? 0;
      if (ma !== mb) return ma - mb;

      const ca = Number((a as any).court) || 0;
      const cb = Number((b as any).court) || 0;
      if (ca !== cb) return ca - cb;

      const da = (a as any).created_at ? new Date((a as any).created_at).getTime() : 0;
      const db = (b as any).created_at ? new Date((b as any).created_at).getTime() : 0;
      return da - db;
    });

    const running = new Map<string, number>();
    const out = new Map<string, number>();

    for (const m of list as any[]) {
      const a = String(m.team_a_id);
      const b = String(m.team_b_id);
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;

      const prior = running.get(key) ?? 0;
      out.set(String(m.id), prior);
      running.set(key, prior + 1);
    }

    return out;
  }, [seasonMatches]);

  const matchesForSelectedDivision = useMemo(() => {
    if (!selectedDivisionId) return [];
    return matches.filter((m) => String(m.division_id) === String(selectedDivisionId));
  }, [matches, selectedDivisionId]);

  /* ------------------ SAVE / UPDATE MATCH ------------------ */
  const onSaveMatch = async () => {
    setDebugMsg("");

    if (!selectedWeek || !selectedDivisionId) {
      Alert.alert("Missing info", "Select a Week and Division first.");
      return;
    }
    if (!teamAId || !teamBId) {
      Alert.alert("Pick teams", "Select Team A and Team B.");
      return;
    }
    if (teamAId === teamBId) {
      Alert.alert("Not allowed", "Team B cannot be the same as Team A.");
      return;
    }

    // ✅ NEW: do not allow scheduling inactive teams
    const aActive = isTeamActive(teamAId);
    const bActive = isTeamActive(teamBId);

    const allowingBecauseOldMatch =
      !!editingMatchId &&
      teamAId === editingOriginalTeamAId &&
      teamBId === editingOriginalTeamBId;

    if ((!aActive || !bActive) && !allowingBecauseOldMatch) {
      Alert.alert("Inactive Team", "One of these teams is INACTIVE. Inactive teams cannot be scheduled.");
      return;
    }

    // ✅ UPDATED: only block scheduling if BOTH players are OUT for a team
    if (!isTeamFullyIn(teamAId) || !isTeamFullyIn(teamBId)) {
      Alert.alert("Attendance", "One of these teams has BOTH players marked OUT for this week.");
      return;
    }

    const teamAlreadyScheduled =
      (scheduledTeamsForTime.has(teamAId) || scheduledTeamsForTime.has(teamBId)) && !editingMatchId;

    if (teamAlreadyScheduled) {
      Alert.alert("Not allowed", "One of these teams is already scheduled at this time.");
      return;
    }

    // ✅ Court conflict popup FIRST
    const courtBooked = bookedCourtsForTime.has(selectedCourt) && !editingMatchId;
    if (courtBooked) {
      showAlert("Court Conflict", `Court ${selectedCourt} is already booked at ${normalizeTo12Hour(selectedTime)}.`);
      return;
    }

    // ✅ Confirm popup: history across season
    const history = (seasonMatches as any[]).filter((m) => {
      if (editingMatchId && String(m.id) === String(editingMatchId)) return false;

      const a = String(m.team_a_id);
      const b = String(m.team_b_id);
      return (a === teamAId && b === teamBId) || (a === teamBId && b === teamAId);
    });

    const weeksPlayed = Array.from(
      new Set(history.map((m) => Number(m.week)).filter((n) => Number.isFinite(n) && n > 0))
    ).sort((x, y) => x - y);

    const weeksText =
      weeksPlayed.length === 0
        ? "none"
        : weeksPlayed.length === 1
        ? `week ${weeksPlayed[0]}`
        : `weeks ${weeksPlayed.join(", ")}`;

    const alreadyThisWeek = history.some((m) => Number(m.week) === Number(selectedWeek.weekNumber));

    const ok = await confirmBeforeSave(
      "Confirm Match",
      `These 2 teams played each other ${history.length} time(s) this season.\nPlayed in: ${weeksText}.\n\n${
        alreadyThisWeek
          ? `These 2 teams are already playing each other in Week ${selectedWeek.weekNumber}. Do you still want to schedule another match this week?`
          : "Do you want to schedule this match?"
      }`
    );
    if (!ok) return;

    // ✅ ALWAYS save match_time in 12-hour format
    const payload = {
      season_id: seasonId,
      week: selectedWeek.weekNumber,
      division_id: selectedDivisionId,
      court: selectedCourt,
      match_time: normalizeTo12Hour(selectedTime),
      team_a_id: teamAId,
      team_b_id: teamBId,
    };

    if (editingMatchId) {
      const upd = await supabase.from("matches").update(payload).eq("id", editingMatchId);
      if (upd.error) {
        Alert.alert("Error", upd.error.message);
        return;
      }
      setEditingMatchId(null);
      setEditingOriginalTeamAId(null);
      setEditingOriginalTeamBId(null);
    } else {
      const ins = await supabase.from("matches").insert(payload);
      if (ins.error) {
        setDebugMsg("SAVE FAILED: " + ins.error.message);
        return;
      }
    }

    await loadMatches(seasonId, selectedWeek.weekNumber);
    await loadSeasonMatchesForBadges(seasonId);

    setTeamAId(null);
    setTeamBId(null);
    setTeamBTooltipData(null);
  };

  const deleteMatch = async (id: string) => {
    const del = await supabase.from("matches").delete().eq("id", id);
    if (del.error) {
      Alert.alert("Error", del.error.message);
      return;
    }
    if (selectedWeek) await loadMatches(seasonId, selectedWeek.weekNumber);
    await loadSeasonMatchesForBadges(seasonId);
  };

  const onEditMatch = (m: MatchRow) => {
    setEditingMatchId(m.id);
    setEditingOriginalTeamAId(m.team_a_id);
    setEditingOriginalTeamBId(m.team_b_id);

    setSelectedDivisionId(m.division_id);
    setSelectedTime(normalizeTo12Hour(m.match_time));
    setSelectedCourt(Number(m.court));
    setTeamAId(m.team_a_id);
    setTeamBId(m.team_b_id);

    // ✅ keep tooltip consistent in edit mode
    setTeamBTooltipData(null);
  };

  /* ------------------ CLEAR WEEK MATCHES ------------------ */
  const requestClearWeek = () => {
    if (!selectedWeek) return;
    setClearWeekText("");
    setClearWeekConfirmOpen(true);
  };

  const confirmClearWeek = async () => {
    if (!selectedWeek) return;
    if (clearWeekText.trim() !== "DELETE") {
      Alert.alert("Not cleared", 'You must type "DELETE" exactly.');
      return;
    }

    const del = await supabase.from("matches").delete().eq("season_id", seasonId).eq("week", selectedWeek.weekNumber);
    if (del.error) {
      Alert.alert("Error", del.error.message);
      return;
    }

    await loadMatches(seasonId, selectedWeek.weekNumber);
    await loadSeasonMatchesForBadges(seasonId);

    setClearWeekConfirmOpen(false);
    setClearWeekText("");
  };

  /* ------------------ ✅ TEAM DISABLING ------------------ */
  const isTeamDisabledForPick = useCallback(
    (tid: string, otherPickedId: string | null) => {
      // ✅ NEW: inactive teams not pickable (except if already part of the match we are editing)
      const allowedBecauseEditing = !!editingMatchId && (tid === teamAId || tid === teamBId);
      if (!isTeamActive(tid) && !allowedBecauseEditing) return true;

      if (!isTeamFullyIn(tid)) return true;
      if (otherPickedId && tid === otherPickedId) return true;

      const alreadyScheduledNow = scheduledTeamsForTime.has(tid);
      const allowedBecauseEditingScheduled = !!editingMatchId && (tid === teamAId || tid === teamBId);
      if (alreadyScheduledNow && !allowedBecauseEditingScheduled) return true;

      return false;
    },
    [isTeamFullyIn, scheduledTeamsForTime, editingMatchId, teamAId, teamBId, isTeamActive]
  );

  const onPickTeamA = (tid: string) => {
    if (tid === teamBId) {
      Alert.alert("Not allowed", "Team A cannot be the same as Team B.");
      return;
    }
    setTeamAId(tid);

    // ✅ If Team B already picked, recompute tooltip immediately for readability
    if (teamBId) {
      const history = seasonMatches.filter((m) => {
        const a = m.team_a_id;
        const b = m.team_b_id;
        return (a === tid && b === teamBId) || (a === teamBId && b === tid);
      });

      const weeksPlayed = Array.from(
        new Set(history.map((m) => Number(m.week)).filter((n) => Number.isFinite(n) && n > 0))
      ).sort((x, y) => x - y);

      setTeamBTooltipData({
        timesPlayed: history.length,
        lastWeek: weeksPlayed.length ? weeksPlayed[weeksPlayed.length - 1] : undefined,
      });
    } else {
      setTeamBTooltipData(null);
    }
  };

  const onPickTeamB = (tid: string) => {
    if (tid === teamAId) {
      Alert.alert("Not allowed", "Team B cannot be the same as Team A.");
      return;
    }

    setTeamBId(tid);

    // ✅ Tooltip needs Team A to compute
    if (!teamAId) {
      setTeamBTooltipData(null);
      return;
    }

    const history = seasonMatches.filter((m) => {
      const a = m.team_a_id;
      const b = m.team_b_id;
      return (a === teamAId && b === tid) || (a === tid && b === teamAId);
    });

    const weeksPlayed = Array.from(
      new Set(history.map((m) => Number(m.week)).filter((n) => Number.isFinite(n) && n > 0))
    ).sort((x, y) => x - y);

    setTeamBTooltipData({
      timesPlayed: history.length,
      lastWeek: weeksPlayed.length ? weeksPlayed[weeksPlayed.length - 1] : undefined,
    });
  };

  /* ------------------ SAVED MATCHES DISPLAY ------------------ */
  const weekDateShort = useMemo(() => selectedWeek?.weekDate ?? "", [selectedWeek]);

  const savedMatchesDisplay = useMemo<MatchDisplay[]>(() => {
    if (!selectedWeek) return [];
    const dayName = weekDateShort ? weekdayName(selectedDate) : "";

    return matchesForSelectedDivision
      .slice()
      .sort((a, b) => {
        const ma = parseTimeToMinutes(a.match_time) ?? 0;
        const mb = parseTimeToMinutes(b.match_time) ?? 0;
        if (ma !== mb) return ma - mb;
        return Number(a.court) - Number(b.court);
      })
      .map((m) => {
        const divisionName = divisionNameById.get(m.division_id) ?? "Division";
        const aName = teamNameById.get(m.team_a_id) ?? "Team A";
        const bName = teamNameById.get(m.team_b_id) ?? "Team B";

        const header = `Week ${m.week} · ${dayName || "No date"} · ${normalizeTo12Hour(m.match_time)} · Court ${m.court}`;
        const sub = `${divisionName}: ${aName} vs ${bName}`;

        const badge = priorCountByMatchId.get(String(m.id)) ?? 0;

        return {
          id: m.id,
          header,
          sub,
          playedCount: badge,
          division_id: m.division_id,
          match_time: m.match_time,
          court: Number(m.court),
          team_a_id: m.team_a_id,
          team_b_id: m.team_b_id,
        };
      });
  }, [
    matchesForSelectedDivision,
    selectedWeek,
    divisionNameById,
    teamNameById,
    weekDateShort,
    selectedDate,
    priorCountByMatchId,
  ]);

  const nextWeekNumber = useMemo(() => {
    const max = Math.max(0, ...(weeks.map((w) => w.weekNumber) ?? []));
    return max + 1;
  }, [weeks]);

  const formattedSelectedTime = useMemo(() => normalizeTo12Hour(selectedTime), [selectedTime]);

  // ✅ Always-visible tooltip text (NOT floating, NOT behind chips)
  const tooltipText = useMemo(() => {
    if (!teamAId || !teamBId) return "Pick Team A and Team B to see how many times they played this season.";
    if (!teamBTooltipData) return "Pick Team A and Team B to see how many times they played this season.";

    return `Played ${teamBTooltipData.timesPlayed} time${teamBTooltipData.timesPlayed !== 1 ? "s" : ""}${
      teamBTooltipData.lastWeek !== undefined ? ` (last W${teamBTooltipData.lastWeek})` : " (not played yet)"
    }`;
  }, [teamAId, teamBId, teamBTooltipData]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.wrap}>
        <Text style={styles.header}>Schedule Builder</Text>

        <Pressable
          style={{
            backgroundColor: "#000",
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: 12,
            alignSelf: "flex-start",
            marginBottom: 12,
          }}
          onPress={() => {
            router.back();
            // adjust this path if your admin page route is different
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "900" }}>Return to Admin</Text>
        </Pressable>

        <Text style={{ fontWeight: "900", marginBottom: 8 }}>Season: {seasonLabel || seasonId}</Text>

        <View style={styles.banner}>
          <Text style={styles.bannerText}>{bannerText}</Text>
        </View>

        {/* WEEK + DATE (WEB: side-by-side, APP: stacked) */}
        {Platform.OS === "web" ? (
          <View style={styles.webTwoColRow}>
            {/* WEEK */}
            <View style={styles.webCol}>
              <Text style={styles.label}>Week</Text>
              <Pressable
                style={styles.bigField}
                onPress={() => {
                  setWeekPanelOpen((v) => !v);
                  setDatePanelOpen(false);
                  setTimePanelOpen(false);
                }}
              >
                <Text style={styles.bigFieldText}>
                  {selectedWeek?.weekDate
                    ? `${selectedWeek.label} · ${selectedWeek.weekDate}`
                    : selectedWeek?.label ?? "Choose Week"}
                </Text>
              </Pressable>
            </View>

            {/* DATE */}
            <View style={styles.webCol}>
              <Text style={styles.label}>Date</Text>
              <Pressable
                style={styles.bigField}
                onPress={() => {
                  setDatePanelOpen((v) => !v);
                  setWeekPanelOpen(false);
                  setTimePanelOpen(false);
                }}
              >
                <Text style={styles.bigFieldText}>📅 Choose Date</Text>
                <Text style={styles.smallUnderText}>{formattedDate}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            {/* WEEK */}
            <Text style={styles.label}>Week</Text>
            <Pressable
              style={styles.bigField}
              onPress={() => {
                setWeekPanelOpen((v) => !v);
                setDatePanelOpen(false);
                setTimePanelOpen(false);
              }}
            >
              <Text style={styles.bigFieldText}>
                {selectedWeek?.weekDate
                  ? `${selectedWeek.label} · ${selectedWeek.weekDate}`
                  : selectedWeek?.label ?? "Choose Week"}
              </Text>
            </Pressable>

            {/* DATE */}
            <Text style={styles.label}>Date</Text>
            <Pressable
              style={styles.bigField}
              onPress={() => {
                setDatePanelOpen((v) => !v);
                setWeekPanelOpen(false);
                setTimePanelOpen(false);
              }}
            >
              <Text style={styles.bigFieldText}>📅 Choose Date</Text>
              <Text style={styles.smallUnderText}>{formattedDate}</Text>
            </Pressable>
          </>
        )}

        {weekPanelOpen && (
          <View style={styles.panel}>
            {weeks.length === 0 ? (
              <Text style={styles.panelHint}>No weeks yet. Add one below.</Text>
            ) : (
              weeks.map((w) => (
                <View key={w.weekNumber} style={styles.row}>
                  <Pressable
                    style={{ flex: 1, paddingVertical: 10 }}
                    onPress={() => {
                      setSelectedWeek(w);
                      saveWeekNumber(w.weekNumber);
                      setWeekPanelOpen(false);
                    }}
                  >
                    <Text style={styles.rowText}>{w.weekDate ? `${w.label} · ${w.weekDate}` : w.label}</Text>
                  </Pressable>

                  <Pressable style={styles.deleteBtn} onPress={() => requestDeleteWeek(w)}>
                    <Text style={styles.deleteBtnText}>Delete</Text>
                  </Pressable>
                </View>
              ))
            )}

            <Pressable
              style={styles.addBtn}
              onPress={() => {
                setNewWeekText(String(nextWeekNumber));
                setAddWeekOpen(true);
              }}
            >
              <Text style={styles.addBtnText}>+ Add Week {nextWeekNumber}</Text>
            </Pressable>

            <Pressable style={styles.closeBtn} onPress={() => setWeekPanelOpen(false)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </Pressable>
          </View>
        )}

        {datePanelOpen && (
          <View style={styles.panel}>
            {Platform.OS === "web" ? (
              <>
                <Text style={styles.panelHint}>Pick a date here:</Text>
                {/* @ts-ignore */}
                <input
                  type="date"
                  value={webDate}
                  onChange={(e) => setWebDate(e.target.value)}
                  style={{
                    width: 260,
                    fontSize: 18,
                    padding: 10,
                    borderRadius: 10,
                    border: "2px solid #111",
                    fontWeight: 700,
                  }}
                />
                <Pressable style={styles.doneBtn} onPress={saveWebDate}>
                  <Text style={styles.doneBtnText}>Save Date</Text>
                </Pressable>
              </>
            ) : (
              <>
                <DateTimePicker
                  value={selectedDate}
                  mode="date"
                  display={Platform.OS === "ios" ? "inline" : "default"}
                  onChange={onNativeDateChange}
                />
                <Pressable style={styles.doneBtn} onPress={() => setDatePanelOpen(false)}>
                  <Text style={styles.doneBtnText}>Done</Text>
                </Pressable>
              </>
            )}

            <Pressable style={styles.closeBtn} onPress={() => setDatePanelOpen(false)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </Pressable>
          </View>
        )}

        {/* Attendance */}
        <View style={styles.sectionDivider} />
        <Text style={styles.sectionTitle}>Attendance</Text>
        <Text style={styles.sectionSub}>Mark players IN/OUT for the selected week.</Text>

        <Pressable style={styles.primaryBtn} onPress={openAttendance}>
          <Text style={styles.primaryBtnText}>Open Attendance</Text>
        </Pressable>

        {/* Schedule Match */}
        <View style={styles.sectionDivider} />
        <Text style={styles.sectionTitle}>Schedule Match</Text>

        {/* DIVISION + TIME (WEB: side-by-side, APP: stacked) */}
        {Platform.OS === "web" ? (
          <View style={styles.webTwoColRow}>
            {/* Division */}
            <View style={styles.webCol}>
              <Text style={styles.label}>Division</Text>
              <View style={styles.divTabsRow}>
                {divisions.map((d) => {
                  const selected = d.id === selectedDivisionId;
                  return (
                    <Pressable
                      key={d.id}
                      style={[styles.divTab, selected && styles.divTabSelected]}
                      onPress={() => {
                        setSelectedDivisionId(d.id);
                        setTeamAId(null);
                        setTeamBId(null);
                        setTeamBTooltipData(null);
                      }}
                    >
                      <Text style={[styles.divTabText, selected && styles.divTabTextSelected]}>{d.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Time */}
            <View style={styles.webCol}>
              <Text style={styles.label}>Time</Text>
              <Pressable
                style={styles.bigField}
                onPress={() => {
                  setTimePanelOpen((v) => !v);
                  setWeekPanelOpen(false);
                  setDatePanelOpen(false);
                }}
              >
                <Text style={styles.bigFieldText}>{formattedSelectedTime}</Text>
                <Text style={styles.smallUnderText}>5:00 PM – 10:00 PM (15 min)</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            {/* Time dropdown */}
            <Text style={styles.label}>Time</Text>
            <Pressable
              style={styles.bigField}
              onPress={() => {
                setTimePanelOpen((v) => !v);
                setWeekPanelOpen(false);
                setDatePanelOpen(false);
              }}
            >
              <Text style={styles.bigFieldText}>{formattedSelectedTime}</Text>
              <Text style={styles.smallUnderText}>5:00 PM – 10:00 PM (15 min)</Text>
            </Pressable>

            {/* Division tabs */}
            <Text style={styles.label}>Division</Text>
            <View style={styles.divTabsRow}>
              {divisions.map((d) => {
                const selected = d.id === selectedDivisionId;
                return (
                  <Pressable
                    key={d.id}
                    style={[styles.divTab, selected && styles.divTabSelected]}
                    onPress={() => {
                      setSelectedDivisionId(d.id);
                      setTeamAId(null);
                      setTeamBId(null);
                      setTeamBTooltipData(null);
                    }}
                  >
                    <Text style={[styles.divTabText, selected && styles.divTabTextSelected]}>{d.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {timePanelOpen && (
          <View style={styles.panel}>
            {TIMES.map((t) => (
              <Pressable
                key={t}
                style={[styles.timeItem, t === selectedTime && styles.timeItemSelected]}
                onPress={() => {
                  setSelectedTime(t);
                  setTimePanelOpen(false);
                  setTeamAId(null);
                  setTeamBId(null);
                  setTeamBTooltipData(null);
                }}
              >
                <Text style={[styles.timeItemText, t === selectedTime && styles.timeItemTextSelected]}>{t}</Text>
              </Pressable>
            ))}
            <Pressable style={styles.closeBtn} onPress={() => setTimePanelOpen(false)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </Pressable>
          </View>
        )}

        {/* Court bubbles (UNCHANGED) */}
        <Text style={styles.label}>Court</Text>
        <Text style={styles.helperText}>
          Grey courts are already booked at {formattedSelectedTime}. Tap a grey court to see the conflict popup.
        </Text>

        <View style={styles.courtRow}>
          {COURTS.map((c) => {
            const selected = selectedCourt === c;
            const booked = bookedCourtsForTime.has(c);
            const conflict = booked && !editingMatchId;

            return (
              <Pressable
                key={c}
                style={[
                  styles.courtBubble,
                  booked && styles.courtBookedGrey,
                  selected && styles.courtSelected,
                  conflict && styles.courtDisabled,
                ]}
                onPress={() => {
                  if (conflict) {
                    showAlert(
                      "Court Conflict",
                      `Court ${c} is already booked at ${formattedSelectedTime}. Choose a different court.`
                    );
                    return;
                  }
                  setSelectedCourt(c);
                }}
              >
                <Text style={[styles.courtText, selected && styles.courtTextSelected]}>{c}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Team A */}
        <Text style={styles.label}>Team A</Text>
        <Text style={styles.helperText}>
          Grey ✖ = not fully IN (attendance). Yellow = already scheduled at this time. INACTIVE teams are grey and
          unclickable.
        </Text>

        <View style={styles.teamWrap}>
          {teamsInSelectedDivision.map((t) => {
            const selected = teamAId === t.id;
            const scheduled =
              scheduledTeamsForTime.has(t.id) && !(editingMatchId && (t.id === teamAId || t.id === teamBId));
            const notIn = !isTeamFullyIn(t.id);
            const inactive = t.is_active === false;

            const disabled = isTeamDisabledForPick(t.id, teamBId);

            return (
              <Pressable
                key={`A-${t.id}`}
                disabled={disabled}
                onPress={() => onPickTeamA(t.id)}
                style={[
                  styles.teamChip,
                  selected && styles.teamChipSelected,
                  scheduled && styles.teamChipScheduled,
                  notIn && styles.teamChipNotIn,
                  inactive && styles.teamChipInactive,
                  disabled && !selected && styles.teamChipDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.teamChipText,
                    selected && styles.teamChipTextSelected,
                    scheduled && styles.teamChipTextDark,
                    notIn && styles.teamChipTextStrike,
                    inactive && styles.teamChipTextInactive,
                  ]}
                >
                  {t.team_name}
                </Text>

                {scheduled && <Text style={styles.teamChipSub}>Scheduled</Text>}
                {isTeamSubNeeded(t.id) && (
                  <Text style={[styles.teamChipSub, styles.teamChipSubSubNeeded]}>SUB NEEDED</Text>
                )}

                {notIn && <Text style={styles.teamChipSub}>OUT</Text>}
                {inactive && <Text style={styles.teamChipSub}>INACTIVE</Text>}
              </Pressable>
            );
          })}
        </View>

        {/* Team B */}
        <Text style={styles.label}>Team B</Text>
        <Text style={styles.helperText}>Team B cannot be the same as Team A.</Text>

        {/* ✅ FIX: TOOLTIP IS ALWAYS IN THIS SAME READABLE SPOT (NOT FLOATING / NOT HIDDEN) */}
        <View style={styles.tooltipBar}>
          <Text style={styles.tooltipBarTitle}>Matchup History</Text>
          <Text style={styles.tooltipBarText}>{tooltipText}</Text>
        </View>

        <View style={styles.teamWrap}>
          {teamsInSelectedDivision.map((t) => {
            const selected = teamBId === t.id;
            const scheduled =
              scheduledTeamsForTime.has(t.id) && !(editingMatchId && (t.id === teamAId || t.id === teamBId));
            const notIn = !isTeamFullyIn(t.id);
            const inactive = t.is_active === false;

            const disabled = isTeamDisabledForPick(t.id, teamAId);

            return (
              <Pressable
                key={`B-${t.id}`}
                disabled={disabled}
                onPress={() => onPickTeamB(t.id)}
                style={[
                  styles.teamChip,
                  selected && styles.teamChipSelected,
                  scheduled && styles.teamChipScheduled,
                  notIn && styles.teamChipNotIn,
                  inactive && styles.teamChipInactive,
                  disabled && !selected && styles.teamChipDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.teamChipText,
                    selected && styles.teamChipTextSelected,
                    scheduled && styles.teamChipTextDark,
                    notIn && styles.teamChipTextStrike,
                    inactive && styles.teamChipTextInactive,
                  ]}
                >
                  {t.team_name}
                </Text>

                {scheduled && <Text style={styles.teamChipSub}>Scheduled</Text>}
                {isTeamSubNeeded(t.id) && (
                  <Text style={[styles.teamChipSub, styles.teamChipSubSubNeeded]}>SUB NEEDED</Text>
                )}

                {notIn && <Text style={styles.teamChipSub}>OUT</Text>}
                {inactive && <Text style={styles.teamChipSub}>INACTIVE</Text>}
              </Pressable>
            );
          })}
        </View>

        {!!debugMsg && (
          <Text style={{ marginTop: 8, marginBottom: 6, fontWeight: "900", color: "#cc0000" }}>{debugMsg}</Text>
        )}

        <Pressable style={styles.primaryBtn} onPress={onSaveMatch}>
          <Text style={styles.primaryBtnText}>{editingMatchId ? "Update Match" : "Save Match"}</Text>
        </Pressable>

        <Pressable style={styles.clearWeekBtn} onPress={requestClearWeek}>
          <Text style={styles.clearWeekBtnText}>Clear THIS Week Matches</Text>
        </Pressable>

        {/* Saved Matches */}
        <View style={styles.sectionDivider} />
        <Text style={styles.sectionTitle}>Saved Matches</Text>

        {savedMatchesDisplay.length === 0 ? (
          <Text style={styles.sectionSub}>No matches saved for this division this week yet.</Text>
        ) : (
          <View style={styles.savedMatchesGrid}>
            {savedMatchesDisplay.map((m) => (
              <View key={m.id} style={styles.savedMatchCard}>
                <View style={styles.playedBadge}>
                  <Text style={styles.playedBadgeText}>{m.playedCount}x</Text>
                </View>

                <Text style={styles.matchHeaderText}>{m.header}</Text>
                <Text style={styles.matchSubText}>{m.sub}</Text>

                <Pressable
                  style={styles.editMatchBtn}
                  onPress={() => {
                    const raw = matches.find((x) => x.id === m.id);
                    if (raw) onEditMatch(raw);
                  }}
                >
                  <Text style={styles.editMatchBtnText}>Edit</Text>
                </Pressable>

                <Pressable style={styles.deleteMatchBtn} onPress={() => deleteMatch(m.id)}>
                  <Text style={styles.deleteMatchBtnText}>Delete</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* ADD WEEK MODAL */}
        <Modal visible={addWeekOpen} transparent animationType="fade">
          <View style={styles.backdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Add New Week</Text>
              <Text style={styles.modalHint}>Week number</Text>

              <TextInput
                value={newWeekText}
                onChangeText={setNewWeekText}
                placeholder=""
                keyboardType="number-pad"
                style={styles.textInput}
              />

              <Pressable style={styles.primaryBtn} onPress={addWeek}>
                <Text style={styles.primaryBtnText}>Save Week</Text>
              </Pressable>

              <Pressable
                style={styles.secondaryBtn}
                onPress={() => {
                  setAddWeekOpen(false);
                  setNewWeekText("");
                }}
              >
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* CONFIRM DELETE WEEK MODAL */}
        <Modal visible={confirmOpen} transparent animationType="fade">
          <View style={styles.backdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Delete Week</Text>
              <Text style={styles.modalHint}>
                Type <Text style={{ fontWeight: "900" }}>DELETE</Text> to confirm deleting{" "}
                {pendingDeleteWeek?.label ?? ""}.
              </Text>

              <TextInput
                value={confirmText}
                onChangeText={setConfirmText}
                placeholder="DELETE"
                autoCapitalize="characters"
                style={styles.textInput}
              />

              <Pressable style={styles.dangerBtn} onPress={confirmDeleteWeek}>
                <Text style={styles.dangerBtnText}>Delete</Text>
              </Pressable>

              <Pressable
                style={styles.secondaryBtn}
                onPress={() => {
                  setConfirmOpen(false);
                  setPendingDeleteWeek(null);
                  setConfirmText("");
                }}
              >
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* CONFIRM CLEAR WEEK MATCHES MODAL */}
        <Modal visible={clearWeekConfirmOpen} transparent animationType="fade">
          <View style={styles.backdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Clear Week Matches</Text>
              <Text style={styles.modalHint}>
                Type <Text style={{ fontWeight: "900" }}>DELETE</Text> to clear ALL matches for{" "}
                {selectedWeek?.label ?? "this week"}.
              </Text>

              <TextInput
                value={clearWeekText}
                onChangeText={setClearWeekText}
                placeholder="DELETE"
                autoCapitalize="characters"
                style={styles.textInput}
              />

              <Pressable style={styles.dangerBtn} onPress={confirmClearWeek}>
                <Text style={styles.dangerBtnText}>Clear Week</Text>
              </Pressable>

              <Pressable
                style={styles.secondaryBtn}
                onPress={() => {
                  setClearWeekConfirmOpen(false);
                  setClearWeekText("");
                }}
              >
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ------------------ STYLES ------------------ */
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  wrap: { padding: 16, paddingBottom: 60 },

  header: { fontSize: 26, fontWeight: "900", marginBottom: 12 },

  banner: {
    backgroundColor: "#000",
    borderRadius: 20,
    paddingVertical: 22,
    paddingHorizontal: 16,
    marginBottom: 22,
    borderWidth: 4,
    borderColor: "#ffcc00",
  },
  bannerText: {
    color: "#fff",
    textAlign: "center",
    fontWeight: "900",
    fontSize: 18,
    letterSpacing: 0.4,
  },

  label: { fontSize: 14, fontWeight: "900", marginBottom: 8, marginTop: 8 },

  bigField: {
    borderWidth: 1,
    borderColor: "#111",
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    backgroundColor: "#fff",
  },
  bigFieldText: { fontSize: 18, fontWeight: "900" },
  smallUnderText: { marginTop: 6, fontSize: 14, fontWeight: "800", color: "#333" },

  panel: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
    backgroundColor: "#fafafa",
  },
  panelHint: { fontSize: 13, fontWeight: "700", color: "#555", marginBottom: 10 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#eaeaea",
  },
  rowText: { fontSize: 16, fontWeight: "800" },

  deleteBtn: {
    backgroundColor: "#cc0000",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    marginLeft: 10,
  },
  deleteBtnText: { color: "#fff", fontWeight: "900", fontSize: 12 },

  addBtn: {
    marginTop: 12,
    backgroundColor: "#eee",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  addBtnText: { fontWeight: "900" },

  closeBtn: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ddd",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  closeBtnText: { fontWeight: "900" },

  doneBtn: {
    marginTop: 10,
    backgroundColor: "#000",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  doneBtnText: { color: "#fff", fontWeight: "900" },

  sectionDivider: { height: 1, backgroundColor: "#eee", marginVertical: 18 },
  sectionTitle: { fontSize: 22, fontWeight: "900", marginBottom: 6 },
  sectionSub: { fontSize: 13, fontWeight: "700", color: "#444", marginBottom: 10 },

  primaryBtn: {
    backgroundColor: "#000",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 14,
  },
  primaryBtnText: { color: "#fff", fontWeight: "900" },

  dangerBtn: {
    backgroundColor: "#cc0000",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 10,
  },
  dangerBtnText: { color: "#fff", fontWeight: "900" },

  secondaryBtn: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  secondaryBtnText: { fontWeight: "900" },

  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: "900", marginBottom: 8 },
  modalHint: { fontSize: 13, fontWeight: "700", color: "#444", marginBottom: 10 },

  textInput: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 14,
    padding: 12,
    fontSize: 16,
    fontWeight: "800",
  },

  timeItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ddd",
    backgroundColor: "#fff",
    marginBottom: 8,
  },
  timeItemSelected: {
    backgroundColor: "#000",
    borderColor: "#000",
  },
  timeItemText: { fontWeight: "900", fontSize: 14, color: "#111" },
  timeItemTextSelected: { color: "#fff" },

  helperText: { fontSize: 12, fontWeight: "800", color: "#555", marginBottom: 10 },
  courtRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 14,
  },
  courtBubble: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: "#111",
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  courtText: { fontWeight: "900", color: "#111" },
  courtSelected: {
    backgroundColor: "#000",
    borderColor: "#000",
  },
  courtTextSelected: { color: "#fff" },

  courtBookedGrey: {
    backgroundColor: "#cfcfcf",
    borderColor: "#cfcfcf",
  },
  courtDisabled: { opacity: 0.85 },

  divTabsRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 10 },
  divTab: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: "#fff",
  },
  divTabSelected: { backgroundColor: "#000", borderColor: "#000" },
  divTabText: { fontWeight: "900", color: "#111" },
  divTabTextSelected: { color: "#fff" },

  teamWrap: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 12 },
  teamChip: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "#e9f7ea",
    borderWidth: 1,
    borderColor: "#cfe8d2",
    minWidth: 150,
    alignItems: "center",
  },
  teamChipSelected: {
    backgroundColor: "#000",
    borderColor: "#000",
  },
  teamChipScheduled: {
    backgroundColor: "#ffcc00",
    borderColor: "#ffcc00",
  },
  teamChipNotIn: {
    backgroundColor: "#eee",
    borderColor: "#ddd",
  },

  // ✅ NEW: inactive team styling (grey)
  teamChipInactive: {
    backgroundColor: "#e5e5e5",
    borderColor: "#d4d4d4",
  },

  teamChipDisabled: {
    opacity: 0.75,
  },
  teamChipText: { fontWeight: "900", color: "#111" },
  teamChipTextSelected: { color: "#fff" },
  teamChipTextDark: { color: "#111" },
  teamChipTextStrike: { textDecorationLine: "line-through", color: "#555" },
  teamChipTextInactive: { color: "#555" },
  teamChipSub: { marginTop: 4, fontWeight: "900", fontSize: 11, color: "#111" },
  teamChipSubSubNeeded: {
    marginTop: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "#ffcc00",
    color: "#111",
  },

  // ✅ FIXED TOOLTIP AREA (readable, never hidden behind chips)
  tooltipBar: {
    borderWidth: 2,
    borderColor: "#111",
    borderRadius: 14,
    padding: 12,
    backgroundColor: "#fff",
    marginBottom: 12,
  },
  tooltipBarTitle: {
    fontWeight: "900",
    fontSize: 13,
    marginBottom: 6,
  },
  tooltipBarText: {
    fontWeight: "900",
    fontSize: 14,
    color: "#111",
  },

  clearWeekBtn: {
    marginTop: 10,
    borderWidth: 2,
    borderColor: "#cc0000",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  clearWeekBtnText: { color: "#cc0000", fontWeight: "900" },

  savedMatchesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    marginTop: 6,
  },
  savedMatchCard: {
    width: 290,
    borderWidth: 1,
    borderColor: "#e6e6e6",
    borderRadius: 16,
    padding: 14,
    backgroundColor: "#fff",
    position: "relative",
  },
  matchHeaderText: { fontSize: 14, fontWeight: "900", marginBottom: 6 },
  matchSubText: { fontSize: 13, fontWeight: "800", color: "#333", marginBottom: 12 },

  playedBadge: {
    position: "absolute",
    right: 12,
    top: 12,
    width: 52,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#00b7ff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#00b7ff",
    shadowOpacity: 0.55,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  playedBadgeText: { color: "#fff", fontWeight: "900", fontSize: 18 },

  editMatchBtn: {
    backgroundColor: "#000",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 10,
  },
  editMatchBtnText: { color: "#fff", fontWeight: "900" },

  deleteMatchBtn: {
    backgroundColor: "#cc0000",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  deleteMatchBtnText: { color: "#fff", fontWeight: "900" },

  // ✅ WEB LAYOUT HELPERS (only used when Platform.OS === "web")
  webTwoColRow: {
    flexDirection: "row",
    gap: 14,
    alignItems: "flex-start",
  },
  webCol: {
    flex: 1,
    minWidth: 260,
  },
});
