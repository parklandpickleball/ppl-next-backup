import React, { useMemo, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

type TeamRow = { id: string; team_name: string };

type FreeformSlot = {
  id: string;
  aTeamId: string | null;
  bTeamId: string | null;
  winnerTeamId?: string | null;
};

export type FreeformData = {
  seedOrder: string[];
  slots: FreeformSlot[];
  updatedAt: string;
  matchCount?: number;
};

function safeName(name: any) {
  const s = (name ?? "").toString().trim();
  return s || "Team";
}

function clampMatchCount(n: number) {
  return Math.max(1, Math.min(64, Math.floor(n)));
}

function makeDefaultSlots(matchCount: number): FreeformSlot[] {
  const desired = clampMatchCount(matchCount);
  return Array.from({ length: desired }).map((_, i) => ({
    id: `slot-${i + 1}`,
    aTeamId: null,
    bTeamId: null,
    winnerTeamId: null,
  }));
}

function normalizeFreeform(teams: TeamRow[], freeform: any): FreeformData {
  const teamIds = teams.map((t) => t.id);

  const seedOrderRaw: string[] = Array.isArray(freeform?.seedOrder) ? freeform.seedOrder : [];
  const seedOrderFiltered = seedOrderRaw.filter((id) => teamIds.includes(id));

  const missing = teamIds.filter((id) => !seedOrderFiltered.includes(id));
  const seedOrder = [...seedOrderFiltered, ...missing];

  let slots: FreeformSlot[] = [];
  if (Array.isArray(freeform?.slots)) {
    slots = freeform.slots
      .filter((s: any) => s && typeof s.id === "string")
      .map((s: any) => ({
        id: String(s.id),
        aTeamId: teamIds.includes(s?.aTeamId) ? String(s.aTeamId) : null,
        bTeamId: teamIds.includes(s?.bTeamId) ? String(s.bTeamId) : null,
        winnerTeamId: teamIds.includes(s?.winnerTeamId) ? String(s.winnerTeamId) : null,
      }));
  }

  const savedMatchCount =
    typeof freeform?.matchCount === "number" && Number.isFinite(freeform.matchCount)
      ? clampMatchCount(freeform.matchCount)
      : 19;

  if (!slots.length || slots.length !== savedMatchCount) {
    const existingById = new Map<string, FreeformSlot>((slots || []).map((s) => [s.id, s]));
    const next = makeDefaultSlots(savedMatchCount).map((s) => existingById.get(s.id) ?? s);
    slots = next;
  }

  return {
    seedOrder,
    slots,
    updatedAt: typeof freeform?.updatedAt === "string" ? freeform.updatedAt : new Date().toISOString(),
    matchCount: savedMatchCount,
  };
}

export default function PlayoffFreeformBoard(props: {
  isAdmin: boolean;
  enabled: boolean;
  seedsLocked: boolean; // ✅ must be true to edit anything
  seasonId: string | null;
  seasonName: string | null;
  divisionId: string | null;
  divisionName: string;
  teams: TeamRow[];
  freeform: any;
  onSaveFreeform: (nextFreeform: FreeformData) => Promise<void>;
}) {
  const {
    isAdmin,
    enabled,
    seedsLocked,
    seasonId,
    seasonName,
    divisionName,
    divisionId,
    teams,
    freeform,
    onSaveFreeform,
  } = props;

  const canEdit = isAdmin && enabled && seedsLocked;

  const initial = useMemo(() => normalizeFreeform(teams, freeform), [teams, freeform]);

  const [data, setData] = useState<FreeformData>(initial);
  const [saving, setSaving] = useState(false);
  const [coachText, setCoachText] = useState<string | null>(null);

  // select-seed mode
  const [selectedSeedId, setSelectedSeedId] = useState<string | null>(null);

  // advance mode (armed winner)
  const [advanceTeamId, setAdvanceTeamId] = useState<string | null>(null);

  const web = Platform.OS === "web";
  const isMobile = !web;

  const teamMap = useMemo(() => {
    const m = new Map<string, TeamRow>();
    teams.forEach((t) => m.set(t.id, t));
    return m;
  }, [teams]);

  const orderedTeams = useMemo(() => {
    return data.seedOrder.map((id) => teamMap.get(id)).filter(Boolean) as TeamRow[];
  }, [data.seedOrder, teamMap]);

  const persist = async (next: FreeformData) => {
    setData(next);
    setSaving(true);
    try {
      await onSaveFreeform({ ...next, updatedAt: new Date().toISOString() });
    } finally {
      setSaving(false);
    }
  };

  const rebuildSlotsPreserving = (nextCount: number) => {
    const count = clampMatchCount(nextCount);
    const existingById = new Map<string, FreeformSlot>((data.slots || []).map((s) => [s.id, s]));
    const nextSlots = makeDefaultSlots(count).map((s) => existingById.get(s.id) ?? s);
    return { count, nextSlots };
  };

  const setMatchCount = async (nextCount: number) => {
    if (!canEdit) return;
    const { count, nextSlots } = rebuildSlotsPreserving(nextCount);
    await persist({ ...data, matchCount: count, slots: nextSlots });
  };

  const assignToSlot = async (slotId: string, side: "a" | "b", teamId: string) => {
    if (!canEdit) return;
    if (!divisionId) return;
    if (!teamMap.has(teamId)) return;

    const nextSlots = data.slots.map((s) => {
      if (s.id !== slotId) return s;
      const next = side === "a" ? { ...s, aTeamId: teamId } : { ...s, bTeamId: teamId };
      return next;
    });

    await persist({ ...data, slots: nextSlots });
  };

  const clearSlot = async (slotId: string, side: "a" | "b") => {
    if (!canEdit) return;
    const nextSlots = data.slots.map((s) => {
      if (s.id !== slotId) return s;
      const next = side === "a" ? { ...s, aTeamId: null } : { ...s, bTeamId: null };
      const clearedTeamId = side === "a" ? s.aTeamId : s.bTeamId;
      if (clearedTeamId && next.winnerTeamId === clearedTeamId) {
        next.winnerTeamId = null;
      }
      return next;
    });
    await persist({ ...data, slots: nextSlots });
  };

  const clearMatch = async (slotId: string) => {
    if (!canEdit) return;
    const nextSlots = data.slots.map((s) => {
      if (s.id !== slotId) return s;
      return { ...s, aTeamId: null, bTeamId: null, winnerTeamId: null };
    });
    await persist({ ...data, slots: nextSlots });
  };

  const onDropToSlot = async (slotId: string, side: "a" | "b", payload: string) => {
    if (!payload?.startsWith("TEAM:")) return;
    const teamId = payload.replace("TEAM:", "");
    await assignToSlot(slotId, side, teamId);
  };

  const clickAssign = async (slotId: string, side: "a" | "b") => {
    if (!selectedSeedId) return;
    const teamId = selectedSeedId;
    setSelectedSeedId(null);
    await assignToSlot(slotId, side, teamId);
  };

  const matchCountDisplay = typeof data.matchCount === "number" ? data.matchCount : data.slots.length;

  const Inner = (
    <View style={styles.outer}>
      <View style={styles.headerRow}>
        <Text style={styles.hTitle}>FREEFORM BOARD</Text>
        <Text style={styles.hMeta}>
          Season: {seasonName ?? "—"} • Division: {divisionName || "—"}
        </Text>
      </View>

      <Text style={styles.hHint}>
        ✅ {web ? "Click a seed, then click a slot (drag also works)." : "Tap a seed, then tap a slot."}
      </Text>

      {!seedsLocked && (
        <View style={styles.lockWarn}>
          <Text style={styles.lockWarnTitle}>LOCK SEEDS TO CONTINUE</Text>
          <Text style={styles.lockWarnText}>Seeds are not locked yet. Go to Admin → Lock Seeds first.</Text>
        </View>
      )}

      {isAdmin && enabled && coachText ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setCoachText(null)}>
          <Pressable style={styles.coachOverlay} onPress={() => setCoachText(null)}>
            <View style={styles.coachModal}>
              <Text style={styles.coachModalTitle}>Next step</Text>
              <Text style={styles.coachModalText}>{coachText}</Text>

              <View style={styles.coachModalBtns}>
                <Pressable style={styles.coachModalBtn} onPress={() => setCoachText(null)}>
                  <Text style={styles.coachModalBtnText}>Got it</Text>
                </Pressable>

                {advanceTeamId ? (
                  <Pressable
                    style={[styles.coachModalBtn, styles.coachModalBtnGhost]}
                    onPress={() => {
                      setAdvanceTeamId(null);
                      setCoachText(null);
                    }}
                  >
                    <Text style={[styles.coachModalBtnText, styles.coachModalBtnGhostText]}>Cancel advance</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </Pressable>
        </Modal>
      ) : null}

      <View style={styles.pillsRow}>
        <View style={styles.pill}>
          <Text style={styles.pillText}>Teams: {teams.length}</Text>
        </View>
        <View style={styles.pill}>
          <Text style={styles.pillText}>Slots: {data.slots.length}</Text>
        </View>
        <View style={styles.pill}>
          <Text style={styles.pillText}>{saving ? "Saving…" : "Saved"}</Text>
        </View>

        {isAdmin && enabled ? (
          <View style={styles.pill}>
            <Text style={styles.pillText}>
              Selected: {selectedSeedId ? "YES" : "—"} • Advance: {advanceTeamId ? "YES" : "—"}
            </Text>
          </View>
        ) : null}

        {isAdmin && enabled ? (
          <View style={styles.matchCountWrap}>
            <Text style={styles.matchCountLabel}>Match Count:</Text>

            <Pressable style={styles.mcBtn} onPress={() => setMatchCount(8)} disabled={saving || !canEdit}>
              <Text style={styles.mcBtnText}>8</Text>
            </Pressable>
            <Pressable style={styles.mcBtn} onPress={() => setMatchCount(12)} disabled={saving || !canEdit}>
              <Text style={styles.mcBtnText}>12</Text>
            </Pressable>
            <Pressable style={styles.mcBtn} onPress={() => setMatchCount(19)} disabled={saving || !canEdit}>
              <Text style={styles.mcBtnText}>19</Text>
            </Pressable>

            <Pressable
              style={styles.mcBtn}
              onPress={() => setMatchCount(matchCountDisplay - 1)}
              disabled={saving || !canEdit}
            >
              <Text style={styles.mcBtnText}>-</Text>
            </Pressable>
            <Pressable
              style={styles.mcBtn}
              onPress={() => setMatchCount(matchCountDisplay + 1)}
              disabled={saving || !canEdit}
            >
              <Text style={styles.mcBtnText}>+</Text>
            </Pressable>

            <View style={styles.mcPill}>
              <Text style={styles.mcPillText}>{matchCountDisplay}</Text>
            </View>
          </View>
        ) : null}
      </View>

      <View style={[styles.mainRow, isMobile ? styles.mainRowMobile : null]}>
        {/* LEFT: Seeds */}
        <View style={[styles.seedColumn, isMobile ? styles.seedColumnMobile : null]}>
          <Text style={styles.columnTitle}>Seeds</Text>

          <ScrollView style={{ maxHeight: web ? 520 : 260 }} showsVerticalScrollIndicator nestedScrollEnabled>
            {orderedTeams.map((t, idx) => {
              const active = selectedSeedId === t.id;
              const label = `${idx + 1}. ${safeName(t.team_name)}`;

              return (
                <Pressable
                  key={t.id}
                  style={[styles.seedSlot, active ? styles.seedSlotActive : null]}
                  onPress={() => {
                    if (web) return;
                    if (!canEdit) return;
                    setSelectedSeedId((prev) => (prev === t.id ? null : t.id));
                  }}
                  // @ts-ignore (web only)
                  onMouseDown={
                    web
                      ? () => {
                          if (!canEdit) return;
                          setSelectedSeedId((prev) => (prev === t.id ? null : t.id));
                        }
                      : undefined
                  }
                  disabled={!canEdit}
                  // @ts-ignore (web only)
                  draggable={web && canEdit ? true : undefined}
                  // @ts-ignore (web only)
                  onDragStart={
                    web
                      ? (e: any) => {
                          if (!canEdit) return;
                          try {
                            e?.dataTransfer?.setData("text/plain", `TEAM:${t.id}`);
                          } catch {}
                        }
                      : undefined
                  }
                >
                  <Text style={styles.seedText} numberOfLines={1} ellipsizeMode="tail">
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {!isAdmin ? <Text style={styles.note}>Admin mode required to edit.</Text> : null}
          {isAdmin && enabled && selectedSeedId ? (
            <Text style={styles.note}>Selected: {safeName(teamMap.get(selectedSeedId)?.team_name)} — now tap a slot.</Text>
          ) : null}
        </View>

        {/* RIGHT: Slots */}
        <View style={[styles.workColumn, isMobile ? styles.workColumnMobile : null]}>
          <Text style={styles.columnTitle}>Match Slots</Text>

          {/* ✅ This scrolls on iPhone */}
          <ScrollView
            style={styles.slotsBox}
            contentContainerStyle={styles.slotsBoxContent}
            showsVerticalScrollIndicator
            nestedScrollEnabled
          >
            {data.slots.map((s, i) => {
              const seedIndex = (teamId: string | null) => {
                if (!teamId) return null;
                const idx = data.seedOrder.indexOf(teamId);
                return idx >= 0 ? idx + 1 : null;
              };

              const fmtName = (teamId: string | null) => {
                if (!teamId) return "TBD";
                const seed = seedIndex(teamId);
                const nm = safeName(teamMap.get(teamId)?.team_name);
                return seed ? `(${seed}) ${nm}` : nm;
              };

              const aName = fmtName(s.aTeamId);
              const bName = fmtName(s.bTeamId);

              const SlotCell = (side: "a" | "b", text: string, teamId: string | null) => {
                const isWinner = !!teamId && s.winnerTeamId === teamId;

                const setWinner = async () => {
                  if (!canEdit) return;
                  if (!teamId) return;

                  const nextSlots = data.slots.map((x) => {
                    if (x.id !== s.id) return x;
                    const nextWinner = x.winnerTeamId === teamId ? null : teamId;
                    return { ...x, winnerTeamId: nextWinner };
                  });

                  await persist({ ...data, slots: nextSlots });
                  setCoachText("✅ Winner set. Tap “Advance Winner”, then tap the destination slot (A or B).");
                };

                const assignOrAdvance = async () => {
                  if (!canEdit) return;
                  if (advanceTeamId) {
                    await assignToSlot(s.id, side, advanceTeamId);
                    setAdvanceTeamId(null);
                    setCoachText("✅ Advanced. Set the next winner or advance another team.");
                    return;
                  }
                  await clickAssign(s.id, side);
                };

                return (
                  <Pressable
                    style={[styles.slotCell, !teamId ? styles.slotCellEmpty : null, isWinner ? styles.slotCellWinner : null]}
                    onPress={async () => {
                      if (!canEdit) return;
                      if (web) return;

                      if (selectedSeedId || advanceTeamId) return assignOrAdvance();
                      return setWinner();
                    }}
                    // @ts-ignore (web only)
                    onMouseDown={
                      web
                        ? async () => {
                            if (!canEdit) return;

                            if (selectedSeedId || advanceTeamId) return assignOrAdvance();
                            return setWinner();
                          }
                        : undefined
                    }
                    disabled={!canEdit}
                    // @ts-ignore web only
                    onDragOver={
                      web
                        ? (e: any) => {
                            if (!canEdit) return;
                            try {
                              e.preventDefault();
                            } catch {}
                          }
                        : undefined
                    }
                    // @ts-ignore web only
                    onDrop={
                      web
                        ? (e: any) => {
                            if (!canEdit) return;
                            try {
                              e.preventDefault();
                              const payload = e?.dataTransfer?.getData("text/plain");
                              onDropToSlot(s.id, side, payload);
                            } catch {}
                          }
                        : undefined
                    }
                  >
                    <Text style={[styles.slotText, isWinner ? styles.slotTextWinner : null]} numberOfLines={1} ellipsizeMode="tail">
                      {text}
                    </Text>

                    {canEdit && teamId ? (
                      <Pressable style={styles.clearBtn} onPress={() => clearSlot(s.id, side)}>
                        <Text style={styles.clearBtnText}>Clear</Text>
                      </Pressable>
                    ) : null}
                  </Pressable>
                );
              };

              return (
                <View key={s.id} style={styles.matchCard}>
                  <View style={styles.matchHeader}>
                    <Text style={styles.slotLabel}>Match {i + 1}</Text>

                    {isAdmin && enabled ? (
                      <View style={styles.matchHeaderBtns}>
                        {s.winnerTeamId ? (
                          <Pressable
                            style={styles.advanceBtn}
                            onPress={() => {
                              if (!canEdit) return;
                              setAdvanceTeamId(s.winnerTeamId ?? null);
                              setCoachText("➡️ Tap the destination slot (A or B) where the winner should go.");
                            }}
                            disabled={!canEdit}
                          >
                            <Text style={styles.advanceBtnText}>Advance Winner</Text>
                          </Pressable>
                        ) : null}

                        <Pressable style={styles.clearBtn} onPress={() => clearMatch(s.id)} disabled={!canEdit}>
                          <Text style={styles.clearBtnText}>Clear Match</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>

                  <View style={[styles.slotPair, isMobile ? styles.slotPairMobile : null]}>
                    {SlotCell("a", aName, s.aTeamId)}
                    <Text style={styles.vs}>vs</Text>
                    {SlotCell("b", bName, s.bTeamId)}
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <Text style={styles.note}>✅ iPhone: scroll the Match Slots area. Web: scroll page.</Text>
        </View>
      </View>
    </View>
  );

  // ✅ On iPhone, wrap the whole thing so the page can scroll too
  if (!web) {
    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 30 }}
        nestedScrollEnabled
        minimumZoomScale={0.6}
        maximumZoomScale={1.6}
        pinchGestureEnabled
        bouncesZoom
      >
        {Inner}
      </ScrollView>
    );
  }

  return Inner;
}

const styles = StyleSheet.create({
  outer: {
    marginTop: 12,
    borderWidth: 2,
    borderColor: "#E5E7EB",
    borderRadius: 14,
    padding: 14,
    backgroundColor: "#fff",
  },

  headerRow: { marginBottom: 6 },
  hTitle: { fontWeight: "900", fontSize: 14, color: "#111827" },
  hMeta: { marginTop: 6, color: "#6B7280", fontWeight: "700" },
  hHint: { marginTop: 10, color: "#6B7280", fontWeight: "700" },

  lockWarn: {
    marginTop: 12,
    borderWidth: 2,
    borderColor: "#B45309",
    backgroundColor: "#FFFBEB",
    borderRadius: 12,
    padding: 12,
  },
  lockWarnTitle: { fontWeight: "900", color: "#92400E" },
  lockWarnText: { marginTop: 6, fontWeight: "800", color: "#92400E" },

  coachOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    padding: 18,
    justifyContent: "center",
  },
  coachModal: {
    borderWidth: 2,
    borderColor: "#111827",
    borderRadius: 16,
    backgroundColor: "#fff",
    padding: 16,
  },
  coachModalTitle: { fontWeight: "900", color: "#111827", fontSize: 16, marginBottom: 8 },
  coachModalText: { fontWeight: "900", color: "#111827", fontSize: 14, lineHeight: 20 },
  coachModalBtns: { flexDirection: "row", gap: 10, marginTop: 14, flexWrap: "wrap" },

  coachModalBtn: {
    borderWidth: 2,
    borderColor: "#111827",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: "#111827",
  },
  coachModalBtnText: { fontWeight: "900", color: "#fff" },

  coachModalBtnGhost: { backgroundColor: "#fff" },
  coachModalBtnGhostText: { color: "#111827" },

  pillsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
    marginBottom: 12,
    flexWrap: "wrap",
    alignItems: "center",
  },
  pill: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: "#F9FAFB",
  },
  pillText: { fontWeight: "900", color: "#111827" },

  matchCountWrap: { flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" },
  matchCountLabel: { fontWeight: "900", color: "#111827", marginLeft: 6 },

  mcBtn: {
    borderWidth: 1,
    borderColor: "#111827",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: "#fff",
  },
  mcBtnText: { fontWeight: "900", color: "#111827" },

  mcPill: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: "#F9FAFB",
  },
  mcPillText: { fontWeight: "900", color: "#111827" },

  mainRow: { flexDirection: "row", gap: 16, alignItems: "flex-start" },
  mainRowMobile: { flexDirection: "column" },

  seedColumn: { width: 280 },
  seedColumnMobile: { width: "100%" },

 workColumn: { flex: 1 },
workColumnMobile: { minWidth: 0, width: "100%" },

  columnTitle: { fontWeight: "900", marginBottom: 10, color: "#111827" },

  seedSlot: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: "#F9FAFB",
  },
  seedSlotActive: { borderColor: "#111827", borderWidth: 2 },
  seedText: { fontWeight: "900", color: "#111827" },

  // ✅ now a ScrollView
  slotsBox: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#F9FAFB",
    maxHeight: Platform.OS === "web" ? undefined : 520,
  },
  slotsBoxContent: {
    paddingBottom: 18,
  },

  matchCard: {
    marginBottom: 14,
    borderWidth: 2,
    borderColor: "#111827",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#fff",
  },
  slotLabel: { fontWeight: "900", color: "#111827" },
  matchHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  matchHeaderBtns: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },

  advanceBtn: {
    borderWidth: 2,
    borderColor: "#111827",
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: "#111827",
  },
  advanceBtnText: { fontWeight: "900", color: "#fff" },

  slotPair: { flexDirection: "row", gap: 10, alignItems: "center" },
slotPairMobile: { flexDirection: "column", alignItems: "stretch" },
  slotCell: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  slotCellEmpty: {
    backgroundColor: "#FFFFFF",
    borderStyle: "dashed",
  },
  slotCellWinner: {
    borderColor: "#16a34a",
    borderWidth: 2,
    backgroundColor: "#ECFDF5",
  },
slotText: { fontWeight: "900", color: "#111827", flex: 1, minWidth: 0, flexShrink: 1 },  slotTextWinner: {
    color: "#166534",
  },

  clearBtn: {
    borderWidth: 1,
    borderColor: "#111827",
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: "#fff",
  },
  clearBtnText: { fontWeight: "900", color: "#111827" },

  vs: { fontWeight: "900", color: "#6B7280" },

  note: { marginTop: 10, color: "#6B7280", fontWeight: "700" },
});