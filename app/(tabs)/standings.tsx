import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { supabase } from "../../constants/supabaseClient";

/**
 * USER STANDINGS TAB (REAL-TIME)
 * ✅ Single source of truth: app_settings.current_season_id
 * ✅ Standings computed ONLY from match_scores (verified) for matches in that season
 * ✅ REALTIME: auto-refresh on match_scores changes (instant)
 * ✅ REALTIME: auto-refresh on matches changes for this season
 * ✅ "Scroll from anywhere": header is inside main ScrollView
 *
 * ✅ FIX: Inactive teams must NOT disappear from standings or remove past results.
 * - We load teams referenced by matches and include is_active in lookups.
 * - Inactive teams render grey + "INACTIVE" and are forced to bottom.
 *
 * ✅ FIX (THIS CHANGE): Teams appear ONLY ONCE under their CURRENT division (from teams.division),
 * while keeping ALL verified results across the season no matter what division they played in earlier.
 */

type AppSettingsRow = { current_season_id: string | null };
type SeasonRow = { id: string; name: string | null };

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

type MatchScoreRow = {
  match_id: string;
  team_a: any;
  team_b: any;
  verified: boolean;
};

type TeamRow = {
  id: string;
  team_name: string | null;
  is_active: boolean | null;
  division: string | null; // ✅ current division stored on teams (Manage Teams)
};

type DivisionRow = { id: string; name: string | null };

type ScoreFields = { g1: string; g2: string; g3: string };

type TeamTotals = {
  teamId: string;
  teamName: string;
  isActive: boolean;
  gamesPlayed: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
};

const COLORS = {
  bg: "#FFFFFF",
  text: "#111827",
  subtext: "#374151",
  border: "#111827",
  rowBorder: "#E5E7EB",
  headerBg: "#F3F4F6",
  dangerBg: "#FEE2E2",
  dangerBorder: "#EF4444",
  dangerText: "#991B1B",
  inactiveText: "#6B7280",
};

function asScoreFields(v: any): ScoreFields {
  const g1 = typeof v?.g1 === "string" ? v.g1 : v?.g1 == null ? "" : String(v.g1);
  const g2 = typeof v?.g2 === "string" ? v.g2 : v?.g2 == null ? "" : String(v.g2);
  const g3 = typeof v?.g3 === "string" ? v.g3 : v?.g3 == null ? "" : String(v.g3);
  return { g1, g2, g3 };
}

function isEnteredScore(v: string) {
  return (v ?? "").toString().trim() !== "";
}
function gameEnteredPair(a: string, b: string) {
  return isEnteredScore(a) && isEnteredScore(b);
}
function toN(s: string) {
  const n = parseInt((s ?? "").toString() || "0", 10);
  return Number.isFinite(n) ? n : 0;
}
function diff(t: TeamTotals) {
  return t.pointsFor - t.pointsAgainst;
}

