import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";

import { supabase } from "../../constants/supabaseClient";
import { useAdminSession } from "../../lib/adminSession";

import PlayoffOverridePanel from "../../components/playoffs/PlayoffOverridePanel";
import PlayoffFreeformBoard from "../../components/playoffs/PlayoffFreeformBoard";
import Zoom from "react-native-zoom-reanimated";

type DivisionRow = { id: string; name: string };
type BoardRow = { division_id: string; board_json: any; updated_at: string };

type TeamRow = { id: string; team_name: string };

type BoardMode = "BRACKET" | "FREEFORM";
type BracketFormat = "SINGLE" | "DOUBLE";

type ScoreFields = { g1: string; g2: string; g3: string };

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

type GameParse =
  | { kind: "W"; roundNum: number; matchIndex: number; matchStr: string }
  | { kind: "L"; roundNum: number; matchIndex: number; matchStr: string }
  | { kind: "GF"; roundNum: 1 | 2; matchIndex: 0; matchStr: "1" | "2" }
  | { kind: "UNKNOWN"; roundNum: null; matchIndex: null; matchStr: null };

function parseGameId(gameId: string): GameParse {
  const gid = (gameId ?? "").toString().trim();
  if (!gid) return { kind: "UNKNOWN", roundNum: null, matchIndex: null, matchStr: null };

  if (gid === "GF1") return { kind: "GF", roundNum: 1, matchIndex: 0, matchStr: "1" };
  if (gid === "GF2") return { kind: "GF", roundNum: 2, matchIndex: 0, matchStr: "2" };

  const parts = gid.split("-");
  if (parts.length !== 2) return { kind: "UNKNOWN", roundNum: null, matchIndex: null, matchStr: null };

  const left = parts[0];
  const matchStr = parts[1];
  const matchNum = parseInt(matchStr, 10);
  const matchIndex = Number.isFinite(matchNum) ? matchNum - 1 : NaN;

  if (left.startsWith("W")) {
    const r = parseInt(left.replace("W", ""), 10);
    if (!Number.isFinite(r) || !Number.isFinite(matchIndex))
      return { kind: "UNKNOWN", roundNum: null, matchIndex: null, matchStr: null };
    return { kind: "W", roundNum: r, matchIndex, matchStr };
  }
  if (left.startsWith("L")) {
    const r = parseInt(left.replace("L", ""), 10);
    if (!Number.isFinite(r) || !Number.isFinite(matchIndex))
      return { kind: "UNKNOWN", roundNum: null, matchIndex: null, matchStr: null };
    return { kind: "L", roundNum: r, matchIndex, matchStr };
  }

  return { kind: "UNKNOWN", roundNum: null, matchIndex: null, matchStr: null };
}

