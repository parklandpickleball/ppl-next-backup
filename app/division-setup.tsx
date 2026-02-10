import React, { useCallback, useState } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Modal,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";

import { supabase } from "../constants/supabaseClient";

type Division = {
  id: string;
  name: string;
};

export default function DivisionSetupScreen() {
  const router = useRouter(); // <-- added to enable navigation back to admin
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [newName, setNewName] = useState("");

  // Delete modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Division | null>(null);
  const [deleteTyped, setDeleteTyped] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const settings = await supabase
      .from("app_settings")
      .select("current_season_id")
      .limit(1)
      .maybeSingle();

    const sid = settings.data?.current_season_id ?? null;
    setSeasonId(sid);

    if (!sid) return;

    const res = await supabase
      .from("divisions")
      .select("id,name")
      .eq("season_id", sid)
      .order("name");

    setDivisions(res.data ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const addDivision = async () => {
    if (!seasonId || !newName.trim()) return;

    await supabase.from("divisions").insert({
      season_id: seasonId,
      name: newName.trim(),
    });

    setNewName("");
    load();
  };

  const openDeleteModal = (division: Division) => {
    setDeleteTarget(division);
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

  const confirmDelete = async () => {
    if (!deleteTarget || !seasonId) return;

    if (deleteTyped.trim().toUpperCase() !== "DELETE") {
      setDeleteError('Type "DELETE" to confirm.');
      return;
    }

    await supabase.from("divisions").delete().eq("id", deleteTarget.id);

    setDeleteModalOpen(false);
    load();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.wrap}>
        <Text style={styles.title}>Division Setup</Text>

        {/* ---------- RETURN TO ADMIN BUTTON ---------- */}
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
            // ✅ Use back navigation so you return to the already-signed-in admin page,
            // not the admin sign-in route.
            router.back();
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "900" }}>Return to Admin</Text>
        </Pressable>

        <View style={styles.row}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="Division name (ex: Beginner)"
            style={styles.input}
          />
          <Pressable style={styles.addBtn} onPress={addDivision}>
            <Text style={styles.addBtnText}>Add</Text>
          </Pressable>
        </View>

        {divisions.map((d) => (
          <View key={d.id} style={styles.divisionRow}>
            <Text style={styles.divisionText}>{d.name}</Text>
            <Pressable
              style={styles.deleteChip}
              onPress={() => openDeleteModal(d)}
            >
              <Text style={styles.deleteChipText}>DELETE</Text>
            </Pressable>
          </View>
        ))}

        {/* DELETE MODAL */}
        <Modal
          visible={deleteModalOpen}
          transparent
          animationType="fade"
          onRequestClose={closeDeleteModal}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Delete Division</Text>
              <Text style={styles.modalWarn}>
                You are deleting:{" "}
                <Text style={styles.modalStrong}>{deleteTarget?.name}</Text>
              </Text>
              <Text style={styles.modalSub}>
                This will remove the division. Type{" "}
                <Text style={styles.modalStrong}>DELETE</Text> to confirm.
              </Text>
              <TextInput
                value={deleteTyped}
                onChangeText={(t) => {
                  setDeleteTyped(t);
                  setDeleteError(null);
                }}
                placeholder="Type DELETE"
                autoCapitalize="characters"
                style={styles.modalInput}
                returnKeyType="done"
                onSubmitEditing={confirmDelete}
              />
              {!!deleteError && <Text style={styles.modalError}>{deleteError}</Text>}
              <View style={styles.modalRow}>
                <Pressable style={styles.modalCancel} onPress={closeDeleteModal}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.modalDelete} onPress={confirmDelete}>
                  <Text style={styles.modalDeleteText}>Delete</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  wrap: { padding: 16 },
  title: { fontSize: 22, fontWeight: "900", marginBottom: 12 },
  row: { flexDirection: "row", marginBottom: 12 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    padding: 12,
  },
  addBtn: {
    marginLeft: 8,
    backgroundColor: "#000",
    paddingHorizontal: 16,
    justifyContent: "center",
    borderRadius: 10,
  },
  addBtnText: { color: "#fff", fontWeight: "900" },
  divisionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: "#eee",
  },
  divisionText: { fontSize: 16, fontWeight: "700" },
  deleteChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#7F1D1D",
    borderRadius: 8,
  },
  deleteChipText: { color: "#fff", fontWeight: "900" },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: { backgroundColor: "#fff", borderRadius: 18, padding: 16 },
  modalTitle: { fontSize: 18, fontWeight: "900", color: "#111827" },
  modalSub: { marginTop: 6, color: "#6B7280", fontWeight: "700" },
  modalStrong: { fontWeight: "900", color: "#111827" },
  modalWarn: { marginTop: 10, color: "#991B1D", fontWeight: "800" },
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
  modalDelete: {
    flex: 1,
    backgroundColor: "#7F1D1D",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
  },
  modalDeleteText: { color: "#fff", fontWeight: "900", fontSize: 16 },
});
