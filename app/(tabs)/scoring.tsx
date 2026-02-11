import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { useAdminSession } from "../../lib/adminSession";

/**
 * PPL NEXT - SCORING TAB
 * ✅ Season is ONLY from app_settings.current_season_id
 * ✅ Uses schedule_weeks.week_date for the date (from Schedule Builder)
 * ✅ Matches filtered by season_id + selected week
 * ✅ Clamp score to max 11
 * ✅ Save after each game
 * ✅ After all 3 games are entered, saving LOCKS the match (non-admin cannot edit)
 * ✅ Lock rules:
 *    - Admin can always edit
 *    - Non-admin cannot edit if week locked OR match locked
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

  // ✅ NEW: Saved-by metadata (added via SQL)
  locked_by_user_id?: string | null;
  locked_by_display?: string | null;
};

type WeekLockRow = {
  season_id: string;
  week: number;
  locked_at: string | null;
  locked_by: string | null;
};

type UserSeasonProfileRow = {
  player_name: string | null;
};

const COLORS = {
  bg: "#FFFFFF",
  text: "#111827",
  subtext: "#374151",
  border: "#111827",
  rowBorder: "#E5E7EB",
  overlay: "rgba(0,0,0,0.55)",
  blue: "#2563EB",
  danger: "#b00020",
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
  return [...weeks].sort((a, b) => a.week - b.week)[weeks.length - 1].week;
}

function sanitizeAndClampScore(input: string) {
  const digits = (input ?? "").replace(/[^\d]/g, "");
  if (digits === "") return "";
  const two = digits.length <= 2 ? digits : digits.slice(0, 2);
  const n = parseInt(two, 10);
  if (!Number.isFinite(n)) return "";
  if (n > 11) return "11";
  if (n < 0) return "0";
  return String(n);
}

function toN(s: string) {
  const n = parseInt(s || "0", 10);
  return Number.isFinite(n) ? n : 0;
}

function totalOf(fields: ScoreFields) {
  return toN(fields.g1) + toN(fields.g2) + toN(fields.g3);
}

function isEntered(v: string) {
  return (v ?? "").trim() !== "";
}

function gameEnteredPair(a: string, b: string) {
  return isEntered(a) && isEntered(b);
}

function asScoreFields(v: any): ScoreFields {
  const g1 = typeof v?.g1 === "string" ? v.g1 : "";
  const g2 = typeof v?.g2 === "string" ? v.g2 : "";
  const g3 = typeof v?.g3 === "string" ? v.g3 : "";
  return { g1, g2, g3 };
}

type ScoreInputProps = {
  initialValue: string;
  onChange: (next: string) => void;
  editable: boolean;
};

const ScoreInput = memo(function ScoreInput({ initialValue, onChange, editable }: ScoreInputProps) {
  const [local, setLocal] = useState(initialValue ?? "");

  useEffect(() => {
    setLocal(initialValue ?? "");
  }, [initialValue]);

  return (
    <TextInput
      value={local}
      onChangeText={(t) => {
        if (!editable) return;
        const next = sanitizeAndClampScore(t);
        setLocal(next);
        onChange(next);
      }}
      editable={editable}
      keyboardType="number-pad"
      inputMode="numeric"
      maxLength={2}
      blurOnSubmit={false}
      style={{
        width: "100%",
        borderWidth: 2,
        borderColor: editable ? COLORS.blue : "#E5E7EB",
        paddingVertical: Platform.OS === "web" ? 8 : 6,
        textAlign: "center",
        borderRadius: 8,
        backgroundColor: editable ? "white" : "#F3F4F6",
        color: "black",
        fontWeight: "900",
      }}
      placeholder="-"
    />
  );
});

export default function ScoringScreen() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const { isAdminUnlocked: isAdmin } = useAdminSession();
  useEffect(() => {
    // When admin mode changes, clear lists immediately so UI can’t keep showing stale admin data
    setMatches([]);
    setPersisted({});
    setDraft({});
    setErrorMsg("");
  }, [isAdmin]);

  // ✅ TEMP DEBUG: show whether admin is actually unlocked in this tab
  useEffect(() => {
    console.log("[SCORING] isAdminUnlocked =", isAdmin);
  }, [isAdmin]);

  const [loading, setLoading] = useState(true);

  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [seasonName, setSeasonName] = useState<string>("");

  const [weeks, setWeeks] = useState<ScheduleWeekRow[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [weekPickerOpen, setWeekPickerOpen] = useState(false);
  const [showIncompleteOnly, setShowIncompleteOnly] = useState(false);

  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [teamsById, setTeamsById] = useState<Record<string, string>>({});
  const [divisionsById, setDivisionsById] = useState<Record<string, string>>({});

  const [persisted, setPersisted] = useState<Record<string, MatchScoreRow>>({});
  const [draft, setDraft] = useState<Record<string, ScoreFields>>({});

  const [weekLock, setWeekLock] = useState<WeekLockRow | null>(null);

  const [errorMsg, setErrorMsg] = useState<string>("");

  // ✅ NEW: the signed-in player name for this season
  const [myPlayerName, setMyPlayerName] = useState<string>("");
  const [myTeamId, setMyTeamId] = useState<string | null>(null);

  const selectedWeekRow = useMemo(() => {
    if (selectedWeek == null) return null;
    return weeks.find((w) => w.week === selectedWeek) ?? null;
  }, [weeks, selectedWeek]);

  const weekDateLabel = useMemo(() => formatWeekDate(selectedWeekRow?.week_date ?? null), [selectedWeekRow]);

  const weekLabel = useMemo(() => {
    if (selectedWeek == null) return "Select Week";
    const d = formatWeekDate(selectedWeekRow?.week_date ?? null);
    return d ? `Week ${selectedWeek} • ${d}` : `Week ${selectedWeek}`;
  }, [selectedWeek, selectedWeekRow]);

  const getTeamKey = (matchId: string, which: "A" | "B") => `${matchId}__${which}`;

  const isWeekLocked = !!weekLock?.locked_at;

  const isMatchLocked = (matchId: string) => {
    const p = persisted[matchId];
    return !!p?.locked_at;
  };

  const canEditMatch = (matchId: string) => {
    if (isAdmin) return true;
    if (isWeekLocked) return false;
    if (isMatchLocked(matchId)) return false;
    return true;
  };

  const getFields = (matchId: string, which: "A" | "B"): ScoreFields => {
    const key = getTeamKey(matchId, which);
    const d = draft[key];
    const p = persisted[matchId];
    const persistedFields = which === "A" ? asScoreFields(p?.team_a) : asScoreFields(p?.team_b);
    return {
      g1: d?.g1 ?? persistedFields.g1 ?? "",
      g2: d?.g2 ?? persistedFields.g2 ?? "",
      g3: d?.g3 ?? persistedFields.g3 ?? "",
    };
  };

  const setScore = (matchId: string, which: "A" | "B", field: keyof ScoreFields, value: string) => {
    const key = getTeamKey(matchId, which);
    setDraft((prev) => {
      const existing = prev[key] ?? getFields(matchId, which);
      const next: ScoreFields = { ...existing, [field]: value };
      return { ...prev, [key]: next };
    });
  };

  const refreshWeekLock = useCallback(async () => {
    if (!seasonId || selectedWeek == null) return;
    const { data, error } = await supabase
      .from("scoring_week_locks")
      .select("season_id,week,locked_at,locked_by")
      .eq("season_id", seasonId)
      .eq("week", selectedWeek)
      .maybeSingle();

    if (error) {
      setWeekLock(null);
      return;
    }

    setWeekLock((data as WeekLockRow) ?? null);
  }, [seasonId, selectedWeek, isAdmin, myTeamId]);

  const refreshMatches = useCallback(async () => {
    if (!seasonId || selectedWeek == null) return;

    setErrorMsg("");
    setMatches([]);
    setTeamsById({});
    setDivisionsById({});

    let q = supabase
      .from("matches")
      .select("id,season_id,week,division_id,match_time,court,team_a_id,team_b_id")
      .eq("season_id", seasonId)
      .eq("week", selectedWeek);

    if (!isAdmin) {
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

    const divisionIds = Array.from(new Set(safeMatches.map((m) => m.division_id).filter((x): x is string => !!x)));

    if (teamIds.length) {
      const { data: teamRows } = await supabase.from("teams").select("id,team_name").in("id", teamIds);
      const map: Record<string, string> = {};
      (teamRows as TeamRow[] | null)?.forEach((t) => (map[t.id] = t.team_name ?? "Team"));
      setTeamsById(map);
    }

    if (divisionIds.length) {
      const { data: divRows } = await supabase.from("divisions").select("id,name").in("id", divisionIds);
      const map: Record<string, string> = {};
      (divRows as DivisionRow[] | null)?.forEach((d) => (map[d.id] = d.name ?? "Division"));
      setDivisionsById(map);
    }
  }, [seasonId, selectedWeek, isAdmin, myTeamId]);

  const refreshPersistedScores = useCallback(async (matchIds: string[]) => {
    if (!matchIds.length) {
      setPersisted({});
      return;
    }

    const { data, error } = await supabase
      .from("match_scores")
      .select(
        "match_id,team_a,team_b,verified,verified_at,verified_by,locked_at,locked_by,locked_by_user_id,locked_by_display"
      )
      .in("match_id", matchIds);

    if (error) {
      setPersisted({});
      setErrorMsg("Could not load scores.");
      return;
    }

    const map: Record<string, MatchScoreRow> = {};
    (data as MatchScoreRow[] | null)?.forEach((r) => {
      map[String(r.match_id)] = r;
    });
    setPersisted(map);
  }, []);

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
      setLoading(false);
      setErrorMsg("Current season is not set.");
      return;
    }

    const sid = settings.current_season_id;
    setSeasonId(sid);

    const { data: season } = await supabase.from("seasons").select("id,name").eq("id", sid).single<SeasonRow>();
    setSeasonName(season?.name ?? "");

    // ✅ NEW: load my player name for this season (used for verified_by)
    try {
      const userRes = await supabase.auth.getUser();
      const uid = userRes.data.user?.id ?? null;
      if (uid) {
        const { data: profile } = await supabase
          .from("user_season_profiles")
          .select("player_name, team_id")
          .eq("user_id", uid)
          .eq("season_id", sid)
          .maybeSingle<any>();

        setMyPlayerName((profile?.player_name ?? "").trim());
        setMyTeamId(profile?.team_id ?? null);
      } else {
        setMyPlayerName("");
        setMyTeamId(null);
      }
    } catch {
      setMyPlayerName("");
      setMyTeamId(null);
    }

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

    const keep = selectedWeek != null && safeWeeks.some((w) => w.week === selectedWeek) ? selectedWeek : null;
    setSelectedWeek(keep ?? pickDefaultWeek(safeWeeks));

    setLoading(false);
  }, [selectedWeek]);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    if (!seasonId || selectedWeek == null) return;
    void refreshMatches();
  }, [seasonId, selectedWeek, refreshMatches]);

  useEffect(() => {
    if (!seasonId || selectedWeek == null) return;
    void (async () => {
      const ids = matches.map((m) => m.id);
      await refreshPersistedScores(ids);
      await refreshWeekLock();
    })();
  }, [seasonId, selectedWeek, matches, refreshPersistedScores, refreshWeekLock]);

  useFocusEffect(
    useCallback(() => {
      void boot();
    }, [boot])
  );

  useFocusEffect(
    useCallback(() => {
      if (!seasonId || selectedWeek == null) return;
      void refreshMatches();
    }, [seasonId, selectedWeek, refreshMatches])
  );

  useEffect(() => {
    if (!seasonId || selectedWeek == null) return;
    void refreshMatches();
  }, [isAdmin, myTeamId, seasonId, selectedWeek, refreshMatches]);

  const groups = useMemo(() => {
    const out: { divisionName: string; rows: MatchRow[] }[] = [];
    const map: Record<string, MatchRow[]> = {};

    matches.forEach((m) => {
      const divName =
        (m.division_id && divisionsById[m.division_id]) || (m.division_id ? "Division" : "Unassigned Division");
      if (!map[divName]) map[divName] = [];
      map[divName].push(m);
    });

    Object.keys(map)
      .sort((a, b) => a.localeCompare(b))
      .forEach((k) => out.push({ divisionName: k, rows: map[k] }));

    return out;
  }, [matches, divisionsById]);

  const visibleGroups = useMemo(() => {
    if (!showIncompleteOnly) return groups;

    const isComplete = (m: MatchRow) => {
      const a = getFields(m.id, "A");
      const b = getFields(m.id, "B");
      return gameEnteredPair(a.g1, b.g1) && gameEnteredPair(a.g2, b.g2) && gameEnteredPair(a.g3, b.g3);
    };

    return groups
      .map((g) => ({ ...g, rows: g.rows.filter((m) => !isComplete(m)) }))
      .filter((g) => g.rows.length > 0);
  }, [showIncompleteOnly, groups, getFields]);

  const confirmOnWeb = (message: string) => window.confirm(message);

  const upsertMatchScore = async (matchId: string, teamA: ScoreFields, teamB: ScoreFields, verifiedBy: string) => {
    const payload = {
      match_id: matchId,
      team_a: teamA,
      team_b: teamB,
      verified: true,
      verified_at: new Date().toISOString(),
      verified_by: verifiedBy,
    };

    const { error } = await supabase.from("match_scores").upsert(payload, { onConflict: "match_id" });
    if (error) throw error;
  };

  const setLockFields = async (matchId: string, by: string, locked: boolean) => {
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes?.user?.id ?? null;

    const { error } = await supabase
      .from("match_scores")
      .update({
        locked_at: locked ? new Date().toISOString() : null,
        locked_by: locked ? by : null,
        locked_by_user_id: locked ? uid : null,
        locked_by_display: locked ? by : null,
      })
      .eq("match_id", matchId);

    if (error) throw error;
  };

  const rpcLockMatch = async (matchId: string) => {
    const { error } = await supabase.rpc("lock_match_score", { p_match_id: matchId });
    if (error) throw error;
  };

  const rpcUnlockMatch = async (matchId: string) => {
    const { error } = await supabase.rpc("unlock_match_score", { p_match_id: matchId });
    if (error) throw error;
  };

  const onAdminSetLock = async (matchId: string, lock: boolean) => {
    if (!isAdmin) return;

    const title = lock ? "Lock match?" : "Unlock match?";
    const msg = lock
      ? "This will lock this match so non-admins cannot edit it."
      : "This will unlock this match so it can be edited again.";

    const doIt = async () => {
      try {
        if (lock) await rpcLockMatch(matchId);
        else await rpcUnlockMatch(matchId);
        await refreshPersistedScores(matches.map((x) => x.id));
        await refreshWeekLock();
      } catch (e: any) {
        Alert.alert("Update failed", e?.message || "Could not update lock status.");
      }
    };

    if (Platform.OS === "web") {
      if (!confirmOnWeb(`${title}\n\n${msg}`)) return;
      await doIt();
      return;
    }

    Alert.alert(title, msg, [
      { text: "Cancel", style: "cancel" },
      {
        text: lock ? "Lock" : "Unlock",
        style: lock ? "destructive" : "default",
        onPress: () => void doIt(),
      },
    ]);
  };

  const onVerifyAndSave = async (m: MatchRow) => {
    const editable = canEditMatch(m.id);

    if (!editable) {
      Alert.alert("Read-only", "This match is locked (or week is locked).");
      return;
    }

    const aFields = getFields(m.id, "A");
    const bFields = getFields(m.id, "B");

    const all3 =
      gameEnteredPair(aFields.g1, bFields.g1) &&
      gameEnteredPair(aFields.g2, bFields.g2) &&
      gameEnteredPair(aFields.g3, bFields.g3);

    // ✅ FIX: use the actual player_name (fallback to ADMIN/USER only if missing)
    const by = isAdmin ? "ADMIN" : myPlayerName || "USER";

    const summary = "Save these scores?";

    const doSave = async () => {
      await upsertMatchScore(m.id, aFields, bFields, by);
      await refreshPersistedScores(matches.map((x) => x.id));
    };

    const doLock = async () => {
      await doSave();
      await setLockFields(m.id, by, true);
      await refreshPersistedScores(matches.map((x) => x.id));
    };

    if (Platform.OS === "web") {
      if (!confirmOnWeb(summary)) return;
      try {
        if (!all3) await doSave();
        else await doLock();
      } catch (e: any) {
        Alert.alert("Save failed", e?.message || "Could not save scores.");
      }
      return;
    }

    if (!all3) {
      Alert.alert("Save", summary, [
        { text: "Edit", style: "cancel" },
        {
          text: "Save",
          onPress: () => {
            void (async () => {
              try {
                await doSave();
              } catch (e: any) {
                Alert.alert("Save failed", e?.message || "Could not save scores.");
              }
            })();
          },
        },
      ]);
      return;
    }

    Alert.alert("Final Game", summary, [
      { text: "Edit", style: "cancel" },
      {
        text: "Save (Lock)",
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              await doLock();
            } catch (e: any) {
              Alert.alert("Save failed", e?.message || "Could not save/lock scores.");
            }
          })();
        },
      },
    ]);
  };

  const colTime = 110;
  const colCourt = 90;
  const colTeam = isLandscape ? 320 : 220;
  const colGame = 90;
  const colTotal = 90;
  const tableMinWidth = colTime + colCourt + colTeam + colGame * 3 + colTotal;

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 10, color: COLORS.text }}>Loading scoring…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 14, paddingBottom: 30, backgroundColor: COLORS.bg }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ marginBottom: 10 }}>
          <Text style={{ fontSize: 22, fontWeight: "900", color: COLORS.text }}>Scoring</Text>
          <Text style={{ marginTop: 6, fontWeight: "900", color: isAdmin ? "green" : "red" }}>
            Admin Mode: {isAdmin ? "ON" : "OFF"}
          </Text>

          <Text style={{ marginTop: 4, color: COLORS.subtext, fontWeight: "700" }}>
            {seasonName ? `Season: ${seasonName}` : "Season"}
          </Text>
        </View>

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
            <Text style={{ fontWeight: "900", fontSize: 16, color: COLORS.text }}>{weekLabel}</Text>
            <Text style={{ fontWeight: "900", fontSize: 16, color: COLORS.text }}>▼</Text>
          </View>
          <Text style={{ marginTop: 4, color: COLORS.subtext, fontSize: 13, fontWeight: "700" }}>
            Tap to choose a different week
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setShowIncompleteOnly((v) => !v)}
          style={{
            alignSelf: "center",
            paddingVertical: 10,
            paddingHorizontal: 16,
            borderRadius: 999,
            borderWidth: 2,
            borderColor: COLORS.blue,
            backgroundColor: showIncompleteOnly ? COLORS.blue : "#FFFFFF",
            marginBottom: 14,
          }}
        >
          <Text style={{ fontWeight: "900", color: showIncompleteOnly ? "#FFFFFF" : COLORS.text }}>
            Show incomplete matches
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

        {selectedWeek == null ? (
          <View style={{ padding: 14 }}>
            <Text style={{ fontWeight: "900", color: COLORS.text }}>Select a week.</Text>
          </View>
        ) : matches.length === 0 ? (
          <View style={{ padding: 14 }}>
            <Text style={{ fontWeight: "900", color: COLORS.text }}>No matches for this week.</Text>
          </View>
        ) : (
          visibleGroups.map((group) => (
            <View key={group.divisionName} style={{ marginBottom: 18 }}>
              <Text style={{ fontSize: 20, fontWeight: "900", marginBottom: 10, color: COLORS.text }}>
                {group.divisionName}
              </Text>

              <View style={{ gap: 14 }}>
                {group.rows.map((m) => {
                  const teamAName = m.team_a_id ? teamsById[m.team_a_id] : "Team A";
                  const teamBName = m.team_b_id ? teamsById[m.team_b_id] : "Team B";

                  const p = persisted[m.id];
                  const lockedMatch = !!p?.locked_at;

                  const editable = canEditMatch(m.id);

                  const aFields = getFields(m.id, "A");
                  const bFields = getFields(m.id, "B");

                  const aTotal = totalOf(aFields);
                  const bTotal = totalOf(bFields);

                  const completion =
                    gameEnteredPair(aFields.g1, bFields.g1) &&
                    gameEnteredPair(aFields.g2, bFields.g2) &&
                    gameEnteredPair(aFields.g3, bFields.g3)
                      ? "COMPLETED"
                      : isEntered(aFields.g1) ||
                        isEntered(aFields.g2) ||
                        isEntered(aFields.g3) ||
                        isEntered(bFields.g1) ||
                        isEntered(bFields.g2) ||
                        isEntered(bFields.g3)
                      ? "PARTIAL"
                      : null;

                  const time = formatTimeTo12Hour(m.match_time);
                  const court = m.court != null ? String(m.court) : "";

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
                          Week {m.week} • {weekDateLabel || ""} • {time} • Court {court}
                        </Text>

                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                          {p?.verified_by ? (
                            <Text style={{ color: "#333", fontWeight: "800" }}>Verified by {p.verified_by}</Text>
                          ) : (
                            <Text style={{ color: "#333", fontWeight: "800" }}>Not verified yet</Text>
                          )}

                          {completion ? <Text style={{ fontWeight: "900" }}>•</Text> : null}
                          {completion === "COMPLETED" ? (
                            <Text style={{ color: "green", fontWeight: "900" }}>COMPLETED</Text>
                          ) : null}
                          {completion === "PARTIAL" ? (
                            <Text style={{ color: "red", fontWeight: "900" }}>PARTIAL</Text>
                          ) : null}

                          <Text style={{ fontWeight: "900" }}>•</Text>
                          {lockedMatch || isWeekLocked ? (
                            <Text style={{ color: COLORS.danger, fontWeight: "900" }}>LOCKED</Text>
                          ) : (
                            <Text style={{ color: "#111", fontWeight: "900" }}>UNLOCKED</Text>
                          )}
                        </View>

                        {/* ✅ ADMIN-ONLY LOCK/UNLOCK BUTTONS (inside each match card) */}
                        {isAdmin ? (
                          <View style={{ flexDirection: "row", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                            {lockedMatch ? (
                              <Pressable
                                onPress={() => {
                                  void onAdminSetLock(m.id, false);
                                }}
                                style={{
                                  paddingVertical: 8,
                                  paddingHorizontal: 14,
                                  borderRadius: 999,
                                  borderWidth: 2,
                                  borderColor: "#111",
                                  backgroundColor: "#FFFFFF",
                                }}
                              >
                                <Text style={{ fontWeight: "900", color: "#111" }}>UNLOCK</Text>
                              </Pressable>
                            ) : (
                              <Pressable
                                onPress={() => {
                                  void onAdminSetLock(m.id, true);
                                }}
                                style={{
                                  paddingVertical: 8,
                                  paddingHorizontal: 14,
                                  borderRadius: 999,
                                  borderWidth: 2,
                                  borderColor: "#111",
                                  backgroundColor: "#111",
                                }}
                              >
                                <Text style={{ fontWeight: "900", color: "#FFFFFF" }}>LOCK</Text>
                              </Pressable>
                            )}
                          </View>
                        ) : null}

                        {lockedMatch && p?.locked_by_display ? (
                          <Text style={{ marginTop: 6, color: "#333", fontWeight: "800" }}>
                            Saved by: {p.locked_by_display}
                          </Text>
                        ) : null}

                        {!editable ? (
                          <Text style={{ marginTop: 6, color: "#555", fontWeight: "700" }}>
                            (Read-only — this match is locked)
                          </Text>
                        ) : null}
                      </View>

                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator
                        contentContainerStyle={{ minWidth: tableMinWidth }}
                        keyboardShouldPersistTaps="handled"
                      >
                        <View style={{ width: tableMinWidth }}>
                          <View
                            style={{
                              flexDirection: "row",
                              borderBottomWidth: 1,
                              borderBottomColor: "#000",
                              paddingVertical: 8,
                              backgroundColor: "#f5f5f5",
                            }}
                          >
                            <Text style={{ width: colTime, fontWeight: "900", textAlign: "center" }}>TIME</Text>
                            <Text style={{ width: colCourt, fontWeight: "900", textAlign: "center" }}>COURT #</Text>
                            <Text style={{ width: colTeam, fontWeight: "900", textAlign: "center" }}>TEAM NAME</Text>
                            <Text style={{ width: colGame, fontWeight: "900", textAlign: "center" }}>G1</Text>
                            <Text style={{ width: colGame, fontWeight: "900", textAlign: "center" }}>G2</Text>
                            <Text style={{ width: colGame, fontWeight: "900", textAlign: "center" }}>G3</Text>
                            <Text style={{ width: colTotal, fontWeight: "900", textAlign: "center" }}>TOTAL</Text>
                          </View>

                          <View style={{ flexDirection: "row", paddingVertical: 10, alignItems: "center" }}>
                            <Text style={{ width: colTime, textAlign: "center" }}>{time}</Text>
                            <Text style={{ width: colCourt, textAlign: "center" }}>{court}</Text>
                            <Text style={{ width: colTeam, textAlign: "center" }} numberOfLines={2}>
                              {teamAName}
                            </Text>

                            <View style={{ width: colGame, paddingHorizontal: 6 }}>
                              <ScoreInput
                                initialValue={aFields.g1}
                                editable={editable}
                                onChange={(v) => setScore(m.id, "A", "g1", v)}
                              />
                            </View>
                            <View style={{ width: colGame, paddingHorizontal: 6 }}>
                              <ScoreInput
                                initialValue={aFields.g2}
                                editable={editable}
                                onChange={(v) => setScore(m.id, "A", "g2", v)}
                              />
                            </View>
                            <View style={{ width: colGame, paddingHorizontal: 6 }}>
                              <ScoreInput
                                initialValue={aFields.g3}
                                editable={editable}
                                onChange={(v) => setScore(m.id, "A", "g3", v)}
                              />
                            </View>

                            <Text style={{ width: colTotal, textAlign: "center", fontWeight: "900" }}>{aTotal}</Text>
                          </View>

                          <View style={{ height: 1, backgroundColor: "#000" }} />

                          <View style={{ flexDirection: "row", paddingVertical: 10, alignItems: "center" }}>
                            <Text style={{ width: colTime, textAlign: "center" }}>{time}</Text>
                            <Text style={{ width: colCourt, textAlign: "center" }}>{court}</Text>
                            <Text style={{ width: colTeam, textAlign: "center" }} numberOfLines={2}>
                              {teamBName}
                            </Text>

                            <View style={{ width: colGame, paddingHorizontal: 6 }}>
                              <ScoreInput
                                initialValue={bFields.g1}
                                editable={editable}
                                onChange={(v) => setScore(m.id, "B", "g1", v)}
                              />
                            </View>
                            <View style={{ width: colGame, paddingHorizontal: 6 }}>
                              <ScoreInput
                                initialValue={bFields.g2}
                                editable={editable}
                                onChange={(v) => setScore(m.id, "B", "g2", v)}
                              />
                            </View>
                            <View style={{ width: colGame, paddingHorizontal: 6 }}>
                              <ScoreInput
                                initialValue={bFields.g3}
                                editable={editable}
                                onChange={(v) => setScore(m.id, "B", "g3", v)}
                              />
                            </View>

                            <Text style={{ width: colTotal, textAlign: "center", fontWeight: "900" }}>{bTotal}</Text>
                          </View>
                        </View>
                      </ScrollView>

                      <View
                        style={{
                          borderTopWidth: 1,
                          borderTopColor: "#000",
                          padding: 10,
                          backgroundColor: "#fafafa",
                        }}
                      >
                        <Pressable
                          onPress={() => {
                            void onVerifyAndSave(m);
                          }}
                          disabled={!editable}
                          style={{
                            backgroundColor: editable ? "black" : "#999",
                            paddingVertical: 12,
                            borderRadius: 10,
                            alignItems: "center",
                            opacity: editable ? 1 : 0.6,
                          }}
                        >
                          <Text style={{ color: "white", fontWeight: "900" }}>Verify & Save</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </ScrollView>

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
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
