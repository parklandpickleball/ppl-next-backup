import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Modal,
  ActivityIndicator,
  Platform,
} from "react-native";
import { supabase } from "../constants/supabaseClient";
import { useRouter } from "expo-router";

type AppSettingsRow = { current_season_id: string | null };
type SeasonRow = { id: string; name: string | null; created_at?: string | null };

type Division = { id: string; name: string };

type Team = {
  id: string;
  division: string; // DB column name in your current project
  team_name: string;
  player1_name: string;
  player2_name: string;
  player1_paid: boolean;
  player2_paid: boolean;
  is_active: boolean;
};

type PaymentStatus = "Not Paid" | "Partially Paid" | "Paid in full";

type ImportTeamRow = {
  id: string;
  division: string; // division id from previous season
  team_name: string;
  player1_name: string;
  player2_name: string;
  is_active: boolean;
};

function normalizeName(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function getPaymentStatus(team: Team): PaymentStatus {
  const paidCount = (team.player1_paid ? 1 : 0) + (team.player2_paid ? 1 : 0);
  if (paidCount === 0) return "Not Paid";
  if (paidCount === 1) return "Partially Paid";
  return "Paid in full";
}

function getTeamNameColor(status: PaymentStatus): string {
  if (status === "Paid in full") return "#16A34A"; // green
  if (status === "Partially Paid") return "#CA8A04"; // yellow
  return "#DC2626"; // red
}

function extractSeasonNumber(name: string | null | undefined): number | null {
  const s = String(name ?? "");
  const m = s.match(/(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export default function ManageTeamsScreen() {
  const router = useRouter();

  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [seasonName, setSeasonName] = useState<string>("");

  const [divisions, setDivisions] = useState<Division[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [newTeamName, setNewTeamName] = useState<string>("");
  const [newTeamDivisionId, setNewTeamDivisionId] = useState<string | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);

  const [errorMsg, setErrorMsg] = useState<string>("");

  // Delete modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState<boolean>(false);
  const [deleteTarget, setDeleteTarget] = useState<Team | null>(null);
  const [deleteTyped, setDeleteTyped] = useState<string>("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Payment modal state
  const [payModalOpen, setPayModalOpen] = useState<boolean>(false);
  const [payTarget, setPayTarget] = useState<{ teamId: string; which: 1 | 2 } | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  // Move Division modal state
  const [moveModalOpen, setMoveModalOpen] = useState<boolean>(false);
  const [moveTarget, setMoveTarget] = useState<Team | null>(null);
  const [moveSelectedDivisionId, setMoveSelectedDivisionId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  // Activate/Deactivate modal state
  const [activeModalOpen, setActiveModalOpen] = useState<boolean>(false);
  const [activeTarget, setActiveTarget] = useState<Team | null>(null);
  const [activeError, setActiveError] = useState<string | null>(null);

  // ✅ IMPORT MODAL STATE (new)
  const [importModalOpen, setImportModalOpen] = useState<boolean>(false);
  const [importLoading, setImportLoading] = useState<boolean>(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [prevSeasonId, setPrevSeasonId] = useState<string | null>(null);
  const [prevSeasonName, setPrevSeasonName] = useState<string>("");
  const [prevTeams, setPrevTeams] = useState<ImportTeamRow[]>([]);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [prevDivIdToName, setPrevDivIdToName] = useState<Record<string, string>>({});

  const loadSeason = useCallback(async () => {
    setErrorMsg("");

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

  const loadDivisions = useCallback(async (sid: string) => {
    const { data, error } = await supabase.from("divisions").select("id,name").eq("season_id", sid);

    if (error) {
      console.error(error);
      return [];
    }

    const DIVISION_ORDER: Record<string, number> = {
      Beginner: 0,
      Intermediate: 1,
      Advanced: 2,
    };

    const sorted = (data ?? []).slice().sort((a: any, b: any) => {
      const aName = String(a.name ?? "").trim();
      const bName = String(b.name ?? "").trim();

      const aRank = DIVISION_ORDER[aName] ?? 999;
      const bRank = DIVISION_ORDER[bName] ?? 999;

      if (aRank !== bRank) return aRank - bRank;
      return aName.localeCompare(bName);
    });

    return (sorted ?? []) as Division[];
  }, []);

  const loadTeams = useCallback(async (sid: string) => {
    const { data, error } = await supabase
      .from("teams")
      .select("id,division,team_name,player1_name,player2_name,player1_paid,player2_paid,is_active")
      .eq("season_id", sid)
      .order("team_name");

    if (error) {
      console.error(error);
      return [];
    }

    const safe = ((data ?? []) as any[]).map((t) => ({
      ...t,
      is_active: typeof t.is_active === "boolean" ? t.is_active : true,
    })) as Team[];

    return safe;
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");

    try {
      const sid = await loadSeason();
      if (!sid) {
        setDivisions([]);
        setTeams([]);
        setNewTeamDivisionId(null);
        return;
      }

      const [divs, tms] = await Promise.all([loadDivisions(sid), loadTeams(sid)]);

      setDivisions(divs);
      setTeams(tms);

      // Default newTeamDivisionId to first division if needed (same behavior as before)
      if ((!newTeamDivisionId || !divs.some((d) => d.id === newTeamDivisionId)) && divs.length) {
        setNewTeamDivisionId(divs[0].id);
      } else if (!divs.length) {
        setNewTeamDivisionId(null);
      }
    } finally {
      setLoading(false);
    }
  }, [loadDivisions, loadSeason, loadTeams, newTeamDivisionId]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const teamsByDivision = useMemo(() => {
    const map = new Map<string, Team[]>();
    for (const t of teams) {
      const arr = map.get(t.division) ?? [];
      arr.push(t);
      map.set(t.division, arr);
    }
    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => a.team_name.localeCompare(b.team_name));
      map.set(k, arr);
    }
    return map;
  }, [teams]);

  const addTeam = useCallback(async () => {
    const raw = newTeamName.trim();
    if (!raw || !newTeamDivisionId || !seasonId) return;

    const [p1, p2] = raw.split("/").map((s) => s.trim());
    if (!p1 || !p2) {
      setPayError('Enter team as "Player1/Player2"');
      return;
    }

    const normalizedIncoming = normalizeName(raw);
    const dup = teams.some(
      (t) => t.division === newTeamDivisionId && normalizeName(t.team_name) === normalizedIncoming
    );
    if (dup) {
      setPayError("Duplicate team name in this division.");
      return;
    }

    setBusy(true);
    try {
      const { data: inserted, error } = await supabase
        .from("teams")
        .insert({
          season_id: seasonId,
          division: newTeamDivisionId,
          team_name: raw,
          player1_name: p1,
          player2_name: p2,
          player1_paid: false,
          player2_paid: false,
          is_active: true,
        })
        .select("id,division,team_name,player1_name,player2_name,player1_paid,player2_paid,is_active")
        .single();

      if (error || !inserted) {
        console.error(error);
        return;
      }

      const safeInserted = {
        ...(inserted as any),
        is_active: typeof (inserted as any).is_active === "boolean" ? (inserted as any).is_active : true,
      } as Team;

      setTeams((prev) => [...prev, safeInserted]);
      setNewTeamName("");
      setPayError(null);
    } finally {
      setBusy(false);
    }
  }, [newTeamDivisionId, newTeamName, seasonId, teams]);

  // --- PAYMENT FLOW ---
  const openPayModal = useCallback((teamId: string, which: 1 | 2) => {
    setPayTarget({ teamId, which });
    setPayError(null);
    setPayModalOpen(true);
  }, []);

  const closePayModal = useCallback(() => {
    setPayModalOpen(false);
    setPayTarget(null);
    setPayError(null);
  }, []);

  const payModalInfo = useMemo(() => {
    if (!payTarget) return { question: "" };

    const team = teams.find((t) => t.id === payTarget.teamId);
    if (!team) return { question: "" };

    const playerName = payTarget.which === 1 ? team.player1_name : team.player2_name;
    const isPaid = payTarget.which === 1 ? team.player1_paid : team.player2_paid;

    return { question: isPaid ? `Mark ${playerName} as UNPAID?` : `Mark ${playerName} as PAID?` };
  }, [payTarget, teams]);

  const confirmPayYes = useCallback(async () => {
    if (!payTarget) return;

    const team = teams.find((t) => t.id === payTarget.teamId);
    if (!team) {
      closePayModal();
      return;
    }

    const isPaidNow = payTarget.which === 1 ? team.player1_paid : team.player2_paid;

    const updated: Team =
      payTarget.which === 1 ? { ...team, player1_paid: !isPaidNow } : { ...team, player2_paid: !isPaidNow };

    setBusy(true);
    try {
      const { error } = await supabase
        .from("teams")
        .update({ player1_paid: updated.player1_paid, player2_paid: updated.player2_paid })
        .eq("id", updated.id);

      if (error) {
        setPayError(error.message);
        return;
      }

      setTeams((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      closePayModal();
    } finally {
      setBusy(false);
    }
  }, [closePayModal, payTarget, teams]);

  // --- MOVE DIVISION FLOW ---
  const openMoveModal = useCallback((team: Team) => {
    setMoveTarget(team);
    setMoveSelectedDivisionId(team.division);
    setMoveError(null);
    setMoveModalOpen(true);
  }, []);

  const closeMoveModal = useCallback(() => {
    setMoveModalOpen(false);
    setMoveTarget(null);
    setMoveSelectedDivisionId(null);
    setMoveError(null);
  }, []);

  const confirmMoveDivision = useCallback(async () => {
    if (!moveTarget) return;

    if (!moveSelectedDivisionId) {
      setMoveError("Select a division.");
      return;
    }

    if (moveSelectedDivisionId === moveTarget.division) {
      setMoveError("Team is already in that division.");
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.from("teams").update({ division: moveSelectedDivisionId }).eq("id", moveTarget.id);

      if (error) {
        setMoveError(error.message);
        return;
      }

      setTeams((prev) => prev.map((t) => (t.id === moveTarget.id ? { ...t, division: moveSelectedDivisionId } : t)));

      closeMoveModal();
    } finally {
      setBusy(false);
    }
  }, [closeMoveModal, moveSelectedDivisionId, moveTarget]);

  // --- DELETE FLOW ---
  const openDeleteModal = useCallback((team: Team) => {
    setDeleteTarget(team);
    setDeleteTyped("");
    setDeleteError(null);
    setDeleteModalOpen(true);
  }, []);

  const closeDeleteModal = useCallback(() => {
    setDeleteModalOpen(false);
    setDeleteTarget(null);
    setDeleteTyped("");
    setDeleteError(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;

    if (deleteTyped.trim().toUpperCase() !== "DELETE") {
      setDeleteError('Type "DELETE" to confirm');
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.from("teams").delete().eq("id", deleteTarget.id);
      if (error) {
        setDeleteError(error.message);
        return;
      }
      setTeams((prev) => prev.filter((t) => t.id !== deleteTarget.id));
      closeDeleteModal();
    } finally {
      setBusy(false);
    }
  }, [closeDeleteModal, deleteTarget, deleteTyped]);

  // --- ACTIVATE / DEACTIVATE FLOW ---
  const openActiveModal = useCallback((team: Team) => {
    setActiveTarget(team);
    setActiveError(null);
    setActiveModalOpen(true);
  }, []);

  const closeActiveModal = useCallback(() => {
    setActiveModalOpen(false);
    setActiveTarget(null);
    setActiveError(null);
  }, []);

  const confirmToggleActive = useCallback(async () => {
    if (!activeTarget) return;

    const nextActive = !activeTarget.is_active;

    setBusy(true);
    try {
      const { error } = await supabase.from("teams").update({ is_active: nextActive }).eq("id", activeTarget.id);

      if (error) {
        setActiveError(error.message);
        return;
      }

      setTeams((prev) => prev.map((t) => (t.id === activeTarget.id ? { ...t, is_active: nextActive } : t)));

      closeActiveModal();
    } finally {
      setBusy(false);
    }
  }, [activeTarget, closeActiveModal]);

  // =========================
  // ✅ IMPORT FLOW (new)
  // =========================
  const resolvePreviousSeasonByNameNumber = useCallback(async (currentSeasonId: string) => {
    // Make sure we have the current season name
    let currentName = seasonName;

    if (!currentName) {
      const { data, error } = await supabase.from("seasons").select("id,name").eq("id", currentSeasonId).single<SeasonRow>();
      if (error) return null;
      currentName = data?.name ?? "";
    }

    const curNum = extractSeasonNumber(currentName);
    if (!curNum || curNum <= 1) return null;

    const prevNameExact = `Season ${curNum - 1}`;

    // Try exact match first (your naming is "Season X")
    const { data: exact, error: exactErr } = await supabase
      .from("seasons")
      .select("id,name")
      .eq("name", prevNameExact)
      .maybeSingle<SeasonRow>();

    if (!exactErr && exact?.id) return { id: exact.id, name: exact.name ?? prevNameExact };

    // Fallback: scan all seasons and match number
    const { data: all, error: allErr } = await supabase.from("seasons").select("id,name");
    if (allErr || !all?.length) return null;

    const match = (all as any[]).find((s) => extractSeasonNumber(s?.name) === curNum - 1);
    if (!match?.id) return null;

    return { id: String(match.id), name: String(match.name ?? prevNameExact) };
  }, [seasonName]);

  const openImportModal = useCallback(async () => {
    if (!seasonId) return;

    setImportModalOpen(true);
    setImportError(null);
    setPrevTeams([]);
    setPrevSeasonId(null);
    setPrevSeasonName("");
    setImportedIds(new Set());
    setPrevDivIdToName({});

    setImportLoading(true);
    try {
      const prev = await resolvePreviousSeasonByNameNumber(seasonId);
      if (!prev) {
        setImportError("Could not find the previous season (needs Season number in name).");
        return;
      }

      setPrevSeasonId(prev.id);
      setPrevSeasonName(prev.name ?? "");

      // Load previous season divisions so we can map division name -> new season division id
      const { data: prevDivs, error: prevDivErr } = await supabase
        .from("divisions")
        .select("id,name")
        .eq("season_id", prev.id);

      if (prevDivErr) {
        setImportError(prevDivErr.message);
        return;
      }

      const divMap: Record<string, string> = {};
      for (const d of (prevDivs ?? []) as any[]) {
        divMap[String(d.id)] = String(d.name ?? "");
      }
      setPrevDivIdToName(divMap);

      const { data, error } = await supabase
        .from("teams")
        .select("id,division,team_name,player1_name,player2_name,is_active")
        .eq("season_id", prev.id)
        .order("team_name");

      if (error) {
        setImportError(error.message);
        return;
      }

      const safePrev = ((data ?? []) as any[]).map((t) => ({
        id: String(t.id),
        division: String(t.division),
        team_name: String(t.team_name ?? ""),
        player1_name: String(t.player1_name ?? ""),
        player2_name: String(t.player2_name ?? ""),
        is_active: typeof t.is_active === "boolean" ? t.is_active : true,
      })) as ImportTeamRow[];

      setPrevTeams(safePrev);
    } finally {
      setImportLoading(false);
    }
  }, [resolvePreviousSeasonByNameNumber, seasonId]);

  const closeImportModal = useCallback(() => {
    setImportModalOpen(false);
    setImportError(null);
    setPrevTeams([]);
    setPrevSeasonId(null);
    setPrevSeasonName("");
    setImportedIds(new Set());
    setPrevDivIdToName({});
  }, []);

  const importOneTeam = useCallback(
    async (src: ImportTeamRow) => {
      if (!seasonId) return;

      // Build current division name -> id map
      const currentNameToId: Record<string, string> = {};
      for (const d of divisions) currentNameToId[String(d.name ?? "").trim()] = d.id;

      const prevDivName = String(prevDivIdToName[src.division] ?? "").trim();
      const mappedDivisionId = prevDivName ? currentNameToId[prevDivName] ?? null : null;

      // target division:
      // 1) match by division name (best)
      // 2) fallback to selected division button
      const targetDivisionId = mappedDivisionId || newTeamDivisionId;

      if (!targetDivisionId) {
        setImportError("No matching division found. Select a division above, then import again.");
        return;
      }

      // prevent duplicates in that target division
      const normalizedIncoming = normalizeName(src.team_name);
      const dup = teams.some((t) => t.division === targetDivisionId && normalizeName(t.team_name) === normalizedIncoming);
      if (dup) {
        setImportError("That team already exists in the target division.");
        return;
      }

      setImportError(null);
      setBusy(true);
      try {
        const { data: inserted, error } = await supabase
          .from("teams")
          .insert({
            season_id: seasonId,
            division: targetDivisionId,
            team_name: src.team_name,
            player1_name: src.player1_name,
            player2_name: src.player2_name,
            // ✅ payments reset for new season
            player1_paid: false,
            player2_paid: false,
            is_active: true,
          })
          .select("id,division,team_name,player1_name,player2_name,player1_paid,player2_paid,is_active")
          .single();

        if (error || !inserted) {
          setImportError(error?.message ?? "Import failed.");
          return;
        }

        const safeInserted = {
          ...(inserted as any),
          is_active: typeof (inserted as any).is_active === "boolean" ? (inserted as any).is_active : true,
        } as Team;

        setTeams((prev) => [...prev, safeInserted]);

        setImportedIds((prevSet) => {
          const next = new Set(prevSet);
          next.add(src.id);
          return next;
        });
      } finally {
        setBusy(false);
      }
    },
    [divisions, newTeamDivisionId, prevDivIdToName, seasonId, teams]
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.wrap}>
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" />
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="always">
        {/* ✅ RETURN TO ADMIN BUTTON (same spot/style as your other admin screens) */}
        <Pressable
          style={{
            backgroundColor: "#000",
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: 12,
            alignSelf: "flex-start",
            marginBottom: 16,
          }}
          onPress={() => {
            router.back();
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "900" }}>Return to Admin</Text>
        </Pressable>

        <View style={styles.headerRow}>
          <View style={{ gap: 4 }}>
            <Text style={styles.title}>Manage Teams</Text>
            <Text style={styles.seasonLine}>
              {seasonName ? `Season: ${seasonName}` : seasonId ? `Season: ${seasonId}` : "Season"}
            </Text>
          </View>

          <View style={{ flexDirection: "row", gap: 10 }}>
            {/* ✅ IMPORT BUTTON (new) */}
            <Pressable
              onPress={() => void openImportModal()}
              style={({ pressed }) => [
                styles.importBtn,
                (!seasonId || busy || loading) && styles.disabled,
                pressed && !busy && styles.pressed,
              ]}
              disabled={!seasonId || busy || loading}
              hitSlop={10}
            >
              <Text style={styles.importBtnText}>Import</Text>
            </Pressable>

            <Pressable
              onPress={() => void refreshAll()}
              style={({ pressed }) => [styles.refreshBtn, pressed && styles.pressed]}
              hitSlop={10}
            >
              <Text style={styles.refreshBtnText}>Refresh</Text>
            </Pressable>
          </View>
        </View>

        {errorMsg ? (
          <View style={styles.errBox}>
            <Text style={styles.errText}>{errorMsg}</Text>
          </View>
        ) : null}

        <View style={styles.row}>
          <TextInput
            value={newTeamName}
            onChangeText={setNewTeamName}
            placeholder="Team name (Player1/Player2)"
            style={styles.input}
            autoCapitalize="words"
            autoCorrect={false}
          />
          <Pressable
            style={({ pressed }) => [
              styles.addBtn,
              (busy || loading || !seasonId) && styles.disabled,
              pressed && !busy && styles.pressed,
            ]}
            onPress={() => void addTeam()}
            disabled={busy || loading || !seasonId}
            hitSlop={10}
          >
            {busy ? <ActivityIndicator /> : <Text style={styles.addBtnText}>Add</Text>}
          </Pressable>
        </View>

        {payError ? <Text style={styles.inlineError}>{payError}</Text> : null}

        <View style={styles.divisionSelectorRow}>
          {divisions.map((d) => (
            <Pressable
              key={d.id}
              style={({ pressed }) => [
                styles.divisionBtn,
                newTeamDivisionId === d.id && styles.divisionBtnSelected,
                pressed && styles.pressed,
              ]}
              onPress={() => setNewTeamDivisionId(d.id)}
              hitSlop={10}
            >
              <Text style={styles.divisionBtnText}>{d.name}</Text>
            </Pressable>
          ))}
        </View>

        {divisions.length === 0 ? (
          <View style={{ paddingVertical: 18 }}>
            <Text style={{ fontWeight: "900", color: "#111827" }}>No divisions yet for this season.</Text>
          </View>
        ) : (
          divisions.map((division) => {
            const divisionTeams = teamsByDivision.get(division.id) ?? [];
            if (!divisionTeams.length) return null;

            return (
              <View key={division.id} style={styles.divisionSection}>
                <Text style={styles.divisionHeader}>{division.name}</Text>

                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View>
                    <View style={styles.tableHeader}>
                      <Text style={[styles.hcell, styles.colTeam]}>Team</Text>
                      <Text style={[styles.hcell, styles.colP]}>Player 1</Text>
                      <Text style={[styles.hcell, styles.colP]}>Player 2</Text>
                      <Text style={[styles.hcell, styles.colStatus]}>Payment</Text>
                      <Text style={[styles.hcell, styles.colActive]}>Status</Text>
                      <Text style={[styles.hcell, styles.colMove]}>Move</Text>
                      <Text style={[styles.hcell, styles.colDelete]}>Delete</Text>
                    </View>

                    {divisionTeams.map((team, idx) => {
                      const status = getPaymentStatus(team);
                      const nameColor = getTeamNameColor(status);

                      const rowBg = idx % 2 === 0 ? "#FFFFFF" : "#F9FAFB";
                      const inactiveRowStyle = !team.is_active ? styles.inactiveRow : null;

                      return (
                        <View key={team.id} style={[styles.tableRow, { backgroundColor: rowBg }, inactiveRowStyle]}>
                          <View style={[styles.cell, styles.colTeam]}>
                            <View style={styles.teamNameWrap}>
                              <Text style={[styles.teamNameText, { color: nameColor }]}>{team.team_name}</Text>

                              {!team.is_active ? (
                                <View style={styles.inactivePill}>
                                  <Text style={styles.inactivePillText}>INACTIVE</Text>
                                </View>
                              ) : null}
                            </View>
                          </View>

                          <View style={[styles.cell, styles.colP]}>
                            <Pressable
                              onPress={() => openPayModal(team.id, 1)}
                              style={({ pressed }) => [
                                styles.playerBtn,
                                { backgroundColor: team.player1_paid ? "#16A34A" : "#DC2626" },
                                pressed && styles.playerPressed,
                              ]}
                              hitSlop={14}
                            >
                              <Text style={styles.playerBtnText}>{team.player1_name}</Text>
                            </Pressable>
                          </View>

                          <View style={[styles.cell, styles.colP]}>
                            <Pressable
                              onPress={() => openPayModal(team.id, 2)}
                              style={({ pressed }) => [
                                styles.playerBtn,
                                { backgroundColor: team.player2_paid ? "#16A34A" : "#DC2626" },
                                pressed && styles.playerPressed,
                              ]}
                              hitSlop={14}
                            >
                              <Text style={styles.playerBtnText}>{team.player2_name}</Text>
                            </Pressable>
                          </View>

                          <View style={[styles.cell, styles.colStatus]}>
                            <Text style={styles.statusText}>{status}</Text>
                          </View>

                          <View style={[styles.cell, styles.colActive]}>
                            <Pressable
                              onPress={() => openActiveModal(team)}
                              style={({ pressed }) => [
                                team.is_active ? styles.deactivateBtn : styles.reactivateBtn,
                                pressed && styles.pressed,
                              ]}
                              hitSlop={10}
                            >
                              <Text style={styles.activeBtnText}>{team.is_active ? "Deactivate" : "Reactivate"}</Text>
                            </Pressable>
                          </View>

                          <View style={[styles.cell, styles.colMove]}>
                            <Pressable
                              onPress={() => openMoveModal(team)}
                              style={({ pressed }) => [styles.moveBtn, pressed && styles.pressed]}
                              hitSlop={10}
                            >
                              <Text style={styles.moveText}>MOVE</Text>
                            </Pressable>
                          </View>

                          <View style={[styles.cell, styles.colDelete]}>
                            <Pressable
                              onPress={() => openDeleteModal(team)}
                              style={({ pressed }) => [styles.deleteBtn, pressed && styles.pressed]}
                              hitSlop={10}
                            >
                              <Text style={styles.deleteText}>DELETE</Text>
                            </Pressable>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* ✅ IMPORT MODAL (new) */}
      <Modal visible={importModalOpen} transparent animationType="fade" onRequestClose={closeImportModal}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Import Teams</Text>

            <Text style={styles.modalSub}>
              From:{" "}
              <Text style={styles.modalStrong}>
                {importLoading ? "Loading…" : prevSeasonName ? prevSeasonName : prevSeasonId ? prevSeasonId : "Previous Season"}
              </Text>
            </Text>

            {importError ? <Text style={styles.modalError}>{importError}</Text> : null}

            <View style={[styles.divList, { marginTop: 12 }]}>
              {importLoading ? (
                <View style={{ paddingVertical: 18, alignItems: "center", gap: 10 }}>
                  <ActivityIndicator />
                  <Text style={{ fontWeight: "800", color: "#111827" }}>Loading teams…</Text>
                </View>
              ) : prevTeams.length === 0 ? (
                <View style={{ paddingVertical: 18 }}>
                  <Text style={{ fontWeight: "900", color: "#111827", textAlign: "center" }}>
                    No teams found in the previous season.
                  </Text>
                </View>
              ) : (
                <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={true}>
                  {prevTeams.map((t) => {
                    const alreadyImported = importedIds.has(t.id);
                    const prevDivName = String(prevDivIdToName[t.division] ?? "").trim();

                    return (
                      <View key={t.id} style={styles.importRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.importTeamText}>{t.team_name}</Text>
                          <Text style={styles.importPlayersText}>
                            {t.player1_name} / {t.player2_name}
                          </Text>
                          {prevDivName ? (
                            <Text style={styles.importDivisionText}>Prev division: {prevDivName}</Text>
                          ) : null}
                          {!t.is_active ? <Text style={styles.importInactiveText}>INACTIVE (last season)</Text> : null}
                        </View>

                        <Pressable
                          onPress={() => void importOneTeam(t)}
                          disabled={busy || alreadyImported}
                          style={({ pressed }) => [
                            styles.importOneBtn,
                            (busy || alreadyImported) && styles.disabled,
                            pressed && !busy && styles.pressed,
                          ]}
                          hitSlop={10}
                        >
                          <Text style={styles.importOneBtnText}>
                            {alreadyImported ? "Imported" : busy ? "…" : "Import"}
                          </Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </ScrollView>
              )}
            </View>

            <View style={styles.modalRow}>
              <Pressable style={({ pressed }) => [styles.modalCancel, pressed && styles.pressed]} onPress={closeImportModal}>
                <Text style={styles.modalCancelText}>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* PAYMENT MODAL */}
      <Modal visible={payModalOpen} transparent animationType="fade" onRequestClose={closePayModal}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Payment</Text>
            <Text style={styles.modalWarn}>
              <Text style={styles.modalStrong}>{payModalInfo.question}</Text>
            </Text>

            {payError ? <Text style={styles.modalError}>{payError}</Text> : null}

            <View style={styles.modalRow}>
              <Pressable style={({ pressed }) => [styles.modalCancel, pressed && styles.pressed]} onPress={closePayModal}>
                <Text style={styles.modalCancelText}>No</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.modalYes, busy && styles.disabled, pressed && !busy && styles.pressed]}
                onPress={() => void confirmPayYes()}
                disabled={busy}
              >
                <Text style={styles.modalYesText}>{busy ? "Saving…" : "Yes"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* MOVE DIVISION MODAL */}
      <Modal visible={moveModalOpen} transparent animationType="fade" onRequestClose={closeMoveModal}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Move Divisions</Text>
            <Text style={styles.modalWarn}>
              Team: <Text style={styles.modalStrong}>{moveTarget?.team_name}</Text>
            </Text>
            <Text style={styles.modalSub}>Choose the new division:</Text>

            <View style={styles.divList}>
              <ScrollView style={{ maxHeight: 260 }} showsVerticalScrollIndicator={true}>
                {divisions.map((d) => {
                  const selected = moveSelectedDivisionId === d.id;
                  return (
                    <Pressable
                      key={d.id}
                      onPress={() => {
                        setMoveSelectedDivisionId(d.id);
                        setMoveError(null);
                      }}
                      style={({ pressed }) => [
                        styles.divPickBtn,
                        selected && styles.divPickBtnSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.divPickText, selected && styles.divPickTextSelected]}>{d.name}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {moveError ? <Text style={styles.modalError}>{moveError}</Text> : null}

            <View style={styles.modalRow}>
              <Pressable style={({ pressed }) => [styles.modalCancel, pressed && styles.pressed]} onPress={closeMoveModal}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.modalMove, busy && styles.disabled, pressed && !busy && styles.pressed]}
                onPress={() => void confirmMoveDivision()}
                disabled={busy}
              >
                <Text style={styles.modalMoveText}>{busy ? "Moving…" : "Move"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* DELETE MODAL */}
      <Modal visible={deleteModalOpen} transparent animationType="fade" onRequestClose={closeDeleteModal}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete Team</Text>
            <Text style={styles.modalWarn}>
              You are deleting: <Text style={styles.modalStrong}>{deleteTarget?.team_name}</Text>
            </Text>

            <TextInput
              value={deleteTyped}
              onChangeText={(text: string) => {
                setDeleteTyped(text);
                setDeleteError(null);
              }}
              placeholder='Type "DELETE" to confirm'
              style={styles.modalInput}
              autoCapitalize="characters"
              autoCorrect={false}
            />

            {deleteError ? <Text style={styles.modalError}>{deleteError}</Text> : null}

            <View style={styles.modalRow}>
              <Pressable style={({ pressed }) => [styles.modalCancel, pressed && styles.pressed]} onPress={closeDeleteModal}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.modalDelete, busy && styles.disabled, pressed && !busy && styles.pressed]}
                onPress={() => void confirmDelete()}
                disabled={busy}
              >
                <Text style={styles.modalDeleteText}>{busy ? "Deleting…" : "Delete"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ACTIVATE / DEACTIVATE MODAL */}
      <Modal visible={activeModalOpen} transparent animationType="fade" onRequestClose={closeActiveModal}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{activeTarget?.is_active ? "Deactivate Team" : "Reactivate Team"}</Text>

            <Text style={styles.modalWarn}>
              Team: <Text style={styles.modalStrong}>{activeTarget?.team_name}</Text>
            </Text>

            <Text style={styles.modalSub}>
              {activeTarget?.is_active ? "This team will be marked INACTIVE. Past scores stay saved." : "This team will be marked ACTIVE again."}
            </Text>

            {activeError ? <Text style={styles.modalError}>{activeError}</Text> : null}

            <View style={styles.modalRow}>
              <Pressable style={({ pressed }) => [styles.modalCancel, pressed && styles.pressed]} onPress={closeActiveModal}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.modalYes, busy && styles.disabled, pressed && !busy && styles.pressed]}
                onPress={() => void confirmToggleActive()}
                disabled={busy}
              >
                <Text style={styles.modalYesText}>{busy ? "Saving…" : activeTarget?.is_active ? "Deactivate" : "Reactivate"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const COL_TEAM = 320;
const COL_P = 190;
const COL_STATUS = 190;
const COL_ACTIVE = 190;
const COL_MOVE = 140;
const COL_DELETE = 140;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  wrap: { padding: 16, paddingBottom: 30 },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  title: { fontSize: 22, fontWeight: "900" },
  seasonLine: { fontWeight: "900", color: "#374151" },

  refreshBtn: { backgroundColor: "#111827", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12 },
  refreshBtnText: { color: "#fff", fontWeight: "900" },

  // ✅ import button styles (new)
  importBtn: { backgroundColor: "#1D4ED8", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12 },
  importBtnText: { color: "#fff", fontWeight: "900" },

  errBox: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#FEE2E2",
    borderWidth: 1,
    borderColor: "#EF4444",
    marginBottom: 12,
  },
  errText: { fontWeight: "900", color: "#991B1B" },

  row: { flexDirection: "row", marginBottom: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 12, padding: 12, fontWeight: "800" },
  addBtn: { marginLeft: 8, backgroundColor: "#000", paddingHorizontal: 16, justifyContent: "center", borderRadius: 12 },
  addBtnText: { color: "#fff", fontWeight: "900" },

  inlineError: { color: "#DC2626", fontWeight: "900", marginBottom: 10 },

  divisionSelectorRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  divisionBtn: { paddingVertical: 8, paddingHorizontal: 12, backgroundColor: "#000", borderRadius: 12 },
  divisionBtnSelected: { borderWidth: 2, borderColor: "#FBBF24" },
  divisionBtnText: { color: "#fff", fontWeight: "900" },

  loadingWrap: { paddingVertical: 30, alignItems: "center", gap: 10 },
  loadingText: { fontWeight: "800", color: "#111827" },

  divisionSection: { marginBottom: 20 },
  divisionHeader: { fontSize: 18, fontWeight: "900", marginBottom: 8 },

  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#EEF2FF",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  hcell: { fontWeight: "900", color: "#111827", textAlign: "center" },

  colTeam: { width: COL_TEAM, justifyContent: "center", alignItems: "center" },
  colP: { width: COL_P, justifyContent: "center", alignItems: "center" },
  colStatus: { width: COL_STATUS, justifyContent: "center", alignItems: "center" },
  colActive: { width: COL_ACTIVE, justifyContent: "center", alignItems: "center" },
  colMove: { width: COL_MOVE, justifyContent: "center", alignItems: "center" },
  colDelete: { width: COL_DELETE, justifyContent: "center", alignItems: "center" },

  tableRow: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginBottom: 8,
    alignItems: "center",
  },

  inactiveRow: { opacity: 0.75 },

  cell: { justifyContent: "center", alignItems: "center" },

  teamNameWrap: { alignItems: "center", gap: 6 },
  teamNameText: { fontWeight: "900", fontSize: 14, textAlign: "center" },

  inactivePill: { backgroundColor: "#111827", paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999 },
  inactivePillText: { color: "#FFFFFF", fontWeight: "900", fontSize: 12 },

  playerBtn: {
    width: "100%",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    justifyContent: "center",
    alignItems: "center",
    ...(Platform.OS === "web"
      ? ({
          cursor: "pointer",
          userSelect: "none",
        } as unknown as object)
      : null),
  },
  playerPressed: { transform: [{ scale: 0.98 }] },
  playerBtnText: { color: "#fff", fontWeight: "900", textAlign: "center" },

  statusText: { fontWeight: "900", color: "#111827", textAlign: "center" },

  deactivateBtn: {
    width: "100%",
    backgroundColor: "#111827",
    borderRadius: 12,
    paddingVertical: 10,
    justifyContent: "center",
    alignItems: "center",
    ...(Platform.OS === "web"
      ? ({
          cursor: "pointer",
          userSelect: "none",
        } as unknown as object)
      : null),
  },
  reactivateBtn: {
    width: "100%",
    backgroundColor: "#16A34A",
    borderRadius: 12,
    paddingVertical: 10,
    justifyContent: "center",
    alignItems: "center",
    ...(Platform.OS === "web"
      ? ({
          cursor: "pointer",
          userSelect: "none",
        } as unknown as object)
      : null),
  },
  activeBtnText: { color: "#fff", fontWeight: "900" },

  moveBtn: {
    width: "100%",
    backgroundColor: "#1D4ED8",
    borderRadius: 12,
    paddingVertical: 10,
    justifyContent: "center",
    alignItems: "center",
    ...(Platform.OS === "web"
      ? ({
          cursor: "pointer",
          userSelect: "none",
        } as unknown as object)
      : null),
  },
  moveText: { color: "#fff", fontWeight: "900" },

  deleteBtn: {
    width: "100%",
    backgroundColor: "#7F1D1D",
    borderRadius: 12,
    paddingVertical: 10,
    justifyContent: "center",
    alignItems: "center",
    ...(Platform.OS === "web"
      ? ({
          cursor: "pointer",
          userSelect: "none",
        } as unknown as object)
      : null),
  },
  deleteText: { color: "#fff", fontWeight: "900" },

  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.6 },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 16 },
  modalCard: { backgroundColor: "#fff", borderRadius: 18, padding: 16 },
  modalTitle: { fontSize: 18, fontWeight: "900", color: "#111827" },
  modalStrong: { fontWeight: "900", color: "#111827" },
  modalWarn: { marginTop: 10, color: "#111827", fontWeight: "800" },
  modalSub: { marginTop: 10, color: "#111827", fontWeight: "800" },

  divList: { marginTop: 10, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, padding: 8 },
  divPickBtn: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: "#F3F4F6", marginBottom: 8 },
  divPickBtnSelected: { backgroundColor: "#111827" },
  divPickText: { color: "#111827", fontWeight: "900", textAlign: "center" },
  divPickTextSelected: { color: "#fff" },

  modalInput: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    fontWeight: "800",
  },
  modalError: { marginTop: 10, color: "#DC2626", fontWeight: "900" },
  modalRow: { marginTop: 14, flexDirection: "row", gap: 10 },

  modalCancel: { flex: 1, borderWidth: 2, borderColor: "#111827", borderRadius: 14, paddingVertical: 12, alignItems: "center" },
  modalCancelText: { color: "#111827", fontWeight: "900", fontSize: 16 },

  modalYes: { flex: 1, backgroundColor: "#111827", borderRadius: 14, paddingVertical: 12, alignItems: "center" },
  modalYesText: { color: "#fff", fontWeight: "900", fontSize: 16 },

  modalMove: { flex: 1, backgroundColor: "#1D4ED8", borderRadius: 14, paddingVertical: 12, alignItems: "center" },
  modalMoveText: { color: "#fff", fontWeight: "900", fontSize: 16 },

  modalDelete: { flex: 1, backgroundColor: "#7F1D1D", borderRadius: 14, paddingVertical: 12, alignItems: "center" },
  modalDeleteText: { color: "#fff", fontWeight: "900", fontSize: 16 },

  // ✅ import list row styles (new)
  importRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 8,
    backgroundColor: "#FFFFFF",
  },
  importTeamText: { fontWeight: "900", color: "#111827" },
  importPlayersText: { marginTop: 2, fontWeight: "800", color: "#374151" },
  importDivisionText: { marginTop: 4, fontWeight: "900", color: "#111827" },
  importInactiveText: { marginTop: 4, fontWeight: "900", color: "#991B1B" },
  importOneBtn: {
    backgroundColor: "#16A34A",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    ...(Platform.OS === "web"
      ? ({
          cursor: "pointer",
          userSelect: "none",
        } as unknown as object)
      : null),
  },
  importOneBtnText: { color: "#fff", fontWeight: "900" },
});