export default function PlayoffsTab() {
  const { isAdminUnlocked } = useAdminSession();

  const [loading, setLoading] = useState(true);
  const [savingMode, setSavingMode] = useState(false);

  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [seasonName, setSeasonName] = useState<string | null>(null);

  const [divisions, setDivisions] = useState<DivisionRow[]>([]);
  const [boardsByDivision, setBoardsByDivision] = useState<Record<string, BoardRow>>({});
  const [teams, setTeams] = useState<TeamRow[]>([]);

  const [selectedDivisionId, setSelectedDivisionId] = useState<string | null>(null);

  const [pendingFormat, setPendingFormat] = useState<BracketFormat | null>(null);
  const [showFormatConfirm, setShowFormatConfirm] = useState(false);

  const [pendingWin, setPendingWin] = useState<{ gameId: string; teamId: string } | null>(null);

  const [divisionPickerOpen, setDivisionPickerOpen] = useState(false);

  const selectedDivisionName = useMemo(() => {
    if (!selectedDivisionId) return "";
    return divisions.find((d) => d.id === selectedDivisionId)?.name ?? "";
  }, [divisions, selectedDivisionId]);

  const selectedBoard = useMemo(() => {
    if (!selectedDivisionId) return null;
    return boardsByDivision[selectedDivisionId] ?? null;
  }, [boardsByDivision, selectedDivisionId]);

  const currentMode: BoardMode = useMemo(() => {
    const m = selectedBoard?.board_json?.mode;
    return m === "FREEFORM" ? "FREEFORM" : "BRACKET";
  }, [selectedBoard]);

  const seedsLocked = useMemo(() => {
    return selectedBoard?.board_json?.seeds_locked === true;
  }, [selectedBoard]);

  const currentFormat: BracketFormat = useMemo(() => {
    const f = selectedBoard?.board_json?.format;
    return f === "DOUBLE" ? "DOUBLE" : "SINGLE";
  }, [selectedBoard]);

  const overrideModeOn = useMemo(() => {
    return selectedBoard?.board_json?.override_mode === true;
  }, [selectedBoard]);

  const displayTeams = useMemo(() => {
    if (seedsLocked) {
      const seedIds: string[] = Array.isArray(selectedBoard?.board_json?.seeds)
        ? (selectedBoard?.board_json?.seeds as string[])
        : [];

      if (!seedIds.length) return teams;

      const map = new Map<string, TeamRow>();
      teams.forEach((t) => map.set(t.id, t));

      const ordered: TeamRow[] = [];
      seedIds.forEach((id) => {
        const t = map.get(id);
        if (t) ordered.push(t);
      });

      teams.forEach((t) => {
        if (!seedIds.includes(t.id)) ordered.push(t);
      });

      return ordered;
    }

    return teams;
  }, [teams, seedsLocked, selectedBoard]);

  const currentBracket = useMemo(() => {
    const b = selectedBoard?.board_json?.bracket;
    return b ?? null;
  }, [selectedBoard]);

  const load = useCallback(
    async (overrideDivisionId?: string | null) => {
      try {
        setLoading(true);

        const settingsRes = await supabase
          .from("app_settings")
          .select("current_season_id,playoff_mode")
          .limit(1)
          .maybeSingle();

        const sid = settingsRes.data?.current_season_id ?? null;
        setSeasonId(sid);

        if (!sid) {
          setSeasonName(null);
          setDivisions([]);
          setBoardsByDivision({});
          setSelectedDivisionId(null);
          setTeams([]);
          return;
        }

        const seasonRes = await supabase.from("seasons").select("name").eq("id", sid).maybeSingle();
        setSeasonName(seasonRes.data?.name ?? null);

        const divRes = await supabase.from("divisions").select("id,name").eq("season_id", sid).order("name");
        const divs = (divRes.data ?? []) as DivisionRow[];
        setDivisions(divs);

        const boardsRes = await supabase
          .from("playoff_boards")
          .select("division_id,board_json,updated_at")
          .eq("season_id", sid);

        const rows = (boardsRes.data ?? []) as BoardRow[];
        const map: Record<string, BoardRow> = {};
        for (const r of rows) map[r.division_id] = r;
        setBoardsByDivision(map);

        let nextDivisionId: string | null =
          typeof overrideDivisionId !== "undefined" ? overrideDivisionId : selectedDivisionId;

        if (!nextDivisionId) {
          nextDivisionId = divs[0]?.id ?? null;
        } else {
          const stillThere = divs.some((d) => d.id === nextDivisionId);
          if (!stillThere) nextDivisionId = divs[0]?.id ?? null;
        }

        setSelectedDivisionId(nextDivisionId);

        if (nextDivisionId) {
          const { data: teamRows, error: teamErr } = await supabase
            .from("teams")
            .select("id,team_name,is_active,division")
            .eq("season_id", sid)
            .eq("division", nextDivisionId)
            .eq("is_active", true);

          if (teamErr) {
            console.log("teams load error:", teamErr.message);
            setTeams([]);
          } else {
            const teamsInDiv = (teamRows ?? []) as Array<{
              id: string;
              team_name: string;
              is_active: boolean;
              division: string;
            }>;

            if (!teamsInDiv.length) {
              setTeams([]);
            } else {
              const { data: matchRows, error: matchErr } = await supabase
                .from("matches")
                .select("id,team_a_id,team_b_id")
                .eq("season_id", sid);

              if (matchErr) {
                console.log("matches load error:", matchErr.message);
                setTeams(
                  [...teamsInDiv]
                    .sort((a, b) => (a.team_name || "").localeCompare(b.team_name || ""))
                    .map((t) => ({ id: t.id, team_name: t.team_name }))
                );
              } else {
                const matches = (matchRows ?? []) as Array<{
                  id: string;
                  team_a_id: string | null;
                  team_b_id: string | null;
                }>;

                const matchIdList = matches.map((m) => m.id);
                const matchById: Record<string, { team_a_id: string | null; team_b_id: string | null }> = {};
                for (const m of matches) matchById[m.id] = { team_a_id: m.team_a_id, team_b_id: m.team_b_id };

                let scoreRows: Array<{
                  match_id: string;
                  team_a: any;
                  team_b: any;
                  verified: boolean | null;
                }> = [];

                if (matchIdList.length) {
                  const { data: scores, error: scoreErr } = await supabase
                    .from("match_scores")
                    .select("match_id,team_a,team_b,verified")
                    .in("match_id", matchIdList);

                  if (scoreErr) console.log("match_scores load error:", scoreErr.message);
                  else scoreRows = (scores ?? []) as any;
                }

                const stats: Record<
                  string,
                  { id: string; team_name: string; gamesPlayed: number; wins: number; losses: number; pointsFor: number; pointsAgainst: number }
                > = {};

                for (const t of teamsInDiv) {
                  stats[t.id] = {
                    id: t.id,
                    team_name: (t.team_name ?? "Team").trim() || "Team",
                    gamesPlayed: 0,
                    wins: 0,
                    losses: 0,
                    pointsFor: 0,
                    pointsAgainst: 0,
                  };
                }

                for (const s of scoreRows) {
                  const m = matchById[String(s.match_id)];
                  if (!m) continue;
                  if (!s.verified) continue;

                  const aId = m.team_a_id;
                  const bId = m.team_b_id;
                  if (!aId || !bId) continue;
                  if (!stats[aId] || !stats[bId]) continue;

                  const a = asScoreFields(s.team_a);
                  const b = asScoreFields(s.team_b);

                  const aRaw = [a.g1, a.g2, a.g3];
                  const bRaw = [b.g1, b.g2, b.g3];

                  for (let i = 0; i < 3; i++) {
                    if (!gameEnteredPair(aRaw[i], bRaw[i])) continue;

                    const ap = toN(aRaw[i]);
                    const bp = toN(bRaw[i]);

                    stats[aId].gamesPlayed += 1;
                    stats[bId].gamesPlayed += 1;

                    stats[aId].pointsFor += ap;
                    stats[aId].pointsAgainst += bp;

                    stats[bId].pointsFor += bp;
                    stats[bId].pointsAgainst += ap;

                    if (ap > bp) {
                      stats[aId].wins += 1;
                      stats[bId].losses += 1;
                    } else if (bp > ap) {
                      stats[bId].wins += 1;
                      stats[aId].losses += 1;
                    }
                  }
                }

                const ordered = Object.values(stats)
                  .sort((x, y) => {
                    const xZero = x.gamesPlayed === 0;
                    const yZero = y.gamesPlayed === 0;
                    if (xZero !== yZero) return xZero ? 1 : -1;

                    if (y.wins !== x.wins) return y.wins - x.wins;
                    if (x.losses !== y.losses) return x.losses - y.losses;
                    if (y.pointsFor !== x.pointsFor) return y.pointsFor - x.pointsFor;
                    if (x.pointsAgainst !== y.pointsAgainst) return x.pointsAgainst - y.pointsAgainst;

                    return (x.team_name || "").localeCompare(y.team_name || "");
                  })
                  .map((t) => ({ id: t.id, team_name: t.team_name }));

                setTeams(ordered);
              }
            }
          }
        } else {
          setTeams([]);
        }
      } finally {
        setLoading(false);
        setSavingMode(false);
      }
    },
    [selectedDivisionId]
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const openDivisionPicker = () => {
    if (!divisions.length) return;
    setDivisionPickerOpen(true);
  };

  const pickDivision = (divisionId: string) => {
    setDivisionPickerOpen(false);
    load(divisionId);
  };

  const setMode = async (mode: BoardMode) => {
    if (!isAdminUnlocked) return;
    if (!seasonId || !selectedDivisionId) return;

    setSavingMode(true);

    const existing = boardsByDivision[selectedDivisionId]?.board_json ?? {};
    const nextJson = { ...existing, mode };

    const { error } = await supabase
      .from("playoff_boards")
      .update({ board_json: nextJson })
      .eq("season_id", seasonId)
      .eq("division_id", selectedDivisionId);

    if (error) {
      console.log("setMode update error:", error.message);
      setSavingMode(false);
      return;
    }

    setBoardsByDivision((prev) => ({
      ...prev,
      [selectedDivisionId]: {
        division_id: selectedDivisionId,
        board_json: nextJson,
        updated_at: new Date().toISOString(),
      },
    }));

    setSavingMode(false);
  };

  const setFormat = async (format: BracketFormat) => {
    if (!isAdminUnlocked) return;
    if (!seasonId || !selectedDivisionId) return;
    if (format === currentFormat) return;

    setSavingMode(true);
    setPendingFormat(format);
    setShowFormatConfirm(true);
  };

  const confirmSetFormat = async () => {
    if (!isAdminUnlocked) return;
    if (!seasonId || !selectedDivisionId) return;
    if (!pendingFormat) return;

    setSavingMode(true);

    try {
      const existing = boardsByDivision[selectedDivisionId]?.board_json ?? {};
      const nextJson = {
        ...existing,
        format: pendingFormat,
        bracket: null,
        overrides: null,
      };

      const { error } = await supabase
        .from("playoff_boards")
        .update({ board_json: nextJson })
        .eq("season_id", seasonId)
        .eq("division_id", selectedDivisionId);

      if (error) {
        console.log("confirmSetFormat update error:", error.message);
        return;
      }

      setBoardsByDivision((prev) => ({
        ...prev,
        [selectedDivisionId]: {
          division_id: selectedDivisionId,
          board_json: nextJson,
          updated_at: new Date().toISOString(),
        },
      }));

      setPendingFormat(null);
      setShowFormatConfirm(false);
    } finally {
      setSavingMode(false);
    }
  };

  const cancelSetFormat = () => {
    setSavingMode(false);
    setPendingFormat(null);
    setShowFormatConfirm(false);
  };

  const toggleOverrideMode = async () => {
    if (!isAdminUnlocked) return;
    if (!seasonId || !selectedDivisionId) return;

    setSavingMode(true);

    const existing = boardsByDivision[selectedDivisionId]?.board_json ?? {};
    const nextJson = { ...existing, override_mode: !(existing?.override_mode === true) };

    const { error } = await supabase
      .from("playoff_boards")
      .update({ board_json: nextJson })
      .eq("season_id", seasonId)
      .eq("division_id", selectedDivisionId);

    if (error) {
      console.log("toggleOverrideMode update error:", error.message);
      setSavingMode(false);
      return;
    }

    setBoardsByDivision((prev) => ({
      ...prev,
      [selectedDivisionId]: {
        division_id: selectedDivisionId,
        board_json: nextJson,
        updated_at: new Date().toISOString(),
      },
    }));

    setSavingMode(false);
  };

  // ✅ Override Panel uses THIS to save bracket edits
  const saveBracketOverride = async (nextBracket: any) => {
    if (!isAdminUnlocked) return;
    if (!seasonId || !selectedDivisionId) return;

    setSavingMode(true);
    try {
      const existing = boardsByDivision[selectedDivisionId]?.board_json ?? {};
      const nextJson = { ...existing, bracket: nextBracket };

      const { error } = await supabase
        .from("playoff_boards")
        .update({ board_json: nextJson })
        .eq("season_id", seasonId)
        .eq("division_id", selectedDivisionId);

      if (error) {
        console.log("saveBracketOverride update error:", error.message);
        return;
      }

      setBoardsByDivision((prev) => ({
        ...prev,
        [selectedDivisionId]: {
          division_id: selectedDivisionId,
          board_json: nextJson,
          updated_at: new Date().toISOString(),
        },
      }));
    } finally {
      setSavingMode(false);
    }
  };

  const getMatchLabel = (gameId: string) => {
    const p = parseGameId(gameId);
    if (p.kind === "W") return `Round ${p.roundNum} - Match ${p.matchStr}`;
    if (p.kind === "L") return `Losers R${p.roundNum} - Match ${p.matchStr}`;
    if (p.kind === "GF") return p.roundNum === 1 ? "Grand Final (GF1)" : "Grand Final Reset (GF2)";
    return "Match";
  };

  const getSeedNum = (teamId: string | null) => {
    if (!teamId) return 0;
    const idx = displayTeams.findIndex((t) => t.id === teamId);
    return idx >= 0 ? idx + 1 : 0;
  };

  const getTeamDisplayName = (teamId: string | null, emptyLabel: string) => {
    if (!teamId) return emptyLabel;
    const seedNum = getSeedNum(teamId);
    const name = displayTeams.find((t) => t.id === teamId)?.team_name ?? "Team";
    return seedNum ? `(${seedNum}) ${name}` : name;
  };

  const getWinnersMaxRound = useMemo(() => {
    const w = currentBracket?.winners ?? null;
    if (!w) return 0;
    const keys = Object.keys(w);
    let max = 0;
    for (const k of keys) {
      if (!k.startsWith("round")) continue;
      const n = parseInt(k.replace("round", ""), 10);
      if (Number.isFinite(n)) max = Math.max(max, n);
    }
    return max;
  }, [currentBracket]);

  const getLosersMaxRound = useMemo(() => {
    const l = currentBracket?.losers ?? null;
    if (!l) return 0;
    const keys = Object.keys(l);
    let max = 0;
    for (const k of keys) {
      if (!k.startsWith("round")) continue;
      const n = parseInt(k.replace("round", ""), 10);
      if (Number.isFinite(n)) max = Math.max(max, n);
    }
    return max;
  }, [currentBracket]);

  const getLosersDropTarget = (winnersRound: number, winnersMatchIndex: number) => {
    if (winnersRound === 1) {
      const targetMatchIndex = Math.floor(winnersMatchIndex / 2);
      const targetSide = winnersMatchIndex % 2 === 0 ? "a" : "b";
      return { losersRound: 1, targetMatchIndex, targetSide };
    }
    const losersRound = 2 * winnersRound - 2;
    return { losersRound, targetMatchIndex: winnersMatchIndex, targetSide: "b" as "a" | "b" };
  };

  const advanceLosersWinner = (losersRound: number, losersMatchIndex: number) => {
    const nextRound = losersRound + 1;
    if (losersRound % 2 === 1) {
      return { nextRound, targetMatchIndex: losersMatchIndex, targetSide: "a" as "a" | "b" };
    }
    return {
      nextRound,
      targetMatchIndex: Math.floor(losersMatchIndex / 2),
      targetSide: losersMatchIndex % 2 === 0 ? ("a" as const) : ("b" as const),
    };
  };

  const getBracketWinnerTeamId = (winnersObj: any, winnersMax: number) => {
    if (!winnersObj || !winnersMax) return null;
    const last = winnersObj[`round${winnersMax}`] as any[] | undefined;
    if (!Array.isArray(last) || !last[0]) return null;
    return last[0]?.winnerId ?? null;
  };

  const getLosersChampionTeamId = (losersObj: any, losersMax: number) => {
    if (!losersObj || !losersMax) return null;
    const last = losersObj[`round${losersMax}`] as any[] | undefined;
    if (!Array.isArray(last) || !last[0]) return null;
    return last[0]?.winnerId ?? null;
  };

  const undoWinner = async (gameId: string) => {
    if (!isAdminUnlocked) return;
    if (!seasonId || !selectedDivisionId) return;
    if (!currentBracket) return;
    if (!gameId) return;

    setSavingMode(true);

    try {
      const existing = boardsByDivision[selectedDivisionId]?.board_json ?? {};
      const bracket = existing?.bracket ?? null;

      const p = parseGameId(gameId);
      if (p.kind === "UNKNOWN") return;

      const nextBracket = { ...(bracket ?? {}) };
      const nextWinners = { ...(nextBracket?.winners ?? {}) };
      const nextLosers = { ...(nextBracket?.losers ?? {}) };
      const nextFinals = { ...(nextBracket?.finals ?? {}) };

      const clearFinalsFrom = () => {
        if (nextFinals?.gf1) nextFinals.gf1 = { ...nextFinals.gf1, winnerId: null };
        if (nextFinals?.gf2) nextFinals.gf2 = null;
      };

      const clearDownstreamWinners = (startRound: number, startMatchIndex: number, clearedTeamId: string | null) => {
        let prevMatchIndex = startMatchIndex;
        let cleared = clearedTeamId;

        for (let r = startRound + 1; r <= 64; r++) {
          const rk = `round${r}`;
          const arr = nextWinners[rk] as any[] | undefined;
          if (!Array.isArray(arr)) break;

          const nextArr = arr.map((m: any) => ({ ...m }));
          const targetMatchIndex = Math.floor(prevMatchIndex / 2);
          const targetSide = prevMatchIndex % 2 === 0 ? "a" : "b";

          if (!nextArr[targetMatchIndex]) {
            nextWinners[rk] = nextArr;
            break;
          }

          const before = nextArr[targetMatchIndex];
          const beforeSlot = before?.[targetSide] ?? {};
          const beforeSlotTeamId = beforeSlot?.teamId ?? null;

          nextArr[targetMatchIndex] = {
            ...before,
            [targetSide]: { ...beforeSlot, teamId: null },
          };

          const after = nextArr[targetMatchIndex];
          const aId = after?.a?.teamId ?? null;
          const bId = after?.b?.teamId ?? null;
          const wId = after?.winnerId ?? null;

          const nowMissingSide = !aId || !bId;

          if (wId && (nowMissingSide || (cleared && wId === cleared))) {
            cleared = wId;
            nextArr[targetMatchIndex] = { ...after, winnerId: null };
          } else if (wId && beforeSlotTeamId && wId === beforeSlotTeamId) {
            cleared = wId;
            nextArr[targetMatchIndex] = { ...after, winnerId: null };
          } else {
            nextWinners[rk] = nextArr;
            break;
          }

          nextWinners[rk] = nextArr;
          prevMatchIndex = targetMatchIndex;
        }
      };

      const clearDownstreamLosers = (startRound: number, startMatchIndex: number, clearedTeamId: string | null) => {
        let prevRound = startRound;
        let prevMatchIndex = startMatchIndex;
        let cleared = clearedTeamId;

        for (let r = prevRound + 1; r <= 128; r++) {
          const rk = `round${r}`;
          const arr = nextLosers[rk] as any[] | undefined;
          if (!Array.isArray(arr)) break;

          const nextArr = arr.map((m: any) => ({ ...m }));

          const exact = advanceLosersWinner(prevRound, prevMatchIndex);
          if (exact.nextRound !== r) {
            prevRound = exact.nextRound - 1;
            continue;
          }

          const targetMatchIndex = exact.targetMatchIndex;
          const targetSide = exact.targetSide;

          if (!nextArr[targetMatchIndex]) {
            nextLosers[rk] = nextArr;
            break;
          }

          const before = nextArr[targetMatchIndex];
          const beforeSlot = before?.[targetSide] ?? {};
          const beforeSlotTeamId = beforeSlot?.teamId ?? null;

          nextArr[targetMatchIndex] = {
            ...before,
            [targetSide]: { ...beforeSlot, teamId: null },
          };

          const after = nextArr[targetMatchIndex];
          const aId = after?.a?.teamId ?? null;
          const bId = after?.b?.teamId ?? null;
          const wId = after?.winnerId ?? null;

          const nowMissingSide = !aId || !bId;

          if (wId && (nowMissingSide || (cleared && wId === cleared))) {
            cleared = wId;
            nextArr[targetMatchIndex] = { ...after, winnerId: null };
          } else if (wId && beforeSlotTeamId && wId === beforeSlotTeamId) {
            cleared = wId;
            nextArr[targetMatchIndex] = { ...after, winnerId: null };
          } else {
            nextLosers[rk] = nextArr;
            break;
          }

          nextLosers[rk] = nextArr;
          prevRound = r;
          prevMatchIndex = targetMatchIndex;
        }
      };

      if (p.kind === "W") {
        const roundKey = `round${p.roundNum}`;
        const roundArr = nextWinners[roundKey] as any[] | undefined;
        if (!Array.isArray(roundArr)) return;

        const match = roundArr[p.matchIndex];
        if (!match) return;

        const prevWinnerId = match?.winnerId ?? null;
        const aId = match?.a?.teamId ?? null;
        const bId = match?.b?.teamId ?? null;

        nextWinners[roundKey] = roundArr.map((m: any, idx: number) => (idx !== p.matchIndex ? m : { ...m, winnerId: null }));
        clearDownstreamWinners(p.roundNum, p.matchIndex, prevWinnerId);

        if (currentFormat === "DOUBLE") {
          const hadTwoTeams = !!aId && !!bId;
          const prevLoserId = hadTwoTeams
            ? prevWinnerId === aId
              ? bId
              : prevWinnerId === bId
              ? aId
              : null
            : null;

          if (prevLoserId) {
            const drop = getLosersDropTarget(p.roundNum, p.matchIndex);
            const lrKey = `round${drop.losersRound}`;
            const lrArr = nextLosers[lrKey] as any[] | undefined;

            if (Array.isArray(lrArr) && lrArr[drop.targetMatchIndex]) {
              const before = lrArr[drop.targetMatchIndex];
              const beforeSlot = before?.[drop.targetSide] ?? {};
              if ((beforeSlot?.teamId ?? null) === prevLoserId) {
                nextLosers[lrKey] = lrArr.map((m: any, idx: number) => {
                  if (idx !== drop.targetMatchIndex) return m;
                  return {
                    ...m,
                    [drop.targetSide]: { ...(m?.[drop.targetSide] ?? {}), teamId: null },
                    winnerId: null,
                  };
                });
                clearDownstreamLosers(drop.losersRound, drop.targetMatchIndex, null);
              }
            }
          }

          clearFinalsFrom();
        }
      }

      if (p.kind === "L") {
        const roundKey = `round${p.roundNum}`;
        const roundArr = nextLosers[roundKey] as any[] | undefined;
        if (!Array.isArray(roundArr)) return;

        const match = roundArr[p.matchIndex];
        if (!match) return;

        const prevWinnerId = match?.winnerId ?? null;

        nextLosers[roundKey] = roundArr.map((m: any, idx: number) => (idx !== p.matchIndex ? m : { ...m, winnerId: null }));
        clearDownstreamLosers(p.roundNum, p.matchIndex, prevWinnerId);
        clearFinalsFrom();
      }

      if (p.kind === "GF") {
        if (p.roundNum === 1 && nextFinals?.gf1) {
          nextFinals.gf1 = { ...nextFinals.gf1, winnerId: null };
          nextFinals.gf2 = null;
        }
        if (p.roundNum === 2) nextFinals.gf2 = null;
      }

      nextBracket.winners = nextWinners;
      if (currentFormat === "DOUBLE") nextBracket.losers = nextLosers;
      nextBracket.finals = nextFinals;

      const nextJson = { ...existing, bracket: nextBracket };

      const { error } = await supabase
        .from("playoff_boards")
        .update({ board_json: nextJson })
        .eq("season_id", seasonId)
        .eq("division_id", selectedDivisionId);

      if (error) {
        console.log("undoWinner update error:", error.message);
        return;
      }

      setBoardsByDivision((prev) => ({
        ...prev,
        [selectedDivisionId]: {
          division_id: selectedDivisionId,
          board_json: nextJson,
          updated_at: new Date().toISOString(),
        },
      }));

      setPendingWin(null);
    } finally {
      setSavingMode(false);
    }
  };

  const confirmWinner = async () => {
    if (!isAdminUnlocked) return;
    if (!seasonId || !selectedDivisionId) return;
    if (!pendingWin) return;
    if (!currentBracket) return;

    setSavingMode(true);

    try {
      const existing = boardsByDivision[selectedDivisionId]?.board_json ?? {};
      const bracket = existing?.bracket ?? null;

      const p = parseGameId(pendingWin.gameId ?? "");
      if (p.kind === "UNKNOWN") return;

      const nextBracket = { ...(bracket ?? {}) };
      const nextWinners = { ...(nextBracket?.winners ?? {}) };
      const nextLosers = { ...(nextBracket?.losers ?? {}) };
      const nextFinals = { ...(nextBracket?.finals ?? {}) };

      const setGFTeamsIfPossible = () => {
        if (currentFormat !== "DOUBLE") return;
        if (!nextFinals?.gf1) return;

        const wbChamp = getBracketWinnerTeamId(nextWinners, getWinnersMaxRound);
        const lbChamp = getLosersChampionTeamId(nextLosers, getLosersMaxRound);

        const gf1 = nextFinals.gf1;
        nextFinals.gf1 = {
          ...gf1,
          a: { ...(gf1?.a ?? {}), teamId: wbChamp ?? gf1?.a?.teamId ?? null },
          b: { ...(gf1?.b ?? {}), teamId: lbChamp ?? gf1?.b?.teamId ?? null },
        };
      };

      if (p.kind === "W") {
        const winners = nextWinners;
        const roundKey = `round${p.roundNum}`;
        const nextRoundKey = `round${p.roundNum + 1}`;

        const roundArr = winners[roundKey] as any[] | undefined;
        if (!Array.isArray(roundArr)) return;

        const match = roundArr[p.matchIndex];
        if (!match) return;

        const aId = match?.a?.teamId ?? null;
        const bId = match?.b?.teamId ?? null;

        winners[roundKey] = roundArr.map((m: any, idx: number) => (idx !== p.matchIndex ? m : { ...m, winnerId: pendingWin.teamId }));

        const nextArr = winners[nextRoundKey] as any[] | undefined;
        if (Array.isArray(nextArr)) {
          const copy = nextArr.map((m: any) => ({ ...m }));
          const targetMatchIndex = Math.floor(p.matchIndex / 2);
          const targetSide = p.matchIndex % 2 === 0 ? "a" : "b";
          if (copy[targetMatchIndex]) {
            copy[targetMatchIndex] = {
              ...copy[targetMatchIndex],
              [targetSide]: { ...(copy[targetMatchIndex]?.[targetSide] ?? {}), teamId: pendingWin.teamId },
            };
            winners[nextRoundKey] = copy;
          }
        }

        if (currentFormat === "DOUBLE") {
          const hadTwoTeams = !!aId && !!bId;
          if (hadTwoTeams) {
            const loserId = pendingWin.teamId === aId ? bId : pendingWin.teamId === bId ? aId : null;

            if (loserId) {
              const drop = getLosersDropTarget(p.roundNum, p.matchIndex);
              const lrKey = `round${drop.losersRound}`;
              const lrArr = nextLosers[lrKey] as any[] | undefined;

              if (Array.isArray(lrArr) && lrArr[drop.targetMatchIndex]) {
                const copy = lrArr.map((m: any) => ({ ...m }));
                const target = copy[drop.targetMatchIndex];
                copy[drop.targetMatchIndex] = {
                  ...target,
                  [drop.targetSide]: { ...(target?.[drop.targetSide] ?? {}), teamId: loserId },
                };
                nextLosers[lrKey] = copy;
              }
            }
          }
        }

        setGFTeamsIfPossible();
      }

      if (p.kind === "L") {
        if (currentFormat !== "DOUBLE") return;

        const losers = nextLosers;
        const roundKey = `round${p.roundNum}`;
        const nextRoundKey = `round${p.roundNum + 1}`;

        const roundArr = losers[roundKey] as any[] | undefined;
        if (!Array.isArray(roundArr)) return;

        losers[roundKey] = roundArr.map((m: any, idx: number) => (idx !== p.matchIndex ? m : { ...m, winnerId: pendingWin.teamId }));

        const adv = advanceLosersWinner(p.roundNum, p.matchIndex);
        const nextArr = losers[nextRoundKey] as any[] | undefined;
        if (Array.isArray(nextArr)) {
          const copy = nextArr.map((m: any) => ({ ...m }));
          if (copy[adv.targetMatchIndex]) {
            copy[adv.targetMatchIndex] = {
              ...copy[adv.targetMatchIndex],
              [adv.targetSide]: {
                ...(copy[adv.targetMatchIndex]?.[adv.targetSide] ?? {}),
                teamId: pendingWin.teamId,
              },
            };
            losers[nextRoundKey] = copy;
          }
        }

        setGFTeamsIfPossible();
      }

      if (p.kind === "GF") {
        if (currentFormat !== "DOUBLE") return;
        if (!nextFinals?.gf1) return;

        if (p.roundNum === 1) {
          nextFinals.gf1 = { ...nextFinals.gf1, winnerId: pendingWin.teamId };

          const wbChamp = getBracketWinnerTeamId(nextWinners, getWinnersMaxRound);
          const lbChamp = getLosersChampionTeamId(nextLosers, getLosersMaxRound);

          if (lbChamp && pendingWin.teamId === lbChamp && wbChamp && wbChamp !== lbChamp) {
            nextFinals.gf2 = {
              a: { teamId: wbChamp, winnerId: null },
              b: { teamId: lbChamp, winnerId: null },
              gameId: "GF2",
              winnerId: null,
            };
          } else {
            nextFinals.gf2 = null;
          }
        }

        if (p.roundNum === 2 && nextFinals?.gf2) {
          nextFinals.gf2 = { ...nextFinals.gf2, winnerId: pendingWin.teamId };
        }
      }

      nextBracket.winners = nextWinners;
      if (currentFormat === "DOUBLE") nextBracket.losers = nextLosers;
      nextBracket.finals = nextFinals;

      const nextJson = { ...existing, bracket: nextBracket };

      const { error } = await supabase
        .from("playoff_boards")
        .update({ board_json: nextJson })
        .eq("season_id", seasonId)
        .eq("division_id", selectedDivisionId);

      if (error) {
        console.log("confirmWinner update error:", error.message);
        return;
      }

      setBoardsByDivision((prev) => ({
        ...prev,
        [selectedDivisionId]: {
          division_id: selectedDivisionId,
          board_json: nextJson,
          updated_at: new Date().toISOString(),
        },
      }));

      setPendingWin(null);
    } finally {
      setSavingMode(false);
    }
  };

  const generateBracket = async () => {
    if (!isAdminUnlocked) return;
    if (!seasonId || !selectedDivisionId) return;
    if (!seedsLocked) return;
    if (currentBracket) return;

    setSavingMode(true);

    const existing = boardsByDivision[selectedDivisionId]?.board_json ?? {};
    const teamCount = displayTeams.length;
    const makeSlot = () => ({ teamId: null as string | null, winnerId: null as string | null });

    let bracketSize = 1;
    while (bracketSize < teamCount) bracketSize *= 2;

    const round1MatchCount = bracketSize / 2;

    const winnersRound1Slots = Array.from({ length: round1MatchCount }).map(() => ({
      a: makeSlot(),
      b: makeSlot(),
      gameId: null as string | null,
      winnerId: null as string | null,
    }));

    const buildSeedOrder = (size: number) => {
      let order = [1, 2];
      while (order.length < size) {
        const next: number[] = [];
        const sum = order.length * 2 + 1;
        for (const s of order) {
          next.push(s);
          next.push(sum - s);
        }
        order = next;
      }
      return order;
    };

    const seedOrder = buildSeedOrder(bracketSize);

    for (let m = 0; m < winnersRound1Slots.length; m++) {
      const aSeed = seedOrder[m * 2] ?? null;
      const bSeed = seedOrder[m * 2 + 1] ?? null;

      const a = aSeed ? displayTeams[aSeed - 1]?.id ?? null : null;
      const b = bSeed ? displayTeams[bSeed - 1]?.id ?? null : null;

      winnersRound1Slots[m].a.teamId = a;
      winnersRound1Slots[m].b.teamId = b;
      winnersRound1Slots[m].gameId = `W1-${m + 1}`;
    }

    const maxRound = Math.log2(bracketSize);

    const makeRound = (prefix: "W" | "L", roundNum: number, matchCount: number) =>
      Array.from({ length: matchCount }).map((_, i) => ({
        a: makeSlot(),
        b: makeSlot(),
        gameId: `${prefix}${roundNum}-${i + 1}`,
        winnerId: null as string | null,
      }));

    const winnersRounds: any = {
      round1: winnersRound1Slots,
      round2: makeRound("W", 2, bracketSize / 4),
    };

    for (let r = 3; r <= maxRound; r++) {
      const matchCount = bracketSize / Math.pow(2, r);
      winnersRounds[`round${r}`] = makeRound("W", r, matchCount);
    }

    const winnersRound2Slots = winnersRounds.round2 as any[];

    for (let i = 0; i < winnersRound1Slots.length; i++) {
      const aId = winnersRound1Slots[i]?.a?.teamId ?? null;
      const bId = winnersRound1Slots[i]?.b?.teamId ?? null;

      const hasA = !!aId;
      const hasB = !!bId;

      if (hasA && !hasB) {
        winnersRound1Slots[i].winnerId = aId;
        const r2i = Math.floor(i / 2);
        const side = i % 2 === 0 ? "a" : "b";
        if (winnersRound2Slots[r2i]) winnersRound2Slots[r2i][side].teamId = aId;
      } else if (!hasA && hasB) {
        winnersRound1Slots[i].winnerId = bId;
        const r2i = Math.floor(i / 2);
        const side = i % 2 === 0 ? "a" : "b";
        if (winnersRound2Slots[r2i]) winnersRound2Slots[r2i][side].teamId = bId;
      }
    }

    const losersRounds: any = {};
    if (currentFormat === "DOUBLE") {
      const losersMax = 2 * maxRound - 2;
      for (let lr = 1; lr <= losersMax; lr++) {
        const group = Math.floor((lr + 1) / 2);
        const matchCount = bracketSize / Math.pow(2, group + 1);
        losersRounds[`round${lr}`] = makeRound("L", lr, matchCount);
      }
    }

    const bracket =
      currentFormat === "DOUBLE"
        ? {
            format: "DOUBLE",
            winners: winnersRounds,
            losers: losersRounds,
            finals: { gf1: { a: makeSlot(), b: makeSlot(), gameId: "GF1", winnerId: null }, gf2: null as any },
          }
        : {
            format: "SINGLE",
            winners: winnersRounds,
            finals: { gf1: null as any, gf2: null as any },
          };

    const nextJson = { ...existing, bracket };

    const { error } = await supabase
      .from("playoff_boards")
      .update({ board_json: nextJson })
      .eq("season_id", seasonId)
      .eq("division_id", selectedDivisionId);

    if (error) {
      console.log("generateBracket update error:", error.message);
      setSavingMode(false);
      return;
    }

    setBoardsByDivision((prev) => ({
      ...prev,
      [selectedDivisionId]: {
        division_id: selectedDivisionId,
        board_json: nextJson,
        updated_at: new Date().toISOString(),
      },
    }));

    setSavingMode(false);
  };

  const toggleSeedsLock = async () => {
    if (!isAdminUnlocked) return;
    if (!seasonId || !selectedDivisionId) return;

    setSavingMode(true);

    const existing = boardsByDivision[selectedDivisionId]?.board_json ?? {};

    const nextJson = seedsLocked
      ? { ...existing, seeds_locked: false }
      : { ...existing, seeds_locked: true, seeds: displayTeams.map((t) => t.id) };

    const { error } = await supabase
      .from("playoff_boards")
      .update({ board_json: nextJson })
      .eq("season_id", seasonId)
      .eq("division_id", selectedDivisionId);

    if (error) {
      console.log("toggleSeedsLock update error:", error.message);
      setSavingMode(false);
      return;
    }

    setBoardsByDivision((prev) => ({
      ...prev,
      [selectedDivisionId]: {
        division_id: selectedDivisionId,
        board_json: nextJson,
        updated_at: new Date().toISOString(),
      },
    }));

    setSavingMode(false);
  };

  const renderRoundCards = (kind: "W" | "L" | "GF", roundNum: number) => {
    if (!currentBracket) return null;

    let arr: any[] | null = null;

    if (kind === "W") {
      const w = currentBracket?.winners ?? null;
      const key = `round${roundNum}`;
      arr = w ? ((w as any)[key] as any[] | undefined) ?? null : null;
    } else if (kind === "L") {
      const l = currentBracket?.losers ?? null;
      const key = `round${roundNum}`;
      arr = l ? ((l as any)[key] as any[] | undefined) ?? null : null;
    } else {
      const f = currentBracket?.finals ?? null;
      const gf = roundNum === 1 ? f?.gf1 : f?.gf2;
      arr = gf ? [gf] : null;
    }

    if (!arr) return null;

    return (
      <View style={{ marginTop: 10 }}>
        {arr
          .filter((m: any) => {
            const aId = m?.a?.teamId ?? null;
            const bId = m?.b?.teamId ?? null;
            return !!aId || !!bId;
          })
          .map((m: any, idx: number) => {
            const aId = m?.a?.teamId ?? null;
            const bId = m?.b?.teamId ?? null;
            const winnerId = m?.winnerId ?? null;

            const aName =
              kind === "W" && roundNum === 1 ? getTeamDisplayName(aId, "BYE") : getTeamDisplayName(aId, "TBD");

            const bName =
              kind === "W" && roundNum === 1 ? getTeamDisplayName(bId, "BYE") : getTeamDisplayName(bId, "TBD");

            const waitingText =
              !aId || !bId
                ? kind === "W"
                  ? roundNum === 1
                    ? "BYE slot"
                    : `Waiting for Round ${roundNum - 1} winners`
                  : kind === "L"
                  ? "Waiting for losers drop / LB winners"
                  : "Waiting for finalists"
                : null;

            return (
              <View key={m?.gameId ?? `${kind}${roundNum}-${idx}`} style={[styles.matchCard, winnerId ? styles.matchCardWinner : null]}>
                <Text style={styles.matchLabel}>{getMatchLabel(m?.gameId ?? "")}</Text>

                <Pressable
                  style={[styles.matchTeamRow, winnerId && aId && winnerId === aId ? styles.winnerRow : null]}
                  disabled={!isAdminUnlocked || !aId}
                  onPress={() => {
                    if (!m?.gameId || !aId) return;
                    setPendingWin({ gameId: m.gameId, teamId: aId });
                  }}
                >
                  <Text
                    style={[styles.matchTeamText, winnerId && aId && winnerId === aId ? styles.matchTeamWinnerText : null]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {aName}
                  </Text>
                </Pressable>

                <Text style={styles.vsText}>vs</Text>

                <Pressable
                  style={[styles.matchTeamRow, winnerId && bId && winnerId === bId ? styles.winnerRow : null]}
                  disabled={!isAdminUnlocked || !bId}
                  onPress={() => {
                    if (!m?.gameId || !bId) return;
                    setPendingWin({ gameId: m.gameId, teamId: bId });
                  }}
                >
                  <Text
                    style={[styles.matchTeamText, winnerId && bId && winnerId === bId ? styles.matchTeamWinnerText : null]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {bName}
                  </Text>
                </Pressable>

                {waitingText ? <Text style={styles.byeNote}>{waitingText}</Text> : null}

                {winnerId ? <Text style={{ marginTop: 8, fontWeight: "900", color: "#16a34a" }}>WINNER SELECTED</Text> : null}

                {isAdminUnlocked && pendingWin?.gameId === (m?.gameId ?? "") && (
                  <View style={{ marginTop: 10 }}>
                    <Text style={{ fontWeight: "900", marginBottom: 8 }}>Confirm winner?</Text>

                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <Pressable style={[styles.modeBtn, styles.modeBtnActive]} onPress={confirmWinner}>
                        <Text style={[styles.modeBtnText, styles.modeBtnTextActive]}>CONFIRM</Text>
                      </Pressable>

                      <Pressable style={styles.modeBtn} onPress={() => setPendingWin(null)}>
                        <Text style={styles.modeBtnText}>CANCEL</Text>
                      </Pressable>
                    </View>
                  </View>
                )}

                {isAdminUnlocked && winnerId ? (
                  <View style={{ marginTop: 10 }}>
                    <Pressable style={styles.modeBtn} onPress={() => undoWinner(m?.gameId ?? "")}>
                      <Text style={styles.modeBtnText}>UNDO WINNER</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })}
      </View>
    );
  };

  const renderRoundColumn = (kind: "W" | "L" | "GF", roundNum: number) => {
    return (
      <View style={styles.roundColumn} key={`${kind}-col-${roundNum}`}>
        <Text style={styles.columnTitle}>
          {kind === "W" ? `Round ${roundNum}` : kind === "L" ? `Losers R${roundNum}` : roundNum === 1 ? "Finals" : "Finals (Reset)"}
        </Text>
        {renderRoundCards(kind, roundNum)}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.wrap, { width: "100%" }]}>
        <Text style={styles.title}>🏆 PLAYOFFS</Text>

        {isAdminUnlocked && <Text style={styles.adminModeOn}>Admin Mode: ON</Text>}
        {isAdminUnlocked && overrideModeOn && <Text style={styles.overrideOn}>⚠️ ADMIN OVERRIDE MODE ACTIVE</Text>}

        <View style={styles.card}>
          <Text style={styles.label}>Current Season</Text>
          <Text style={styles.value}>{seasonName ?? (seasonId ? "Loaded" : "None")}</Text>

          <Text style={[styles.label, { marginTop: 10 }]}>Choose Division</Text>

          <Pressable style={styles.divSelectBtn} onPress={openDivisionPicker} disabled={!divisions.length || savingMode}>
            <Text style={styles.divSelectText} numberOfLines={1} ellipsizeMode="tail">
              {selectedDivisionName || (divisions.length ? "Select division" : "No divisions")}
            </Text>
            <Text style={styles.divSelectChevron}>▾</Text>
          </Pressable>

          <Text style={[styles.note, { marginTop: 8 }]}>
            Admin flow: Choose Division → Lock Seeds → Choose Type → (Bracket: Single/Double)
          </Text>

          {isAdminUnlocked && (
            <View style={{ marginTop: 12 }}>
              <Text style={[styles.label, { marginTop: 12 }]}>Format (Admin Only)</Text>

              <View style={styles.adminFlowCard}>
                <Text style={styles.flowTitle}>Admin Flow</Text>
                <Text style={styles.flowHint}>Do these in order: Lock Seeds → Choose Type → (Bracket: Single/Double) → Generate.</Text>

                <View style={styles.flowRow}>
                  <View style={styles.flowBadge}>
                    <Text style={styles.flowBadgeText}>1</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.flowStepTitle}>Lock seeds to continue</Text>

                    <Pressable
                      style={[styles.flowBtn, seedsLocked ? styles.flowBtnGhost : styles.flowBtnPrimary]}
                      onPress={toggleSeedsLock}
                      disabled={savingMode}
                    >
                      <Text style={[styles.flowBtnText, seedsLocked ? styles.flowBtnTextDark : styles.flowBtnTextLight]}>
                        {seedsLocked ? "UNLOCK SEEDS" : "LOCK SEEDS"}
                      </Text>
                    </Pressable>

                    <Text style={styles.flowNote}>{savingMode ? "Saving..." : seedsLocked ? "Seeds are locked." : "Seeds are live."}</Text>
                  </View>
                </View>

                <View style={styles.flowRow}>
                  <View style={styles.flowBadge}>
                    <Text style={styles.flowBadgeText}>2</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.flowStepTitle}>Choose playoff type</Text>

                    <View style={styles.flowPills}>
                      <Pressable
                        style={[styles.flowPill, currentMode === "BRACKET" && styles.flowPillActive]}
                        onPress={() => setMode("BRACKET")}
                        disabled={savingMode}
                      >
                        <Text style={[styles.flowPillText, currentMode === "BRACKET" && styles.flowPillTextActive]}>BRACKET</Text>
                      </Pressable>

                      <Pressable
                        style={[styles.flowPill, currentMode === "FREEFORM" && styles.flowPillActive]}
                        onPress={() => setMode("FREEFORM")}
                        disabled={savingMode}
                      >
                        <Text style={[styles.flowPillText, currentMode === "FREEFORM" && styles.flowPillTextActive]}>FREEFORM</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>

                <View style={styles.flowRow}>
                  <View style={styles.flowBadge}>
                    <Text style={styles.flowBadgeText}>3</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.flowStepTitle}>If Bracket: choose format</Text>

                    <View style={styles.flowPills}>
                      <Pressable
                        style={[styles.flowPill, currentFormat === "SINGLE" && styles.flowPillActive]}
                        onPress={() => setFormat("SINGLE")}
                        disabled={savingMode || currentMode !== "BRACKET"}
                      >
                        <Text
                          style={[
                            styles.flowPillText,
                            currentFormat === "SINGLE" && styles.flowPillTextActive,
                            currentMode !== "BRACKET" ? { opacity: 0.35 } : null,
                          ]}
                        >
                          SINGLE
                        </Text>
                      </Pressable>

                      <Pressable
                        style={[styles.flowPill, currentFormat === "DOUBLE" && styles.flowPillActive]}
                        onPress={() => setFormat("DOUBLE")}
                        disabled={savingMode || currentMode !== "BRACKET"}
                      >
                        <Text
                          style={[
                            styles.flowPillText,
                            currentFormat === "DOUBLE" && styles.flowPillTextActive,
                            currentMode !== "BRACKET" ? { opacity: 0.35 } : null,
                          ]}
                        >
                          DOUBLE
                        </Text>
                      </Pressable>
                    </View>

                    {showFormatConfirm && pendingFormat && (
                      <View style={styles.flowDangerBox}>
                        <Text style={styles.flowDangerTitle}>This resets the bracket.</Text>
                        <Text style={styles.flowDangerText}>Switch to {pendingFormat}?</Text>

                        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                          <Pressable style={[styles.flowBtn, styles.flowBtnDanger]} onPress={confirmSetFormat}>
                            <Text style={[styles.flowBtnText, styles.flowBtnTextLight]}>CONFIRM</Text>
                          </Pressable>

                          <Pressable style={[styles.flowBtn, styles.flowBtnGhost]} onPress={cancelSetFormat}>
                            <Text style={[styles.flowBtnText, styles.flowBtnTextDark]}>CANCEL</Text>
                          </Pressable>
                        </View>
                      </View>
                    )}
                  </View>
                </View>

                <View style={styles.flowAdvancedBox}>
                  <Text style={styles.flowAdvancedTitle}>Advanced</Text>

                  <Pressable
                    style={[styles.flowBtn, overrideModeOn ? styles.flowBtnDanger : styles.flowBtnGhost]}
                    onPress={toggleOverrideMode}
                    disabled={savingMode}
                  >
                    <Text style={[styles.flowBtnText, overrideModeOn ? styles.flowBtnTextLight : styles.flowBtnTextDark]}>
                      {overrideModeOn ? "TURN OVERRIDE OFF" : "TURN OVERRIDE ON"}
                    </Text>
                  </Pressable>

                  <Text style={styles.flowNote}>
                    {overrideModeOn ? "Override ON: admin repair tools available." : "Override OFF: structured mode."}
                  </Text>

                  {/* ✅ OVERRIDE TOOLS LIVE IN SEPARATE FILE */}
                  <PlayoffOverridePanel
                    enabled={overrideModeOn}
                    isAdmin={isAdminUnlocked}
                    savingMode={savingMode}
                    teams={displayTeams}
                    bracket={currentBracket}
                    onSaveBracket={saveBracketOverride}
                  />
                </View>
              </View>
            </View>
          )}
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
            <Text style={styles.note}>Loading playoff boards...</Text>
          </View>
        ) : (
          <View style={styles.boardArea}>
      <Text style={styles.sectionTitle}>
  {currentMode === "FREEFORM" ? "Freeform" : "Bracket"}
</Text>

{currentMode === "FREEFORM" ? (
 <PlayoffFreeformBoard
  isAdmin={isAdminUnlocked}
  enabled={true}
  seedsLocked={seedsLocked}
  divisionId={selectedDivisionId}
  divisionName={divisions.find((d) => d.id === selectedDivisionId)?.name ?? ""}
  seasonId={seasonId}
  seasonName={seasonName}
  teams={displayTeams}
  freeform={selectedBoard?.board_json?.freeform ?? null}
  onSaveFreeform={async (nextFreeform) => {
    if (!seasonId || !selectedDivisionId) return;

    const existingJson = boardsByDivision[selectedDivisionId]?.board_json ?? {};
    const nextBoardJson = { ...existingJson, freeform: nextFreeform };

    await supabase
      .from("playoff_boards")
      .update({ board_json: nextBoardJson })
      .eq("season_id", seasonId)
      .eq("division_id", selectedDivisionId);

    setBoardsByDivision((prev) => ({
      ...prev,
      [selectedDivisionId]: {
        division_id: selectedDivisionId,
        board_json: nextBoardJson,
        updated_at: new Date().toISOString(),
      },
    }));
  }}
/>
) : (
  <View style={styles.bracketBox}>
                <ScrollView
  horizontal
  contentContainerStyle={styles.bracketRow}
  showsHorizontalScrollIndicator
  nestedScrollEnabled
  directionalLockEnabled
  bounces={false}
>
                  <View style={styles.seedColumn}>
                    <Text style={styles.columnTitle}>Seeds</Text>

                    {displayTeams.map((t, idx) => (
                      <View key={t.id} style={styles.seedSlot}>
                        <Text style={styles.seedText} numberOfLines={1} ellipsizeMode="tail">
                          {idx + 1}. {t.team_name}
                        </Text>
                      </View>
                    ))}

                    {!displayTeams.length ? <Text style={styles.note}>No active teams found for this division.</Text> : null}
                  </View>

                  {!seedsLocked ? (
                    <View style={styles.roundColumn}>
                      <Text style={styles.columnTitle}>Bracket</Text>
                      <Text style={styles.note}>LOCK SEEDS to begin building the bracket.</Text>
                    </View>
                  ) : !currentBracket ? (
                    <View style={styles.roundColumn}>
                      <Text style={styles.columnTitle}>Bracket</Text>
                      <Text style={styles.note}>Bracket not created yet. Choose format (Single/Double), then generate the official bracket.</Text>

                      {isAdminUnlocked && (
                        <Pressable style={styles.lockBtn} onPress={generateBracket} disabled={savingMode}>
                          <Text style={styles.lockBtnText}>{savingMode ? "SAVING..." : "GENERATE BRACKET"}</Text>
                        </Pressable>
                      )}
                    </View>
                  ) : (
                    <>
                      {renderRoundColumn("W", 1)}
                      {getWinnersMaxRound >= 2
                        ? Array.from({ length: getWinnersMaxRound - 1 }).map((_, i) => renderRoundColumn("W", i + 2))
                        : null}

                      {currentFormat === "DOUBLE" && currentBracket?.losers && getLosersMaxRound >= 1 ? (
                        <>
                          <View style={styles.dividerCol}>
                            <Text style={styles.dividerText}>LOSERS BRACKET →</Text>
                          </View>

                          {Array.from({ length: getLosersMaxRound }).map((_, i) => renderRoundColumn("L", i + 1))}

                          <View style={styles.dividerCol}>
                            <Text style={styles.dividerText}>FINALS →</Text>
                          </View>

                          {renderRoundColumn("GF", 1)}
                          {currentBracket?.finals?.gf2 ? renderRoundColumn("GF", 2) : null}
                        </>
                      ) : null}
                    </>
                  )}
                </ScrollView>
              </View>
            )}
          </View>
        )}

          {divisionPickerOpen && (
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Select Division</Text>

              <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator>
                {divisions.map((d) => (
                  <Pressable key={d.id} style={styles.modalRow} onPress={() => pickDivision(d.id)}>
                    <Text style={styles.modalRowText}>{d.name}</Text>
                    {d.id === selectedDivisionId ? <Text style={styles.modalRowCheck}>✓</Text> : null}
                  </Pressable>
                ))}
              </ScrollView>

              <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 12 }}>
                <Pressable style={styles.modalCancelBtn} onPress={() => setDivisionPickerOpen(false)}>
                  <Text style={styles.modalCancelText}>CLOSE</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}

        {Platform.OS === "web" ? <View style={{ height: 12 }} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
wrap: { padding: 16, paddingBottom: 40, flexGrow: 1 },
  title: { fontSize: 26, fontWeight: "900", marginBottom: 6 },

  adminModeOn: { color: "#16a34a", fontWeight: "900", marginBottom: 10 },
  overrideOn: { color: "#dc2626", fontWeight: "900", marginBottom: 10 },

  card: { backgroundColor: "#F3F4F6", borderRadius: 16, padding: 14, marginBottom: 14 },
  label: { fontSize: 12, fontWeight: "800", color: "#6B7280" },
  value: { fontSize: 16, fontWeight: "900", color: "#111827" },

  divSelectBtn: {
    marginTop: 8,
    alignSelf: "flex-start",
    minWidth: 220,
    maxWidth: 340,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#111827",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  divSelectText: { color: "#fff", fontWeight: "900", flex: 1, paddingRight: 10 },
  divSelectChevron: { color: "#fff", fontWeight: "900", opacity: 0.9 },

  adminFlowCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
  },
  flowTitle: { fontSize: 14, fontWeight: "900", color: "#111827" },
  flowHint: { marginTop: 6, color: "#6B7280", fontWeight: "700" },

  flowRow: { flexDirection: "row", gap: 12, marginTop: 14, alignItems: "flex-start" },
  flowBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
  },
  flowBadgeText: { color: "#FFFFFF", fontWeight: "900", fontSize: 13 },

  flowStepTitle: { fontWeight: "900", color: "#111827", marginBottom: 8 },

  flowBtn: {
    borderWidth: 2,
    borderColor: "#111827",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  flowBtnPrimary: { backgroundColor: "#111827" },
  flowBtnGhost: { backgroundColor: "#FFFFFF" },
  flowBtnDanger: { backgroundColor: "#dc2626", borderColor: "#dc2626" },

  flowBtnText: { fontWeight: "900" },
  flowBtnTextLight: { color: "#FFFFFF" },
  flowBtnTextDark: { color: "#111827" },

  flowNote: { marginTop: 8, color: "#6B7280", fontWeight: "700" },

  flowPills: { flexDirection: "row", gap: 10 },
  flowPill: {
    flex: 1,
    borderWidth: 2,
    borderColor: "#111827",
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  flowPillActive: { backgroundColor: "#111827" },
  flowPillText: { fontWeight: "900", color: "#111827" },
  flowPillTextActive: { color: "#FFFFFF" },

  flowDangerBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#dc2626",
    backgroundColor: "#FEF2F2",
  },
  flowDangerTitle: { fontWeight: "900", color: "#dc2626" },
  flowDangerText: { marginTop: 6, fontWeight: "800", color: "#111827" },

  flowAdvancedBox: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },
  flowAdvancedTitle: { fontWeight: "900", color: "#111827", marginBottom: 8 },

  modeBtn: {
    flex: 1,
    borderWidth: 2,
    borderColor: "#111827",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  modeBtnActive: { backgroundColor: "#111827" },
  modeBtnText: { fontWeight: "900", color: "#111827" },
  modeBtnTextActive: { color: "#fff" },

  lockBtn: {
    marginTop: 8,
    borderWidth: 2,
    borderColor: "#111827",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#111827",
  },
  lockBtnText: { fontWeight: "900", color: "#fff" },

  center: { alignItems: "center", padding: 18 },

  boardArea: { marginTop: 6 },
  sectionTitle: { fontSize: 16, fontWeight: "900", marginBottom: 8 },

  bracketBox: {
    borderWidth: 2,
    borderColor: "#E5E7EB",
    borderRadius: 14,
    padding: 14,
    backgroundColor: "#fff",
    minHeight: 260,
  },

  freeformBox: {
    borderWidth: 2,
    borderColor: "#E5E7EB",
    borderRadius: 14,
    padding: 14,
    backgroundColor: "#fff",
    minHeight: 260,
  },

  bracketRow: { flexDirection: "row", gap: 20 },

  seedColumn: { width: 280 },
  roundColumn: { flex: 1, minWidth: 320 },

  dividerCol: { width: 80, alignItems: "center", justifyContent: "center" },
  dividerText: { fontWeight: "900", color: "#6B7280", transform: [{ rotate: "-90deg" }] },

  columnTitle: { fontWeight: "900", marginBottom: 10 },

  seedSlot: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: "#F9FAFB",
  },
  seedText: { fontWeight: "800" },

  note: { marginTop: 10, color: "#6B7280", fontWeight: "700" },

  matchCard: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#F9FAFB",
    marginBottom: 12,
  },
  matchLabel: { fontWeight: "900", marginBottom: 8, color: "#111827" },

  matchTeamRow: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "#fff",
  },
  matchTeamText: { fontWeight: "900", color: "#111827" },
  matchTeamWinnerText: { fontWeight: "900", color: "#ffffff" },

  vsText: { textAlign: "center", marginVertical: 8, fontWeight: "900", color: "#6B7280" },

  byeNote: { marginTop: 8, fontWeight: "900", color: "#6B7280" },

  winnerRow: { backgroundColor: "#16a34a", borderColor: "#16a34a", borderWidth: 2 },
  matchCardWinner: { borderColor: "#16a34a", borderWidth: 2 },

  modalBackdrop: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(17,24,39,0.35)",
    justifyContent: "flex-start",
    alignItems: "flex-start",
    paddingTop: 140,
    paddingLeft: 24,
    paddingRight: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  modalTitle: { fontSize: 16, fontWeight: "900", marginBottom: 10, color: "#111827" },
  modalRow: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalRowText: { fontWeight: "900", color: "#111827", flex: 1, paddingRight: 10 },
  modalRowCheck: { fontWeight: "900", color: "#16a34a" },
  modalCancelBtn: {
    borderWidth: 2,
    borderColor: "#111827",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: "#fff",
  },
  modalCancelText: { fontWeight: "900", color: "#111827" },
});