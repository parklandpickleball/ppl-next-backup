import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ImageViewer from "react-native-image-zoom-viewer";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import { decode } from "base64-arraybuffer";

import { supabase } from "../../constants/supabaseClient";
import { useAdminSession } from "./adminSession";

type PastWinnerRow = {
  id: string;
  season_label: string;
  division_label: string;
  winners_label: string;
  photo_path: string;
  created_at: string;
};

const COLORS = {
  bg: "#FFFFFF",
  text: "#111827",
  subtext: "#374151",
  border: "#E5E7EB",
  blue: "#2563EB",
  cardBg: "#FFFFFF",
  soft: "#F3F4F6",
};

function showMsg(title: string, message: string) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

function sanitizeFilePart(s: string) {
  return (s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

// "Season 3" -> 3 (used to sort)
function seasonNumber(label: string) {
  const m = (label || "").match(/(\d+)/);
  return m ? Number(m[1]) : -1;
}

export default function WinnersScreen() {
  const { isAdminUnlocked } = useAdminSession();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [isBackendAdmin, setIsBackendAdmin] = useState(false);
  const canAdminEdit = !!isAdminUnlocked && !!isBackendAdmin;

  const [rows, setRows] = useState<PastWinnerRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Admin form
  const [seasonLabel, setSeasonLabel] = useState("");
  const [divisionLabel, setDivisionLabel] = useState("");
  const [winnersLabel, setWinnersLabel] = useState("");
  const [pickedUri, setPickedUri] = useState<string | null>(null);

  // Image preview modal
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const loadIsAdmin = useCallback(async () => {
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id ?? null;

      if (!uid) {
        setIsBackendAdmin(false);
        return;
      }

      const { data: adminRow, error } = await supabase
        .from("app_admins")
        .select("user_id")
        .eq("user_id", uid)
        .single();

      setIsBackendAdmin(!!adminRow && !error);
    } catch {
      setIsBackendAdmin(false);
    }
  }, []);

  const loadWinners = useCallback(async () => {
    setErrorMsg("");
    const { data, error } = await supabase
      .from("past_winners")
      .select("id,season_label,division_label,winners_label,photo_path,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      setRows([]);
      setErrorMsg(error.message || "Could not load past winners.");
      return;
    }

    setRows((data ?? []) as PastWinnerRow[]);
  }, []);

  const boot = useCallback(async () => {
    setLoading(true);
    await loadIsAdmin();
    await loadWinners();
    setLoading(false);
  }, [loadIsAdmin, loadWinners]);

  useEffect(() => {
    void boot();
  }, [boot]);

  // ✅ Season order: Season 3 then 2 then 1
  const grouped = useMemo(() => {
    const seasonMap: Record<string, PastWinnerRow[]> = {};
    rows.forEach((r) => {
      const key = (r.season_label || "Season").trim() || "Season";
      if (!seasonMap[key]) seasonMap[key] = [];
      seasonMap[key].push(r);
    });

    const seasonKeys = Object.keys(seasonMap);
    seasonKeys.sort((a, b) => {
      const na = seasonNumber(a);
      const nb = seasonNumber(b);
      if (na !== -1 && nb !== -1) return nb - na;

      // fallback: newest created season first
      const aLatest = seasonMap[a]?.[0]?.created_at
        ? new Date(seasonMap[a][0].created_at).getTime()
        : 0;
      const bLatest = seasonMap[b]?.[0]?.created_at
        ? new Date(seasonMap[b][0].created_at).getTime()
        : 0;
      return bLatest - aLatest;
    });

    const out: Array<{
      season: string;
      divisions: Array<{ division: string; items: PastWinnerRow[] }>;
    }> = [];

    seasonKeys.forEach((season) => {
      const seasonRows = seasonMap[season] || [];

      const divOrder: string[] = [];
      const byDiv: Record<string, PastWinnerRow[]> = {};

      seasonRows.forEach((r) => {
        const d = (r.division_label || "Division").trim() || "Division";
        if (!byDiv[d]) byDiv[d] = [];
        byDiv[d].push(r);
        if (!divOrder.includes(d)) divOrder.push(d);
      });

      out.push({
        season,
        divisions: divOrder.map((division) => ({
          division,
          items: byDiv[division] || [],
        })),
      });
    });

    return out;
  }, [rows]);

  const pickImage = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        showMsg("Permission needed", "Please allow photo access to upload winner photos.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.75, // smaller file
      });

      if (result.canceled) return;
      const uri = result.assets?.[0]?.uri ?? null;
      if (!uri) return;

      setPickedUri(uri);
    } catch {
      showMsg("Error", "Could not open photo library.");
    }
  }, []);

  const publicUrlFor = useCallback((path: string) => {
    const { data } = supabase.storage.from("past_winners").getPublicUrl(path);
    return data?.publicUrl ?? "";
  }, []);

  // ✅ Expo-native safe upload (web uses blob; native uses base64->ArrayBuffer)
  const uploadFileToStorage = useCallback(async (filename: string, uri: string, contentType: string) => {
    if (Platform.OS === "web") {
      const resp = await fetch(uri);
      const blob = await resp.blob();
      return await supabase.storage.from("past_winners").upload(filename, blob, {
        contentType,
        upsert: true,
      });
    }

    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
    const arrayBuffer = decode(base64);

    return await supabase.storage.from("past_winners").upload(filename, arrayBuffer, {
      contentType,
      upsert: true,
    });
  }, []);

  const uploadAndSave = useCallback(async () => {
    if (!canAdminEdit) return;

    const s = seasonLabel.trim();
    const d = divisionLabel.trim();
    const w = winnersLabel.trim();

    if (!s || !d || !w) {
      showMsg("Missing info", "Please fill Season, Division, and Winners.");
      return;
    }
    if (!pickedUri) {
      showMsg("Missing photo", "Please choose a winner photo.");
      return;
    }

    setSaving(true);
    setErrorMsg("");

    try {
      const seasonPart = sanitizeFilePart(s) || "season";
      const divPart = sanitizeFilePart(d) || "division";
      const ts = Date.now();
      const ext = pickedUri.toLowerCase().includes(".png") ? "png" : "jpg";
      const filename = `${seasonPart}/${divPart}/${seasonPart}-${divPart}-${ts}.${ext}`;
      const contentType = ext === "png" ? "image/png" : "image/jpeg";

      const uploadRes = await uploadFileToStorage(filename, pickedUri, contentType);
      if (uploadRes.error) throw uploadRes.error;

      const insertRes = await supabase.from("past_winners").insert({
        season_label: s,
        division_label: d,
        winners_label: w,
        photo_path: filename,
      });
      if (insertRes.error) throw insertRes.error;

      setSeasonLabel("");
      setDivisionLabel("");
      setWinnersLabel("");
      setPickedUri(null);

      await loadWinners();
      showMsg("Saved", "Winner added.");
    } catch (e: any) {
      showMsg("Save failed", e?.message || "Could not save winner.");
    } finally {
      setSaving(false);
    }
  }, [canAdminEdit, seasonLabel, divisionLabel, winnersLabel, pickedUri, loadWinners, uploadFileToStorage]);

  // ✅ Delete: DB row + storage file
  const deleteWinner = useCallback(
    async (row: PastWinnerRow) => {
      if (!canAdminEdit) return;

      const ok =
        Platform.OS === "web"
          ? window.confirm("Delete this winner photo? This cannot be undone.")
          : await new Promise<boolean>((resolve) => {
              Alert.alert("Delete winner", "Delete this winner photo? This cannot be undone.", [
                { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
                { text: "Delete", style: "destructive", onPress: () => resolve(true) },
              ]);
            });

      if (!ok) return;

      setSaving(true);
      try {
        const delRow = await supabase.from("past_winners").delete().eq("id", row.id);
        if (delRow.error) throw delRow.error;

        const delObj = await supabase.storage.from("past_winners").remove([row.photo_path]);
        if (delObj.error) {
          console.warn("Storage delete failed:", delObj.error.message);
        }

        await loadWinners();
      } catch (e: any) {
        showMsg("Delete failed", e?.message || "Could not delete winner.");
      } finally {
        setSaving(false);
      }
    },
    [canAdminEdit, loadWinners]
  );

  // Smaller, safer display size
  const screenW = Dimensions.get("window").width;
  const maxW = Math.min(screenW - 28, 820);
  const photoHeight = Math.round(maxW * 0.42);
  const cappedHeight = Math.min(photoHeight, 260);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={{ marginTop: 10, color: COLORS.text, fontWeight: "800" }}>
          Loading past results…
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 30 }}>
        <Text style={styles.h1}>Past Results</Text>

        {errorMsg ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        ) : null}

        {/* Admin add form */}
        {canAdminEdit ? (
          <View style={styles.adminCard}>
            <Text style={styles.adminTitle}>Admin: Add Winner</Text>

            <TextInput
              value={seasonLabel}
              onChangeText={setSeasonLabel}
              placeholder='Season (ex: "Season 3")'
              style={styles.input}
              autoCapitalize="words"
            />

            <TextInput
              value={divisionLabel}
              onChangeText={setDivisionLabel}
              placeholder='Division (ex: "Gold Division")'
              style={styles.input}
              autoCapitalize="words"
            />

            <TextInput
              value={winnersLabel}
              onChangeText={setWinnersLabel}
              placeholder='Winners (ex: "Eric / Adam")'
              style={styles.input}
              autoCapitalize="words"
            />

            <Pressable style={styles.btnOutline} onPress={() => void pickImage()}>
              <Text style={styles.btnOutlineText}>{pickedUri ? "Change Photo" : "Choose Photo"}</Text>
            </Pressable>

            {pickedUri ? (
              <View style={{ marginTop: 10 }}>
                <Image
                  source={{ uri: pickedUri }}
                  style={{ width: "100%", height: 180, borderRadius: 14, backgroundColor: COLORS.soft }}
                  resizeMode="contain"
                />
              </View>
            ) : null}

            <Pressable
              style={[styles.btnPrimary, saving && { opacity: 0.6 }]}
              disabled={saving}
              onPress={() => void uploadAndSave()}
            >
              <Text style={styles.btnPrimaryText}>{saving ? "Saving…" : "Save Winner"}</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Gallery */}
        {rows.length === 0 ? (
          <Text style={{ marginTop: 14, fontWeight: "900", color: COLORS.text }}>
            No winners added yet.
          </Text>
        ) : (
          <View style={{ marginTop: 14 }}>
            {grouped.map((seasonGroup) => (
              <View key={seasonGroup.season} style={{ marginBottom: 18 }}>
                <Text style={styles.seasonHeader}>{seasonGroup.season}</Text>

                <View style={{ marginTop: 10 }}>
                  {seasonGroup.divisions.map((divGroup) =>
                    divGroup.items.map((r) => {
                      const url = publicUrlFor(r.photo_path);
                      return (
                        <View key={r.id} style={[styles.card, { marginBottom: 12 }]}>
                          <View style={styles.cardHeaderRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.division}>{divGroup.division}</Text>
                              <Text style={styles.winners}>{r.winners_label}</Text>
                            </View>

                            {canAdminEdit ? (
                              <Pressable
                                onPress={() => void deleteWinner(r)}
                                style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.7 }]}
                              >
                                <Text style={styles.deleteBtnText}>Delete</Text>
                              </Pressable>
                            ) : null}
                          </View>

                          {url ? (
                            <Pressable onPress={() => setPreviewUrl(url)} style={{ marginTop: 10 }}>
                              <Image
                                source={{ uri: url }}
                                style={{
                                  width: "100%",
                                  height: cappedHeight,
                                  borderRadius: 14,
                                  backgroundColor: COLORS.soft,
                                }}
                                resizeMode="contain"
                              />
                            </Pressable>
                          ) : (
                            <View
                              style={{
                                marginTop: 10,
                                width: "100%",
                                height: cappedHeight,
                                borderRadius: 14,
                                backgroundColor: COLORS.soft,
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Text style={{ fontWeight: "900", color: COLORS.subtext }}>Photo unavailable</Text>
                            </View>
                          )}
                        </View>
                      );
                    })
                  )}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* ✅ Click-to-enlarge modal (Pinch-to-zoom) */}
      <Modal
        visible={!!previewUrl}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewUrl(null)}
        presentationStyle="overFullScreen"
        statusBarTranslucent
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.85)" }}>
          <ImageViewer
  imageUrls={previewUrl ? [{ url: previewUrl }] : []}
  enableSwipeDown
  onSwipeDown={() => setPreviewUrl(null)}
  onCancel={() => setPreviewUrl(null)}
  renderIndicator={() => <View />}
  saveToLocalByLongPress={false}
  backgroundColor="rgba(0,0,0,0.85)"
/>

<View style={{ paddingVertical: 14, alignItems: "center" }}>
  <Pressable
    onPress={() => setPreviewUrl(null)}
    style={{
      paddingVertical: 10,
      paddingHorizontal: 28,
      borderRadius: 999,
      backgroundColor: "rgba(0,0,0,0.7)",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.3)",
    }}
  >
    <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>
      Close
    </Text>
  </Pressable>
</View>

        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg },
  h1: { fontSize: 28, fontWeight: "900", color: COLORS.text },

  errorBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#FEE2E2",
    borderWidth: 1,
    borderColor: "#EF4444",
  },
  errorText: { fontWeight: "900", color: "#991B1B" },

  adminCard: {
    marginTop: 14,
    padding: 12,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COLORS.blue,
    backgroundColor: "#fff",
  },
  adminTitle: { fontSize: 16, fontWeight: "900", color: COLORS.text, marginBottom: 8 },

  input: {
    borderWidth: 2,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
    fontWeight: "800",
    color: COLORS.text,
    backgroundColor: "#fff",
  },

  btnPrimary: {
    marginTop: 12,
    backgroundColor: "#000",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  btnPrimaryText: { color: "#fff", fontWeight: "900", fontSize: 16 },

  btnOutline: {
    marginTop: 12,
    borderWidth: 2,
    borderColor: "#111",
    backgroundColor: "#fff",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  btnOutlineText: { color: "#111", fontWeight: "900" },

  seasonHeader: { marginTop: 4, fontSize: 20, fontWeight: "900", color: COLORS.text },

  card: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    padding: 12,
    backgroundColor: COLORS.cardBg,
  },

  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  division: { fontSize: 16, fontWeight: "900", color: COLORS.text },
  winners: { marginTop: 4, fontSize: 14, fontWeight: "800", color: COLORS.subtext },

  deleteBtn: {
    borderWidth: 2,
    borderColor: "#DC2626",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#fff",
    marginLeft: 12,
  },
  deleteBtnText: { color: "#DC2626", fontWeight: "900" },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    padding: 14,
    justifyContent: "center",
  },
  modalCard: {
    backgroundColor: "#111",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  modalImage: {
    width: "100%",
    height: 420,
    backgroundColor: "#000",
  },

  // Close button (kept in your styles; now used in the zoom viewer)
  modalClose: {
    position: "absolute",
    top: 12,
    right: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  modalCloseText: { color: "#fff", fontWeight: "900" },
});
