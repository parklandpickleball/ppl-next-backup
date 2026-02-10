// app/_photos_simple.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { supabase } from "@/constants/supabaseClient";
import * as FileSystem from "expo-file-system/legacy";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

type UploadRow = {
  path: string; // "shared/filename.jpg"
  uploader: string; // uid
  created_at: string;
};

const SHARED_FOLDER = "shared";
const BUCKET = "photos";

// ✅ 20 at a time
const PAGE_SIZE = 20;
const MAX_PAGES = 200;

function base64ToUint8Array(base64: string) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const str = base64.replace(/=+$/, "");
  const output: number[] = [];

  for (let bc = 0, bs = 0, buffer: any, idx = 0; (buffer = str.charAt(idx++)); ) {
    const charIndex = chars.indexOf(buffer);
    if (charIndex === -1) continue;

    bs = bc % 4 ? bs * 64 + charIndex : charIndex;
    if (bc++ % 4) output.push(255 & (bs >> ((-2 * bc) & 6)));
  }

  return new Uint8Array(output);
}

function basename(p: string) {
  const parts = p.split("/");
  return parts[parts.length - 1] || p;
}

export default function PhotosSimple() {
  const { width, height } = useWindowDimensions();

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [err, setErr] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);

  const [userId, setUserId] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  const [rows, setRows] = useState<UploadRow[]>([]);
  const [page, setPage] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(true);

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number>(-1);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [zoom, setZoom] = useState<number>(1);

  const folderPrefix = SHARED_FOLDER;

  const grid = useMemo(() => {
    const gutter = 10;
    const available = Math.max(320, width - 24);

    const targetTile = 120;
    const estimatedCols = Math.floor((available + gutter) / (targetTile + gutter));

    const maxCols = Platform.OS === "web" ? 10 : 4;
    const minCols = Platform.OS === "web" ? 4 : 2;

    const numColumns = Math.max(minCols, Math.min(maxCols, estimatedCols || 1));

    const totalGutters = gutter * (numColumns - 1);
    const computedTile = Math.floor((available - totalGutters) / numColumns);

    const finalTile = Math.min(150, Math.max(100, computedTile));
    return { numColumns, tile: finalTile, gutter };
  }, [width]);

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function init() {
    try {
      setErr("");
      setStatus("loading");

      // ✅ Do not auto-anon sign-in. We will offer a button instead.
      const { data: s1, error: e1 } = await supabase.auth.getSession();
      if (e1) throw e1;

      const uid = s1.session?.user?.id ?? "";
      setUserId(uid);

      if (uid) {
        const { data: adminRow, error: adminErr } = await supabase
          .from("photo_admins")
          .select("user_id")
          .eq("user_id", uid)
          .maybeSingle();

        if (adminErr) throw adminErr;
        setIsAdmin(!!adminRow?.user_id);
      } else {
        setIsAdmin(false);
      }

      await refreshList();
      setStatus("ready");
    } catch (e: any) {
      setStatus("error");
      setErr(e?.message || String(e));
      console.log("PHOTOS INIT ERROR:", e);
    }
  }

  async function signInGuest() {
    try {
      setBusy(true);
      setErr("");

      const { error } = await supabase.auth.signInAnonymously();
      if (error) throw error;

      // reload session + admin + list
      await init();
    } catch (e: any) {
      // Most common: "Anonymous sign-ins are disabled"
      setErr(e?.message || String(e));
      console.log("GUEST SIGN-IN ERROR:", e);
    } finally {
      setBusy(false);
    }
  }

  function publicUrlForPath(path: string) {
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  async function fetchPage(p: number) {
    const from = p * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await supabase
      .from("photo_uploads")
      .select("path,uploader,created_at")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw error;

    const safe = (data as UploadRow[] | null) ?? [];
    return safe.filter((r) => (r.path || "").startsWith(`${folderPrefix}/`));
  }

  async function refreshList() {
    try {
      setBusy(true);
      setErr("");

      setPage(0);
      setHasMore(true);
      setConfirmingDelete(false);
      setViewerOpen(false);
      setViewerIndex(-1);
      setZoom(1);

      const first = await fetchPage(0);
      setRows(first);

      if (first.length < PAGE_SIZE) setHasMore(false);
    } catch (e: any) {
      setErr(e?.message || String(e));
      console.log("PHOTOS LIST ERROR:", e);
    } finally {
      setBusy(false);
    }
  }

  async function loadMore() {
    if (busy) return;
    if (!hasMore) return;
    if (page >= MAX_PAGES) return;

    try {
      setBusy(true);
      setErr("");

      const nextPage = page + 1;
      const next = await fetchPage(nextPage);

      if (!next.length) {
        setHasMore(false);
        return;
      }

      setRows((prev) => [...prev, ...next]);
      setPage(nextPage);

      if (next.length < PAGE_SIZE) setHasMore(false);
    } catch (e: any) {
      setErr(e?.message || String(e));
      console.log("PHOTOS LOAD MORE ERROR:", e);
    } finally {
      setBusy(false);
    }
  }

  async function uploadOneWeb() {
    if (Platform.OS !== "web") return;

    if (!userId) {
      setErr("You must be signed in to upload photos.");
      return;
    }

    try {
      setBusy(true);
      setErr("");

      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.multiple = true;

      input.onchange = async () => {
        try {
          const files = Array.from(input.files ?? []);
          if (!files.length) return;

          const MAX_FILES_PER_RUN = 60;
          const chosen = files.slice(0, MAX_FILES_PER_RUN);

          for (const file of chosen) {
            const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
            const safeExt = ext.match(/^[a-z0-9]+$/) ? ext : "jpg";

            const fileName = `${Date.now()}_${Math.random().toString(16).slice(2)}.${safeExt}`;
            const path = `${folderPrefix}/${fileName}`;

            const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
              cacheControl: "3600",
              upsert: false,
              contentType: (file as any).type || "image/jpeg",
            });
            if (error) throw error;

            const { error: insErr } = await supabase.from("photo_uploads").insert({
              path,
              uploader: userId,
            });
            if (insErr) throw insErr;
          }

          await refreshList();
        } catch (e: any) {
          setErr(e?.message || String(e));
          console.log("PHOTOS UPLOAD ERROR:", e);
        } finally {
          setBusy(false);
        }
      };

      input.click();
    } catch (e: any) {
      setErr(e?.message || String(e));
      console.log("PHOTOS UPLOAD INIT ERROR:", e);
      setBusy(false);
    }
  }

  async function uploadFromPhone() {
    if (Platform.OS === "web") return;

    if (!userId) {
      setErr("You must be signed in to upload photos.");
      return;
    }

    try {
      setBusy(true);
      setErr("");

      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setErr("Photo library permission denied.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        selectionLimit: 30,
        quality: 0.9,
      });

      if (result.canceled) return;

      const assets = result.assets || [];
      if (!assets.length) return;

      for (const asset of assets) {
        const uri = asset.uri;

        const converted = await manipulateAsync(uri, [], {
          compress: 0.9,
          format: SaveFormat.JPEG,
        });

        const jpegUri = converted.uri;

        const base64 = await FileSystem.readAsStringAsync(jpegUri, { encoding: "base64" as any });
        const bytes = base64ToUint8Array(base64);

        const fileName = `${Date.now()}_${Math.random().toString(16).slice(2)}.jpg`;
        const path = `${folderPrefix}/${fileName}`;

        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, {
          cacheControl: "3600",
          upsert: false,
          contentType: "image/jpeg",
        });
        if (upErr) throw upErr;

        const { error: insErr } = await supabase.from("photo_uploads").insert({
          path,
          uploader: userId,
        });
        if (insErr) throw insErr;
      }

      await refreshList();
    } catch (e: any) {
      setErr(e?.message || String(e));
      console.log("PHOTOS PHONE UPLOAD ERROR:", e);
    } finally {
      setBusy(false);
    }
  }

  function openViewerByIndex(index: number) {
    setViewerIndex(index);
    setViewerOpen(true);
    setConfirmingDelete(false);
    setZoom(1);
  }

  function closeViewer() {
    setViewerOpen(false);
    setViewerIndex(-1);
    setConfirmingDelete(false);
    setZoom(1);
  }

  const currentRow = useMemo(() => {
    if (viewerIndex < 0 || viewerIndex >= rows.length) return null;
    return rows[viewerIndex];
  }, [viewerIndex, rows]);

  const currentPath = currentRow?.path || "";
  const currentUrl = currentPath ? publicUrlForPath(currentPath) : "";
  const currentName = currentPath ? basename(currentPath) : "Photo";

  const canDeleteCurrent = useMemo(() => {
    if (!userId || !currentRow) return false;
    if (isAdmin) return true;
    return currentRow.uploader === userId;
  }, [userId, isAdmin, currentRow]);

  const hasPrev = viewerIndex > 0;
  const hasNext = viewerIndex >= 0 && viewerIndex < rows.length - 1;

  useEffect(() => {
    if (!viewerOpen) return;
    if (Platform.OS !== "web") return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!viewerOpen) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (hasPrev) openViewerByIndex(viewerIndex - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (hasNext) openViewerByIndex(viewerIndex + 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeViewer();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerOpen, viewerIndex, hasPrev, hasNext]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) => {
        if (!viewerOpen) return false;
        if (zoom !== 1) return false;
        return Math.abs(gesture.dx) > Math.abs(gesture.dy) && Math.abs(gesture.dx) > 12;
      },
      onMoveShouldSetPanResponderCapture: (_evt, gesture) => {
        if (!viewerOpen) return false;
        if (zoom !== 1) return false;
        return Math.abs(gesture.dx) > Math.abs(gesture.dy) && Math.abs(gesture.dx) > 12;
      },
      onPanResponderRelease: (_evt, gesture) => {
        if (zoom !== 1) return;

        const SWIPE_THRESHOLD = 60;
        if (gesture.dx > SWIPE_THRESHOLD) {
          if (hasPrev) openViewerByIndex(viewerIndex - 1);
        } else if (gesture.dx < -SWIPE_THRESHOLD) {
          if (hasNext) openViewerByIndex(viewerIndex + 1);
        }
      },
    })
  ).current;

  async function doDeleteNow() {
    if (!currentRow || !currentPath) return;

    try {
      setBusy(true);
      setErr("");

      const { error: delErr } = await supabase.storage.from(BUCKET).remove([currentPath]);
      if (delErr) throw delErr;

      const { error: rowDelErr } = await supabase.from("photo_uploads").delete().eq("path", currentPath);
      if (rowDelErr) throw rowDelErr;

      const newRows = rows.filter((r) => r.path !== currentPath);
      setRows(newRows);

      setConfirmingDelete(false);

      if (newRows.length === 0) {
        closeViewer();
        setHasMore(false);
        return;
      }

      const nextIndex = Math.min(viewerIndex, newRows.length - 1);
      setViewerIndex(nextIndex);
    } catch (e: any) {
      setErr(e?.message || String(e));
      console.log("PHOTOS DELETE ERROR:", e);
    } finally {
      setBusy(false);
    }
  }

  function zoomIn() {
    setZoom((z) => Math.min(4, Number((z + 0.5).toFixed(2))));
  }
  function zoomOut() {
    setZoom((z) => Math.max(1, Number((z - 0.5).toFixed(2))));
  }
  function resetZoom() {
    setZoom(1);
  }

  const viewerHeight = useMemo(() => {
    const usable = Math.max(260, height - 220);
    return usable;
  }, [height]);

  if (status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.sub}>&nbsp;Loading...</Text>
      </View>
    );
  }

  if (status === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.err}>Photos failed</Text>
        {!!err && <Text style={styles.err}>{err}</Text>}
        <Pressable style={styles.btn} onPress={init}>
          <Text style={styles.btnText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        key={`cols-${grid.numColumns}`}
        data={rows}
        keyExtractor={(r) => r.path}
        numColumns={grid.numColumns}
        columnWrapperStyle={grid.numColumns > 1 ? { gap: grid.gutter } : undefined}
        contentContainerStyle={{ paddingBottom: 24, gap: grid.gutter }}
        // ✅ scroll from anywhere (header is inside the scrollable list)
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>Photos</Text>
            {!!err && <Text style={styles.err}>{err}</Text>}

            <Text style={styles.sub}>
              {userId ? `Signed in ✅ ${isAdmin ? "(Admin)" : ""}` : "Not signed in (view-only)"}
            </Text>

            <View style={styles.row}>
              <Pressable style={[styles.btn, busy && styles.btnDisabled]} onPress={refreshList} disabled={busy}>
                <Text style={styles.btnText}>Refresh List</Text>
              </Pressable>

              {!userId && (
                <Pressable style={[styles.btn, busy && styles.btnDisabled]} onPress={signInGuest} disabled={busy}>
                  <Text style={styles.btnText}>Sign in (Guest)</Text>
                </Pressable>
              )}

              {Platform.OS !== "web" && (
                <Pressable style={[styles.btn, busy && styles.btnDisabled]} onPress={uploadFromPhone} disabled={busy}>
                  <Text style={styles.btnText}>Upload (Phone)</Text>
                </Pressable>
              )}

              {Platform.OS === "web" && (
                <Pressable style={[styles.btn, busy && styles.btnDisabled]} onPress={uploadOneWeb} disabled={busy}>
                  <Text style={styles.btnText}>Upload (Web)</Text>
                </Pressable>
              )}
            </View>

            <Text style={styles.sub}>Folder: photos/{folderPrefix}/</Text>
            <Text style={styles.sub}>
              Viewer: use <Text style={{ fontWeight: "800" }}>← →</Text> (desktop) or swipe (mobile).
            </Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const url = publicUrlForPath(item.path);

          return (
            <Pressable style={[styles.tile, { width: grid.tile, height: grid.tile + 28 }]} onPress={() => openViewerByIndex(index)}>
              <Image source={{ uri: url }} style={[styles.tileImage, { width: grid.tile, height: grid.tile }]} resizeMode="cover" />
              <Text style={styles.tileText} numberOfLines={1}>
                {basename(item.path)}
              </Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.sub}>No photos yet.</Text>
          </View>
        }
        ListFooterComponent={
          hasMore ? (
            <View style={{ paddingTop: 12 }}>
              <Pressable style={[styles.btn, busy && styles.btnDisabled]} onPress={loadMore} disabled={busy}>
                <Text style={styles.btnText}>Load More</Text>
              </Pressable>
              <Text style={styles.sub}>&nbsp;Loaded {rows.length} photo(s)</Text>
            </View>
          ) : rows.length > 0 ? (
            <View style={{ paddingTop: 12 }}>
              <Text style={styles.sub}>No more photos to load.</Text>
            </View>
          ) : null
        }
      />

      <Modal visible={viewerOpen} animationType="fade" transparent onRequestClose={closeViewer} presentationStyle="overFullScreen">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={1}>
                {currentName}
              </Text>

              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <Pressable
                  style={[styles.actionBtn, (!hasPrev || busy) && styles.btnDisabled]}
                  onPress={() => hasPrev && openViewerByIndex(viewerIndex - 1)}
                  disabled={!hasPrev || busy}
                >
                  <Text style={styles.actionText}>Prev</Text>
                </Pressable>

                <Pressable
                  style={[styles.actionBtn, (!hasNext || busy) && styles.btnDisabled]}
                  onPress={() => hasNext && openViewerByIndex(viewerIndex + 1)}
                  disabled={!hasNext || busy}
                >
                  <Text style={styles.actionText}>Next</Text>
                </Pressable>

                <Pressable style={[styles.actionBtn, zoom <= 1 && styles.btnDisabled]} onPress={zoomOut} disabled={zoom <= 1}>
                  <Text style={styles.actionText}>Zoom −</Text>
                </Pressable>
                <Pressable style={[styles.actionBtn, zoom >= 4 && styles.btnDisabled]} onPress={zoomIn} disabled={zoom >= 4}>
                  <Text style={styles.actionText}>Zoom +</Text>
                </Pressable>
                <Pressable style={[styles.actionBtn, zoom === 1 && styles.btnDisabled]} onPress={resetZoom} disabled={zoom === 1}>
                  <Text style={styles.actionText}>Reset</Text>
                </Pressable>

                {canDeleteCurrent && !confirmingDelete && (
                  <Pressable style={[styles.actionBtn, styles.deleteBtn, busy && styles.btnDisabled]} onPress={() => setConfirmingDelete(true)} disabled={busy}>
                    <Text style={styles.actionText}>Delete</Text>
                  </Pressable>
                )}

                <Pressable style={[styles.actionBtn, busy && styles.btnDisabled]} onPress={closeViewer} disabled={busy}>
                  <Text style={styles.actionText}>Close</Text>
                </Pressable>
              </View>
            </View>

            {!!currentUrl && (
              <View style={{ flex: 1 }}>
                <View style={{ flex: 1 }} {...panResponder.panHandlers}>
                  <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={{ alignItems: "center", justifyContent: "center", backgroundColor: "#000" }}
                    maximumZoomScale={Platform.OS === "ios" ? 4 : undefined}
                    minimumZoomScale={Platform.OS === "ios" ? 1 : undefined}
                    bounces={false}
                    showsHorizontalScrollIndicator={false}
                    showsVerticalScrollIndicator={false}
                    scrollEnabled={zoom > 1}
                  >
                    <View style={{ width: width, height: viewerHeight, alignItems: "center", justifyContent: "center" }}>
                      <Image source={{ uri: currentUrl }} resizeMode="contain" style={{ width: width, height: viewerHeight, transform: [{ scale: zoom }] }} />
                    </View>
                  </ScrollView>
                </View>
              </View>
            )}

            {canDeleteCurrent && confirmingDelete && (
              <View style={styles.confirmBar}>
                <Text style={styles.confirmText}>Confirm delete?</Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Pressable style={[styles.actionBtn, styles.cancelBtn, busy && styles.btnDisabled]} onPress={() => setConfirmingDelete(false)} disabled={busy}>
                    <Text style={styles.actionText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={[styles.actionBtn, styles.deleteBtn, busy && styles.btnDisabled]} onPress={doDeleteNow} disabled={busy}>
                    <Text style={styles.actionText}>Confirm Delete</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12 },
  header: { marginBottom: 12, gap: 6 },
  title: { fontSize: 22, fontWeight: "700" },
  sub: { fontSize: 13, opacity: 0.8 },
  err: { fontSize: 13, color: "#cc0000" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },

  btn: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "#111", alignSelf: "flex-start" },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: "#fff", fontWeight: "600" },

  tile: { borderRadius: 12, borderWidth: 1, borderColor: "#ddd", overflow: "hidden", backgroundColor: "#fff" },
  tileImage: { backgroundColor: "#eee" },
  tileText: { paddingHorizontal: 8, paddingVertical: 6, fontSize: 12, fontWeight: "700" },

  empty: { padding: 16, alignItems: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", padding: 12, justifyContent: "center" },
  modalCard: { backgroundColor: "#fff", borderRadius: 14, overflow: "hidden", maxHeight: "95%", flex: 1 },
  modalHeader: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  modalTitle: { fontSize: 14, fontWeight: "700", flex: 1 },

  actionBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: "#111" },
  actionText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  deleteBtn: { backgroundColor: "#b00020" },
  cancelBtn: { backgroundColor: "#333" },

  confirmBar: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#eee",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  confirmText: { fontSize: 13, fontWeight: "700" },
});
