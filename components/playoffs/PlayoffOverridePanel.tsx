import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, StyleSheet } from "react-native";

type TeamRow = { id: string; team_name: string };

type MatchSlot = { teamId: string | null };
type MatchNode = {
  a?: MatchSlot;
  b?: MatchSlot;
  winnerId?: string | null;
  gameId?: string;
};

type BracketShape = {
  winners?: Record<string, MatchNode[]>;
  losers?: Record<string, MatchNode[]>;
  finals?: {
    gf1?: MatchNode | null;
    gf2?: MatchNode | null;
  } | null;
};

type Props = {
  enabled: boolean; // override on?
  isAdmin: boolean;
  savingMode: boolean;
  teams: TeamRow[];

  // current bracket JSON (from board_json.bracket)
  bracket: BracketShape | null;

  // persist function provided by playoffs.tsx (updates board_json.bracket)
  onSaveBracket: (nextBracket: BracketShape) => Promise<void>;
};

type MatchRef = { label: string; kind: "W" | "L" | "GF"; round: number; index: number; gameId: string };

export default function PlayoffOverridePanel({
  enabled,
  isAdmin,
  savingMode,
  teams,
  bracket,
  onSaveBracket,
}: Props) {
  const [open, setOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const matchRefs: MatchRef[] = useMemo(() => {
    if (!bracket) return [];

    const out: MatchRef[] = [];

    const pushRounds = (kind: "W" | "L", obj?: Record<string, MatchNode[]>) => {
      if (!obj) return;
      const roundKeys = Object.keys(obj)
        .filter((k) => k.startsWith("round"))
        .sort((a, b) => {
          const an = parseInt(a.replace("round", ""), 10);
          const bn = parseInt(b.replace("round", ""), 10);
          return (Number.isFinite(an) ? an : 0) - (Number.isFinite(bn) ? bn : 0);
        });

      for (const rk of roundKeys) {
        const r = parseInt(rk.replace("round", ""), 10);
        const arr = obj[rk] ?? [];
        arr.forEach((m, idx) => {
          const gid = (m?.gameId ?? `${kind}${r}-${idx + 1}`).toString();
          out.push({
            kind,
            round: r,
            index: idx,
            gameId: gid,
            label: kind === "W" ? `Winners R${r} - M${idx + 1}` : `Losers R${r} - M${idx + 1}`,
          });
        });
      }
    };

    pushRounds("W", bracket.winners);
    pushRounds("L", bracket.losers);

    const gf1 = bracket.finals?.gf1;
    if (gf1) out.push({ kind: "GF", round: 1, index: 0, gameId: (gf1.gameId ?? "GF1").toString(), label: "Finals - GF1" });
    const gf2 = bracket.finals?.gf2;
    if (gf2) out.push({ kind: "GF", round: 2, index: 0, gameId: (gf2.gameId ?? "GF2").toString(), label: "Finals - GF2" });

    return out;
  }, [bracket]);

  const selected = useMemo(() => {
    if (!selectedKey) return null;
    const [kind, roundStr, idxStr] = selectedKey.split("|");
    const round = parseInt(roundStr, 10);
    const index = parseInt(idxStr, 10);
    const ref = matchRefs.find((m) => m.kind === (kind as any) && m.round === round && m.index === index) ?? null;
    return ref;
  }, [selectedKey, matchRefs]);

  const getNode = (b: BracketShape, ref: MatchRef): MatchNode | null => {
    if (ref.kind === "W") return b.winners?.[`round${ref.round}`]?.[ref.index] ?? null;
    if (ref.kind === "L") return b.losers?.[`round${ref.round}`]?.[ref.index] ?? null;
    if (ref.kind === "GF") {
      const f = b.finals ?? null;
      return ref.round === 1 ? (f?.gf1 ?? null) : (f?.gf2 ?? null);
    }
    return null;
  };

  const setNode = (b: BracketShape, ref: MatchRef, nextNode: MatchNode) => {
    if (ref.kind === "W") {
      const key = `round${ref.round}`;
      const arr = (b.winners?.[key] ?? []).map((m) => ({ ...m }));
      arr[ref.index] = nextNode;
      b.winners = { ...(b.winners ?? {}), [key]: arr };
      return;
    }
    if (ref.kind === "L") {
      const key = `round${ref.round}`;
      const arr = (b.losers?.[key] ?? []).map((m) => ({ ...m }));
      arr[ref.index] = nextNode;
      b.losers = { ...(b.losers ?? {}), [key]: arr };
      return;
    }
    if (ref.kind === "GF") {
      const finals = { ...(b.finals ?? {}) };
      if (ref.round === 1) finals.gf1 = nextNode;
      if (ref.round === 2) finals.gf2 = nextNode;
      b.finals = finals as any;
      return;
    }
  };

  const saveMutate = async (mutator: (b: BracketShape) => void) => {
    if (!enabled || !isAdmin) return;
    if (!bracket) return;
    const next: BracketShape = {
      winners: { ...(bracket.winners ?? {}) },
      losers: { ...(bracket.losers ?? {}) },
      finals: bracket.finals ? { ...(bracket.finals ?? {}) } : null,
    };
    mutator(next);
    await onSaveBracket(next);
  };

  const selectedNode = useMemo(() => {
    if (!bracket || !selected) return null;
    return getNode(bracket, selected);
  }, [bracket, selected]);

  const teamLabel = (id: string | null) => {
    if (!id) return "TBD";
    return teams.find((t) => t.id === id)?.team_name ?? "Team";
  };

  if (!enabled || !isAdmin) return null;

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.headerBtn} onPress={() => setOpen((v) => !v)} disabled={savingMode}>
        <Text style={styles.headerText}>{open ? "Hide Override Tools" : "Show Override Tools"}</Text>
      </Pressable>

      {open ? (
        <View style={styles.card}>
          <Text style={styles.warnTitle}>Override Tools (OH-SHIT MODE)</Text>
          <Text style={styles.warnText}>
            Use only for admin repairs (rainouts/makeups/incorrect advancement). This does NOT auto-advance other matches.
          </Text>

          <Text style={styles.label}>Select Match</Text>
          <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator>
            {matchRefs.map((m) => {
              const key = `${m.kind}|${m.round}|${m.index}`;
              const active = key === selectedKey;
              return (
                <Pressable
                  key={key}
                  style={[styles.row, active ? styles.rowActive : null]}
                  onPress={() => setSelectedKey(key)}
                >
                  <Text style={[styles.rowText, active ? styles.rowTextActive : null]}>{m.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {selected && selectedNode ? (
            <View style={{ marginTop: 14 }}>
              <Text style={styles.label}>Current</Text>
              <Text style={styles.currentLine}>
                A: <Text style={styles.bold}>{teamLabel(selectedNode.a?.teamId ?? null)}</Text>
              </Text>
              <Text style={styles.currentLine}>
                B: <Text style={styles.bold}>{teamLabel(selectedNode.b?.teamId ?? null)}</Text>
              </Text>
              <Text style={styles.currentLine}>
                Winner: <Text style={styles.bold}>{teamLabel(selectedNode.winnerId ?? null)}</Text>
              </Text>

              <Text style={[styles.label, { marginTop: 12 }]}>Set Team A</Text>
              <ScrollView style={{ maxHeight: 160 }} showsVerticalScrollIndicator>
                <Pressable
                  style={styles.smallRow}
                  onPress={() =>
                    saveMutate((b) => {
                      const node = getNode(b, selected);
                      if (!node) return;
                      const next = { ...node, a: { ...(node.a ?? {}), teamId: null }, winnerId: null };
                      setNode(b, selected, next);
                    })
                  }
                >
                  <Text style={styles.smallRowText}>Set A = TBD (clear)</Text>
                </Pressable>
                {teams.map((t) => (
                  <Pressable
                    key={`A-${t.id}`}
                    style={styles.smallRow}
                    onPress={() =>
                      saveMutate((b) => {
                        const node = getNode(b, selected);
                        if (!node) return;
                        const next = { ...node, a: { ...(node.a ?? {}), teamId: t.id }, winnerId: null };
                        setNode(b, selected, next);
                      })
                    }
                  >
                    <Text style={styles.smallRowText}>{t.team_name}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <Text style={[styles.label, { marginTop: 12 }]}>Set Team B</Text>
              <ScrollView style={{ maxHeight: 160 }} showsVerticalScrollIndicator>
                <Pressable
                  style={styles.smallRow}
                  onPress={() =>
                    saveMutate((b) => {
                      const node = getNode(b, selected);
                      if (!node) return;
                      const next = { ...node, b: { ...(node.b ?? {}), teamId: null }, winnerId: null };
                      setNode(b, selected, next);
                    })
                  }
                >
                  <Text style={styles.smallRowText}>Set B = TBD (clear)</Text>
                </Pressable>
                {teams.map((t) => (
                  <Pressable
                    key={`B-${t.id}`}
                    style={styles.smallRow}
                    onPress={() =>
                      saveMutate((b) => {
                        const node = getNode(b, selected);
                        if (!node) return;
                        const next = { ...node, b: { ...(node.b ?? {}), teamId: t.id }, winnerId: null };
                        setNode(b, selected, next);
                      })
                    }
                  >
                    <Text style={styles.smallRowText}>{t.team_name}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                <Pressable
                  style={styles.actionBtn}
                  onPress={() =>
                    saveMutate((b) => {
                      const node = getNode(b, selected);
                      if (!node) return;
                      const aId = node.a?.teamId ?? null;
                      if (!aId) return;
                      setNode(b, selected, { ...node, winnerId: aId });
                    })
                  }
                >
                  <Text style={styles.actionText}>Winner = A</Text>
                </Pressable>

                <Pressable
                  style={styles.actionBtn}
                  onPress={() =>
                    saveMutate((b) => {
                      const node = getNode(b, selected);
                      if (!node) return;
                      const bId = node.b?.teamId ?? null;
                      if (!bId) return;
                      setNode(b, selected, { ...node, winnerId: bId });
                    })
                  }
                >
                  <Text style={styles.actionText}>Winner = B</Text>
                </Pressable>
              </View>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                <Pressable
                  style={[styles.actionBtn, styles.ghost]}
                  onPress={() =>
                    saveMutate((b) => {
                      const node = getNode(b, selected);
                      if (!node) return;
                      setNode(b, selected, { ...node, winnerId: null });
                    })
                  }
                >
                  <Text style={[styles.actionText, styles.ghostText]}>Clear Winner</Text>
                </Pressable>

                <Pressable
                  style={[styles.actionBtn, styles.danger]}
                  onPress={() =>
                    saveMutate((b) => {
                      const node = getNode(b, selected);
                      if (!node) return;
                      setNode(b, selected, {
                        ...node,
                        a: { ...(node.a ?? {}), teamId: null },
                        b: { ...(node.b ?? {}), teamId: null },
                        winnerId: null,
                      });
                    })
                  }
                >
                  <Text style={styles.actionText}>Clear Match</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Text style={[styles.warnText, { marginTop: 12 }]}>Pick a match above to edit.</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12 },
  headerBtn: {
    borderWidth: 2,
    borderColor: "#dc2626",
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  headerText: { fontWeight: "900", color: "#dc2626" },

  card: {
    marginTop: 10,
    borderWidth: 2,
    borderColor: "#dc2626",
    backgroundColor: "#FEF2F2",
    borderRadius: 14,
    padding: 12,
  },
  warnTitle: { fontWeight: "900", color: "#dc2626", marginBottom: 6 },
  warnText: { fontWeight: "800", color: "#111827" },

  label: { marginTop: 10, fontSize: 12, fontWeight: "900", color: "#6B7280" },

  row: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#fff",
    marginBottom: 8,
  },
  rowActive: { borderColor: "#111827", borderWidth: 2 },
  rowText: { fontWeight: "900", color: "#111827" },
  rowTextActive: { color: "#111827" },

  currentLine: { marginTop: 6, fontWeight: "800", color: "#111827" },
  bold: { fontWeight: "900" },

  smallRow: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 8,
  },
  smallRowText: { fontWeight: "900", color: "#111827" },

  actionBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#111827",
  },
  actionText: { fontWeight: "900", color: "#fff" },
  ghost: { backgroundColor: "#fff", borderWidth: 2, borderColor: "#111827" },
  ghostText: { color: "#111827" },
  danger: { backgroundColor: "#dc2626" },
});