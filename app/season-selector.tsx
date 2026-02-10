import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";

import { supabase } from "../constants/supabaseClient";

type SeasonRow = {
  id: string;
  name: string;
};

function normalizeSeasonNameFromNumber(raw: string) {
  const cleaned = (raw || "").trim();
  const n = parseInt(cleaned, 10);
  if (!cleaned || Number.isNaN(n) || n <= 0) return null;
  return `Season ${n}`;
}

export default function SeasonSelectorScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [currentSeasonId, setCurrentSeasonId] = useState<string | null>(null);

  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);

  // New season modal
  const [newSeasonModalOpen, setNewSeasonModalOpen] = useState(false);
  const [newSeasonNumber, setNewSeasonNumber] = useState("");
  const [newSeasonError, setNewSeasonError] = useState<string | null>(null);

  // Delete modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SeasonRow | null>(null);
  const [deleteTyped, setDeleteTyped] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const selectedSeasonName = useMemo(() => {
    return seasons.find((s) => s.id === selectedSeasonId)?.name ?? "";
  }, [seasons, selectedSeasonId]);

  const load = useCallback(async () => {
    try {
      setLoading(true);

      const settingsRes = await supabase
        .from("app_settings")
        .select("id,current_season_id")
        .limit(1)
        .maybeSingle();

      const seasonsRes = await supabase
        .from("seasons")
        .select("id,name")
        .order("name", { ascending: true });

      setSettingsId(settingsRes.data?.id ?? null);

      const curId = settingsRes.data?.current_season_id ?? null;
      setCurrentSeasonId(curId);

      const list = (seasonsRes.data ?? []) as SeasonRow[];
      setSeasons(list);

      setSelectedSeasonId(curId);
    } finally {
      setLoading(false);
      setSaving(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const canSave =
    !!settingsId &&
    !!selectedSeasonId &&
    selectedSeasonId !== currentSeasonId &&
    !saving;

  const onSave = async () => {
    if (!settingsId || !selectedSeasonId) return;

    setSaving(true);

    await supabase
      .from("app_settings")
      .update({ current_season_id: selectedSeasonId })
      .eq("id", settingsId);

    router.back();
  };

  // -------------------------
  // Start New Season modal
  // -------------------------
  const openNewSeasonModal = () => {
    setNewSeasonError(null);
    setNewSeasonNumber("");
    setNewSeasonModalOpen(true);
  };

  const closeNewSeasonModal = () => {
    setNewSeasonModalOpen(false);
    setNewSeasonError(null);
    setNewSeasonNumber("");
  };

  const createSeasonFromNumber = async () => {
    if (!settingsId) return;

    const seasonName = normalizeSeasonNameFromNumber(newSeasonNumber);
    if (!seasonName) {
      setNewSeasonError("Enter a valid season number (ex: 4).");
      return;
    }

    const already = seasons.some(
      (s) => (s.name || "").trim().toLowerCase() === seasonName.toLowerCase()
    );
    if (already) {
      setNewSeasonError(`${seasonName} already exists.`);
      return;
    }

    setSaving(true);
    setNewSeasonError(null);

    try {
      const insertRes = await supabase
        .from("seasons")
        .insert({ name: seasonName })
        .select("id,name")
        .single();

      const newId = insertRes.data?.id as string | undefined;
      const newName = insertRes.data?.name as string | undefined;

      if (!newId || !newName) {
        setNewSeasonError("Could not create season. Try again.");
        return;
      }

      await supabase
        .from("app_settings")
        .update({ current_season_id: newId })
        .eq("id", settingsId);

      const updatedList = [...seasons, { id: newId, name: newName }].sort(
        (a, b) => (a.name || "").localeCompare(b.name || "")
      );
      setSeasons(updatedList);

      setCurrentSeasonId(newId);
      setSelectedSeasonId(newId);

      closeNewSeasonModal();
    } finally {
      setSaving(false);
    }
  };

  // -------------------------
  // Delete Season modal
  // -------------------------
  const openDeleteModal = (season: SeasonRow) => {
    // Protect current season
    if (season.id === currentSeasonId) {
      setDeleteError("You cannot delete the current season.");
      setDeleteTarget(season);
      setDeleteTyped("");
      setDeleteModalOpen(true);
      return;
    }

    setDeleteTarget(season);
    setDeleteTyped("");
    setDeleteError(null);
    setDeleteModalOpen(true);
  };

  const closeDeleteModal = () => {
    setDeleteModalOpen(false);
    setDeleteTarget(null);
    setDeleteTyped("");
    setDeleteError(null);
  };

  const confirmDeleteSeason = async () => {
    if (!deleteTarget) return;

    if (deleteTarget.id === currentSeasonId) {
      setDeleteError("You cannot delete the current season.");
      return;
    }

    if (deleteTyped.trim().toUpperCase() !== "DELETE") {
      setDeleteError('Type "DELETE" to confirm.');
      return;
    }

    setSaving(true);
    setDeleteError(null);

    try {
      await supabase.from("seasons").delete().eq("id", deleteTarget.id);

      const updated = seasons.filter((s) => s.id !== deleteTarget.id);
      setSeasons(updated);

      // If they had it selected (not current) and deleted it, clear selection back to current
      if (selectedSeasonId === deleteTarget.id) {
        setSelectedSeasonId(currentSeasonId);
      }

      closeDeleteModal();
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Select Season</Text>
      </View>

      {/* NEW SEASON MODAL */}
      <Modal
        visible={newSeasonModalOpen}
        transparent
        animationType="fade"
        onRequestClose={closeNewSeasonModal}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Start a New Season</Text>
            <Text style={styles.modalSub}>What is your season number?</Text>

            <TextInput
              value={newSeasonNumber}
              onChangeText={(t) => {
                setNewSeasonError(null);
                setNewSeasonNumber(t.replace(/[^0-9]/g, ""));
              }}
              placeholder="Ex: 4"
              placeholderTextColor="#9CA3AF"
              keyboardType="number-pad"
              style={styles.modalInput}
              returnKeyType="done"
              onSubmitEditing={createSeasonFromNumber}
            />

            {!!newSeasonError && (
              <Text style={styles.modalError}>{newSeasonError}</Text>
            )}

            <View style={styles.modalRow}>
              <Pressable
                style={styles.modalCancel}
                onPress={closeNewSeasonModal}
                disabled={saving}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>

              <Pressable
                style={[styles.modalCreate, saving && styles.disabled]}
                onPress={createSeasonFromNumber}
                disabled={saving}
              >
                <Text style={styles.modalCreateText}>
                  {saving ? "Creating..." : "Create"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* DELETE MODAL */}
      <Modal
        visible={deleteModalOpen}
        transparent
        animationType="fade"
        onRequestClose={closeDeleteModal}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete Season</Text>

            <Text style={styles.modalSub}>
              You are deleting:{" "}
              <Text style={styles.modalStrong}>
                {deleteTarget?.name ?? ""}
              </Text>
            </Text>

            <Text style={styles.modalWarn}>
              This will permanently remove the season record. Type{" "}
              <Text style={styles.modalStrong}>DELETE</Text> to confirm.
            </Text>

            <TextInput
              value={deleteTyped}
              onChangeText={(t) => {
                setDeleteError(null);
                setDeleteTyped(t);
              }}
              placeholder='Type DELETE'
              placeholderTextColor="#9CA3AF"
              autoCapitalize="characters"
              style={styles.modalInput}
              returnKeyType="done"
              onSubmitEditing={confirmDeleteSeason}
            />

            {!!deleteError && <Text style={styles.modalError}>{deleteError}</Text>}

            <View style={styles.modalRow}>
              <Pressable
                style={styles.modalCancel}
                onPress={closeDeleteModal}
                disabled={saving}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>

              <Pressable
                style={[styles.modalDelete, saving && styles.disabled]}
                onPress={confirmDeleteSeason}
                disabled={saving}
              >
                <Text style={styles.modalDeleteText}>
                  {saving ? "Deleting..." : "Delete"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.wrap}>
          <View style={styles.selectedCard}>
            <Text style={styles.selectedLabel}>Selected Season</Text>
            <Text style={styles.selectedValue}>
              {selectedSeasonName || "None"}
            </Text>
          </View>

          {seasons.map((s) => {
            const selected = s.id === selectedSeasonId;

            return (
              <View
                key={s.id}
                style={[styles.seasonRow, selected && styles.seasonRowSelected]}
              >
                <Pressable
                  style={styles.seasonMain}
                  onPress={() => setSelectedSeasonId(s.id)}
                  disabled={saving}
                >
                  <Text style={styles.seasonBtnText}>{s.name}</Text>
                </Pressable>

                <Pressable
                  style={styles.deleteChip}
                  onPress={() => openDeleteModal(s)}
                  disabled={saving}
                >
                  <Text style={styles.deleteChipText}>DELETE</Text>
                </Pressable>
              </View>
            );
          })}

          <Pressable
            style={[styles.saveBtn, !canSave && styles.disabled]}
            disabled={!canSave}
            onPress={onSave}
          >
            <Text style={styles.saveBtnText}>
              {saving ? "Saving..." : "Save"}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.newSeasonBtn, saving && styles.disabled]}
            disabled={saving}
            onPress={openNewSeasonModal}
          >
            <Text style={styles.newSeasonBtnText}>Start New Season</Text>
          </Pressable>

          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Back</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },

  header: { padding: 16, borderBottomWidth: 1, borderColor: "#eee" },
  headerTitle: { fontSize: 22, fontWeight: "900" },

  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  wrap: { padding: 16, paddingBottom: 28 },

  selectedCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#f3f4f6",
    marginBottom: 12,
  },
  selectedLabel: { fontSize: 12, fontWeight: "700", color: "#6b7280" },
  selectedValue: { fontSize: 20, fontWeight: "900" },

  seasonRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    borderRadius: 16,
    backgroundColor: "#000",
    overflow: "hidden",
  },
  seasonRowSelected: {
    borderWidth: 3,
    borderColor: "#000",
  },
  seasonMain: {
    flex: 1,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  seasonBtnText: { color: "#fff", fontSize: 18, fontWeight: "900" },

  deleteChip: {
    paddingVertical: 16,
    paddingHorizontal: 14,
    backgroundColor: "#7F1D1D",
  },
  deleteChipText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1,
  },

  saveBtn: {
    marginTop: 10,
    backgroundColor: "#000",
    padding: 16,
    borderRadius: 16,
    alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontSize: 18, fontWeight: "900" },

  newSeasonBtn: {
    marginTop: 12,
    borderWidth: 3,
    borderColor: "#000",
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 16,
    alignItems: "center",
  },
  newSeasonBtnText: { color: "#000", fontSize: 18, fontWeight: "900" },

  backBtn: {
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    alignItems: "center",
    backgroundColor: "#111827",
  },
  backBtnText: { color: "#fff", fontWeight: "900", fontSize: 16 },

  disabled: { opacity: 0.45 },

  // Modals
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: "900", color: "#111827" },
  modalSub: { marginTop: 8, color: "#6B7280", fontWeight: "700" },
  modalStrong: { color: "#111827", fontWeight: "900" },
  modalWarn: { marginTop: 10, color: "#991B1B", fontWeight: "800" },
  modalInput: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 12,
    padding: 12,
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
  },
  modalError: { marginTop: 10, color: "#DC2626", fontWeight: "900" },
  modalRow: { marginTop: 14, flexDirection: "row", gap: 10 },
  modalCancel: {
    flex: 1,
    borderWidth: 2,
    borderColor: "#111827",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
  },
  modalCancelText: { color: "#111827", fontWeight: "900", fontSize: 16 },

  modalCreate: {
    flex: 1,
    backgroundColor: "#000",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
  },
  modalCreateText: { color: "#fff", fontWeight: "900", fontSize: 16 },

  modalDelete: {
    flex: 1,
    backgroundColor: "#7F1D1D",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
  },
  modalDeleteText: { color: "#fff", fontWeight: "900", fontSize: 16 },
});