export default function StandingsScreen() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [loading, setLoading] = useState(true);

  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [seasonName, setSeasonName] = useState<string>("");

  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [scoresByMatchId, setScoresByMatchId] = useState<Record<string, MatchScoreRow>>({});

  // ✅ store team name + active status
  const [teamNameById, setTeamNameById] = useState<Record<string, string>>({});
  const [teamActiveById, setTeamActiveById] = useState<Record<string, boolean>>({});

  // ✅ store CURRENT team division (from Manage Teams)
  const [teamDivisionById, setTeamDivisionById] = useState<Record<string, string | null>>({});

  const [divisionsById, setDivisionsById] = useState<Record<string, string>>({});

  const [errorMsg, setErrorMsg] = useState<string>("");

  // Realtime channel refs (so we can clean up properly)
  const channelRef = useRef<any>(null);
  const seasonIdRef = useRef<string | null>(null);

  const loadSeason = useCallback(async (): Promise<string | null> => {
    const { data: settings, error: settingsError } = await supabase
      .from("app_settings")
      .select("current_season_id")
      .single<AppSettingsRow>();

    if (settingsError || !settings?.current_season_id) {
      setSeasonId(null);
      setSeasonName("");
      setErrorMsg("Current season is not set.");
      return null;
    }

    const sid = settings.current_season_id;
    setSeasonId(sid);

    const { data: season } = await supabase
      .from("seasons")
      .select("id,name")
      .eq("id", sid)
      .single<SeasonRow>();

    setSeasonName(season?.name ?? "");
    return sid;
  }, []);

  const loadMatchesAndLookups = useCallback(async (sid: string) => {
    setErrorMsg("");

    const { data: matchRows, error: matchErr } = await supabase
      .from("matches")
      .select("id,season_id,week,division_id,match_time,court,team_a_id,team_b_id")
      .eq("season_id", sid);

    if (matchErr) {
      setMatches([]);
      setTeamNameById({});
      setTeamActiveById({});
      setTeamDivisionById({});
      setDivisionsById({});
      setErrorMsg("Could not load matches for this season.");
      return [];
    }

    const safeMatches = ((matchRows ?? []) as MatchRow[]).slice();
    setMatches(safeMatches);

    const teamIds = Array.from(
      new Set(
        safeMatches
          .flatMap((m) => [m.team_a_id, m.team_b_id])
          .filter((x): x is string => !!x)
      )
    );

    const matchDivisionIds = Array.from(
      new Set(safeMatches.map((m) => m.division_id).filter((x): x is string => !!x))
    );

    // ✅ Load teams (INCLUDING their current division from Manage Teams)
    let teamDivisionIds: string[] = [];

    // ✅ IMPORTANT: do NOT filter on is_active here. We need inactive teams for standings history.
    if (teamIds.length) {
      const { data: teamRows } = await supabase
        .from("teams")
        .select("id,team_name,is_active,division")
        .in("id", teamIds);

      const nameMap: Record<string, string> = {};
      const activeMap: Record<string, boolean> = {};
      const divMap: Record<string, string | null> = {};

      (teamRows as TeamRow[] | null)?.forEach((t) => {
        nameMap[t.id] = (t.team_name ?? "Team").trim() || "Team";
        activeMap[t.id] = t.is_active !== false; // null/true => active, false => inactive
        divMap[t.id] = t.division ?? null;
      });

      setTeamNameById(nameMap);
      setTeamActiveById(activeMap);
      setTeamDivisionById(divMap);

      teamDivisionIds = Array.from(
        new Set(
          (teamRows as TeamRow[] | null)
            ?.map((t) => (t.division ?? "").toString().trim())
            .filter((x) => !!x) ?? []
        )
      );
    } else {
      setTeamNameById({});
      setTeamActiveById({});
      setTeamDivisionById({});
    }

    // ✅ Divisions lookup must include:
    // - divisions referenced by matches (old scheduling)
    // - divisions referenced by teams.division (current bucket)
    const allDivisionIds = Array.from(new Set([...matchDivisionIds, ...teamDivisionIds]));

    if (allDivisionIds.length) {
      const { data: divRows } = await supabase
        .from("divisions")
        .select("id,name")
        .in("id", allDivisionIds);

      const dmap: Record<string, string> = {};
      (divRows as DivisionRow[] | null)?.forEach((d) => {
        dmap[d.id] = (d.name ?? "Division").trim() || "Division";
      });
      setDivisionsById(dmap);
    } else {
      setDivisionsById({});
    }

    return safeMatches;
  }, []);

  const refreshScoresOnly = useCallback(async (matchIds: string[]) => {
    if (!matchIds.length) {
      setScoresByMatchId({});
      return;
    }

    const { data: scoreRows, error: scoreErr } = await supabase
      .from("match_scores")
      .select("match_id,team_a,team_b,verified")
      .in("match_id", matchIds);

    if (scoreErr) {
      setScoresByMatchId({});
      setErrorMsg((prev) => prev || "Could not load match scores.");
      return;
    }

    const map: Record<string, MatchScoreRow> = {};
    ((scoreRows ?? []) as MatchScoreRow[]).forEach((r) => {
      map[String(r.match_id)] = r;
    });
    setScoresByMatchId(map);
  }, []);

  const fullRefresh = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");

    try {
      const sid = await loadSeason();
      seasonIdRef.current = sid;

      if (!sid) {
        setMatches([]);
        setScoresByMatchId({});
        setTeamNameById({});
        setTeamActiveById({});
        setTeamDivisionById({});
        setDivisionsById({});
        setLoading(false);
        return;
      }

      const ms = await loadMatchesAndLookups(sid);
      await refreshScoresOnly(ms.map((m) => m.id));

      setLoading(false);
    } catch (e: any) {
      setErrorMsg(e?.message || "Failed to load standings.");
      setLoading(false);
    }
  }, [loadSeason, loadMatchesAndLookups, refreshScoresOnly]);

  // Initial load
  useEffect(() => {
    void fullRefresh();
  }, [fullRefresh]);

  // Refresh when user navigates back to this tab (no manual refresh)
  useFocusEffect(
    useCallback(() => {
      void fullRefresh();
    }, [fullRefresh])
  );

  // ✅ REALTIME: listen for score + match changes and refresh instantly
  useEffect(() => {
    if (!seasonId) return;

    if (channelRef.current) {
      try {
        supabase.removeChannel(channelRef.current);
      } catch {}
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`standings_realtime_${seasonId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "match_scores" },
        async () => {
          const ids = matches.map((m) => m.id);
          await refreshScoresOnly(ids);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches", filter: `season_id=eq.${seasonId}` },
        async () => {
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

  const computed = useMemo(() => {
    // ✅ 1) Compute ONE totals map across ALL matches in the season
    const totals = new Map<string, TeamTotals>();

    const ensureTeam = (teamId: string, fallbackName: string) => {
      const name = (teamNameById[teamId] ?? fallbackName ?? "Team").trim() || "Team";
      const isActive = teamActiveById[teamId] ?? true;

      if (!totals.has(teamId)) {
        totals.set(teamId, {
          teamId,
          teamName: name,
          isActive,
          gamesPlayed: 0,
          wins: 0,
          losses: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        });
      } else {
        const prev = totals.get(teamId)!;
        totals.set(teamId, { ...prev, teamName: name, isActive });
      }
    };

    // include teams even if 0 games
    for (const m of matches) {
      if (m.team_a_id) ensureTeam(m.team_a_id, "Team A");
      if (m.team_b_id) ensureTeam(m.team_b_id, "Team B");
    }

    // compute from VERIFIED only (ALL season matches)
    for (const m of matches) {
      if (!m.team_a_id || !m.team_b_id) continue;

      const s = scoresByMatchId[m.id];
      if (!s || !s.verified) continue;

      const a = asScoreFields(s.team_a);
      const b = asScoreFields(s.team_b);

      const aRaw = [a.g1, a.g2, a.g3];
      const bRaw = [b.g1, b.g2, b.g3];

      ensureTeam(m.team_a_id, "Team A");
      ensureTeam(m.team_b_id, "Team B");

      const ta = totals.get(m.team_a_id)!;
      const tb = totals.get(m.team_b_id)!;

      for (let i = 0; i < 3; i++) {
        if (!gameEnteredPair(aRaw[i], bRaw[i])) continue;

        const ap = toN(aRaw[i]);
        const bp = toN(bRaw[i]);

        ta.gamesPlayed += 1;
        tb.gamesPlayed += 1;

        ta.pointsFor += ap;
        ta.pointsAgainst += bp;

        tb.pointsFor += bp;
        tb.pointsAgainst += ap;

        if (ap > bp) {
          ta.wins += 1;
          tb.losses += 1;
        } else if (bp > ap) {
          tb.wins += 1;
          ta.losses += 1;
        }
      }

      totals.set(m.team_a_id, { ...ta });
      totals.set(m.team_b_id, { ...tb });
    }

    const allTeams = Array.from(totals.values());

    // ✅ 2) Bucket teams EXACTLY ONCE by CURRENT division (teams.division -> divisions.name)
    const byDivisionName: Record<string, TeamTotals[]> = {};

    for (const t of allTeams) {
      const divIdOrText = (teamDivisionById[t.teamId] ?? "").toString().trim();

      // If teams.division is actually the division UUID (stored as text), translate it to the name
      const divName =
        (divIdOrText && divisionsById[divIdOrText]) ||
        (divIdOrText ? divIdOrText : "Unassigned Division");

      if (!byDivisionName[divName]) byDivisionName[divName] = [];
      byDivisionName[divName].push(t);
    }

    // ✅ Division order (your requirement): Advanced, Intermediate, Beginner
    const DIVISION_ORDER = ["Advanced", "Intermediate", "Beginner"];

    const divisionNames = Object.keys(byDivisionName).sort((a, b) => {
      const ai = DIVISION_ORDER.indexOf(a);
      const bi = DIVISION_ORDER.indexOf(b);

      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;

      return ai - bi;
    });

    return divisionNames.map((divisionName) => {
      const list = (byDivisionName[divisionName] ?? []).slice();

      // ✅ Sort: ACTIVE first by record, INACTIVE forced to bottom
      // Tie breakers (in order):
      // 1) Most Wins
      // 2) Least Losses
      // 3) Most Points For (PF)
      // 4) Least Points Against (PA)
      list.sort((x, y) => {
        const xInactive = !x.isActive;
        const yInactive = !y.isActive;
        if (xInactive !== yInactive) return xInactive ? 1 : -1; // inactive bottom

        const xZero = x.gamesPlayed === 0;
        const yZero = y.gamesPlayed === 0;
        if (xZero !== yZero) return xZero ? 1 : -1;

        // 1) Most Wins
        if (y.wins !== x.wins) return y.wins - x.wins;

        // 2) Least Losses
        if (x.losses !== y.losses) return x.losses - y.losses;

        // 3) Most Points For (PF)
        if (y.pointsFor !== x.pointsFor) return y.pointsFor - x.pointsFor;

        // 4) Least Points Against (PA)
        if (x.pointsAgainst !== y.pointsAgainst) return x.pointsAgainst - y.pointsAgainst;

        // Final stable fallback
        return x.teamName.localeCompare(y.teamName);
      });

      return { divisionName, rows: list };
    });
  }, [matches, scoresByMatchId, teamNameById, teamActiveById, teamDivisionById, divisionsById]);

  const colRank = 44;
  const colGP = 52;
  const colW = 52;
  const colL = 52;
  const colPF = 62;
  const colPA = 62;
  const colDIFF = 72;
  const colTeam = isLandscape ? 320 : 240;

  const tableMinWidth = colRank + colTeam + colGP + colW + colL + colPF + colPA + colDIFF;

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 10, color: COLORS.text }}>Loading standings…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 40, backgroundColor: COLORS.bg }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={{ fontSize: 26, fontWeight: "900", marginBottom: 6, color: COLORS.text }}>
        Standings
      </Text>

      <Text style={{ color: COLORS.subtext, fontWeight: "700", marginBottom: 8 }}>
        {seasonName ? `Season: ${seasonName}` : "Season"}
      </Text>

      <Text style={{ color: COLORS.subtext, marginBottom: 12 }}>
        Updates instantly when scores are saved.
      </Text>

      {errorMsg ? (
        <View
          style={{
            padding: 12,
            borderRadius: 12,
            backgroundColor: COLORS.dangerBg,
            borderWidth: 1,
            borderColor: COLORS.dangerBorder,
            marginBottom: 12,
          }}
        >
          <Text style={{ fontWeight: "900", color: COLORS.dangerText }}>{errorMsg}</Text>
        </View>
      ) : null}

      {computed.length === 0 || computed.every((s) => s.rows.length === 0) ? (
        <Text style={{ color: COLORS.text }}>No standings yet.</Text>
      ) : (
        <View style={{ gap: 16 }}>
          {computed.map((section) => {
            if (section.rows.length === 0) return null;

            return (
              <View key={section.divisionName}>
                <Text style={{ fontSize: 20, fontWeight: "900", marginBottom: 8, color: COLORS.text }}>
                  {section.divisionName}
                </Text>

                <ScrollView
                  horizontal
                  nestedScrollEnabled
                  showsHorizontalScrollIndicator
                  contentContainerStyle={{ minWidth: Math.max(width, tableMinWidth) }}
                  keyboardShouldPersistTaps="handled"
                >
                  <View style={{ width: Math.max(width, tableMinWidth) }}>
                    <View
                      style={{
                        flexDirection: "row",
                        borderWidth: 2,
                        borderColor: "#000",
                        backgroundColor: COLORS.headerBg,
                      }}
                    >
                      <Text style={{ width: colRank, paddingVertical: 10, textAlign: "center", fontWeight: "900" }}>
                        #
                      </Text>
                      <Text style={{ width: colTeam, paddingVertical: 10, paddingHorizontal: 10, fontWeight: "900" }}>
                        Team
                      </Text>
                      <Text style={{ width: colGP, paddingVertical: 10, textAlign: "center", fontWeight: "900" }}>
                        GP
                      </Text>
                      <Text style={{ width: colW, paddingVertical: 10, textAlign: "center", fontWeight: "900" }}>
                        W
                      </Text>
                      <Text style={{ width: colL, paddingVertical: 10, textAlign: "center", fontWeight: "900" }}>
                        L
                      </Text>
                      <Text style={{ width: colPF, paddingVertical: 10, textAlign: "center", fontWeight: "900" }}>
                        PF
                      </Text>
                      <Text style={{ width: colPA, paddingVertical: 10, textAlign: "center", fontWeight: "900" }}>
                        PA
                      </Text>
                      <Text style={{ width: colDIFF, paddingVertical: 10, textAlign: "center", fontWeight: "900" }}>
                        DIFF
                      </Text>
                    </View>

                    <View style={{ borderWidth: 2, borderColor: "#000", borderTopWidth: 0 }}>
                      {section.rows.map((r, idx) => {
                        const d = diff(r);
                        const inactive = !r.isActive;

                        return (
                          <View
                            key={`${r.teamId}_${idx}`}
                            style={{
                              flexDirection: "row",
                              borderTopWidth: idx === 0 ? 0 : 1,
                              borderTopColor: "#000",
                              backgroundColor: "white",
                              opacity: inactive ? 0.55 : 1,
                            }}
                          >
                            <Text style={{ width: colRank, paddingVertical: 10, textAlign: "center", fontWeight: "900" }}>
                              {idx + 1}
                            </Text>

                            <Text
                              style={{
                                width: colTeam,
                                paddingVertical: 10,
                                paddingHorizontal: 10,
                                fontWeight: "800",
                                color: inactive ? COLORS.inactiveText : COLORS.text,
                              }}
                              numberOfLines={1}
                            >
                              {r.teamName}
                              {inactive ? "  (INACTIVE)" : ""}
                            </Text>

                            <Text style={{ width: colGP, paddingVertical: 10, textAlign: "center" }}>
                              {r.gamesPlayed}
                            </Text>
                            <Text style={{ width: colW, paddingVertical: 10, textAlign: "center", fontWeight: "900" }}>
                              {r.wins}
                            </Text>
                            <Text style={{ width: colL, paddingVertical: 10, textAlign: "center", fontWeight: "900" }}>
                              {r.losses}
                            </Text>
                            <Text style={{ width: colPF, paddingVertical: 10, textAlign: "center" }}>
                              {r.pointsFor}
                            </Text>
                            <Text style={{ width: colPA, paddingVertical: 10, textAlign: "center" }}>
                              {r.pointsAgainst}
                            </Text>
                            <Text style={{ width: colDIFF, paddingVertical: 10, textAlign: "center", fontWeight: "900" }}>
                              {d}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                </ScrollView>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}
