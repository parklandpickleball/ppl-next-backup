import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "../../constants/supabaseClient";
import { useAdminSession } from "../../lib/adminSession";
import Logo from "../../components/ui/logo";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { registerExpoPushToken } from "@/constants/registerPushToken";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

type AppSettingsRow = { current_season_id: string | null };

type AnnouncementRow = {
  id: string;
  season_id: string;
  author_id: string | null;
  author_name: string;
  is_admin: boolean;
  body: string;
  created_at: string;
};

type ReplyRow = {
  id: string;
  announcement_id: string;
  season_id: string;
  author_id: string | null;
  author_name: string;
  is_admin: boolean;
  body: string;
  created_at: string;
};

type Post = AnnouncementRow & { replies: ReplyRow[] };

const COLORS = {
  bg: "#FFFFFF",
  text: "#111827",
  subtext: "#374151",
  border: "#111827",
  rowBorder: "#E5E7EB",
  blue: "#2563EB",
  danger: "#b00020",
  cardBg: "#FFFFFF",
  soft: "#F3F4F6",
};

function fmtTime(ts: string) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AnnouncementsScreen() {
  const { isAdminUnlocked } = useAdminSession();
  const isAdmin = !!isAdminUnlocked;

  const [loading, setLoading] = useState(true);
  const [seasonId, setSeasonId] = useState<string | null>(null);

  const [meId, setMeId] = useState<string | null>(null);
  const [meName, setMeName] = useState<string>("Community");

  const [posts, setPosts] = useState<Post[]>([]);
  const [text, setText] = useState("");

  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  const [errorMsg, setErrorMsg] = useState<string>("");

  // ✅ PUSH: run once, non-blocking, and NEVER on web
  const registerForPushNotifications = useCallback(async () => {
    try {
      if (Platform.OS === "web") return;

      const perms = await Notifications.getPermissionsAsync();
      let finalStatus = perms.status;

      if (finalStatus !== "granted") {
        const req = await Notifications.requestPermissionsAsync();
        finalStatus = req.status;
      }

      if (finalStatus !== "granted") {
        console.log("❌ Push permission not granted");
        return;
      }

      const projectId =
        Constants?.expoConfig?.extra?.eas?.projectId ||
        (Constants as any)?.easConfig?.projectId ||
        (Constants as any)?.expoConfig?.extra?.eas?.projectId ||
        null;

      if (!projectId) {
        console.log("❌ No EAS projectId found in app config (extra.eas.projectId).");
        return;
      }

      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      await registerExpoPushToken({ expoPushToken: token });

      console.log("✅ EXPO PUSH TOKEN:", token);
    } catch (e: any) {
      console.log("❌ Push registration error:", e?.message || e);
    }
  }, []);

  const loadSeason = useCallback(async () => {
    const { data, error } = await supabase
      .from("app_settings")
      .select("current_season_id")
      .single<AppSettingsRow>();

    if (error || !data?.current_season_id) {
      setSeasonId(null);
      setErrorMsg("Current season is not set.");
      return null;
    }

    setSeasonId(data.current_season_id);
    return data.current_season_id;
  }, []);

  const loadMe = useCallback(
    async (sid: string | null) => {
      try {
        let { data } = await supabase.auth.getUser();
let uid = data?.user?.id ?? null;

// If AdminSession is unlocked, always post as ADMIN
if (isAdmin) {
  setMeId(uid);
  setMeName("ADMIN");
  return;
}

// ✅ If no auth user, silently sign in anonymously so posts have author_id
if (!uid) {
  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw error;

  const { data: d2 } = await supabase.auth.getUser();
  uid = d2?.user?.id ?? null;
}

setMeId(uid);

// Still no uid? then truly fallback
if (!uid) {
  setMeName("Community");
  return;
}


        const { data: profile } = await supabase
          .from("user_season_profiles")
          .select("player_name, team_id")
          .eq("season_id", sid)
          .eq("user_id", uid)
          .maybeSingle<any>();

        const player = (profile?.player_name ?? "").trim();
        const teamId = profile?.team_id ?? null;

        let teamName = "";
        if (teamId) {
          const { data: team } = await supabase
            .from("teams")
            .select("team_name")
            .eq("id", teamId)
            .maybeSingle<any>();

          teamName = (team?.team_name ?? "").trim();
        }

        if (player) {
          const label = teamName ? `${player} (${teamName})` : `${player}`;
          setMeName(label);
        } else {
          setMeName("Community");
        }
      } catch {
        setMeId(null);
        setMeName(isAdmin ? "ADMIN" : "Community");
      }
    },
    [isAdmin]
  );

  const loadAll = useCallback(async (sid: string | null) => {
    if (!sid) {
      setPosts([]);
      return;
    }

    setErrorMsg("");

    const { data: annRows, error: annErr } = await supabase
      .from("announcements")
      .select("id,season_id,author_id,author_name,is_admin,body,created_at")
      .eq("season_id", sid)
      .order("created_at", { ascending: false });

    if (annErr) {
      setPosts([]);
      setErrorMsg(annErr.message || "Could not load announcements.");
      return;
    }

    const anns = (annRows ?? []) as AnnouncementRow[];
    if (!anns.length) {
      setPosts([]);
      return;
    }

    const ids = anns.map((a) => a.id);

    const { data: repRows, error: repErr } = await supabase
      .from("announcement_replies")
      .select("id,announcement_id,season_id,author_id,author_name,is_admin,body,created_at")
      .in("announcement_id", ids)
      .order("created_at", { ascending: true });

    if (repErr) {
      const postsNoReplies: Post[] = anns.map((a) => ({ ...a, replies: [] }));
      setPosts(postsNoReplies);
      return;
    }

    const replies = (repRows ?? []) as ReplyRow[];
    const grouped: Record<string, ReplyRow[]> = {};
    replies.forEach((r) => {
      if (!grouped[r.announcement_id]) grouped[r.announcement_id] = [];
      grouped[r.announcement_id].push(r);
    });

    const merged: Post[] = anns.map((a) => ({ ...a, replies: grouped[a.id] || [] }));
    setPosts(merged);
  }, []);

  const boot = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");

    const sid = await loadSeason();
    await loadMe(sid);
    await loadAll(sid);

    setLoading(false);
  }, [loadSeason, loadMe, loadAll]);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    void registerForPushNotifications();
  }, [registerForPushNotifications]);

  useFocusEffect(
    useCallback(() => {
      void boot();
    }, [boot])
  );

  const postingAsLabel = useMemo(() => {
    return `Posting as: ${isAdmin ? "ADMIN" : meName}`;
  }, [isAdmin, meName]);

  // ✅ CORRECT RULE:
  // - Admin (unlocked) can delete any
  // - Users can delete ONLY if author_id === meId
  // - NO name-based fallback (that was allowing unintended deletes)
 const canDeleteAnnouncement = (p: AnnouncementRow) => {
  if (isAdmin) return true;
  if (!meId) return false;

  // ✅ Non-admin users can NEVER delete admin posts (even if author_id matches)
  if (p.is_admin) return false;

  return (p.author_id ?? null) === meId;
};

const canDeleteReply = (r: ReplyRow) => {
  if (isAdmin) return true;
  if (!meId) return false;

  // ✅ Non-admin users can NEVER delete admin replies
  if (r.is_admin) return false;

  return (r.author_id ?? null) === meId;
};


  const postAnnouncement = async () => {
    const body = (text ?? "").trim();
    if (!body) return;

    if (!seasonId) {
      Alert.alert("Error", "Current season is not set.");
      return;
    }

    try {
      const payload = {
        season_id: seasonId,
        author_id: isAdmin ? null : (meId ?? null),
        author_name: isAdmin ? "ADMIN" : (meName || "Community"),
        is_admin: !!isAdmin,
        body,
      };

      const { error } = await supabase.from("announcements").insert(payload);
      if (error) throw error;

      setText("");
      await loadAll(seasonId);
    } catch (e: any) {
      Alert.alert("Post failed", e?.message || "Could not post announcement.");
    }
  };

  const postReply = async (announcementId: string) => {
    const body = (replyText ?? "").trim();
    if (!body) return;

    if (!seasonId) {
      Alert.alert("Error", "Current season is not set.");
      return;
    }

    try {
      const payload = {
        announcement_id: announcementId,
        season_id: seasonId,
        author_id: isAdmin ? null : (meId ?? null),
        author_name: isAdmin ? "ADMIN" : (meName || "Community"),
        is_admin: !!isAdmin,
        body,
      };

      const { error } = await supabase.from("announcement_replies").insert(payload);
      if (error) throw error;

      setReplyText("");
      setReplyingTo(null);
      await loadAll(seasonId);
    } catch (e: any) {
      Alert.alert("Reply failed", e?.message || "Could not post reply.");
    }
  };

  const deleteAnnouncement = async (p: AnnouncementRow) => {
    if (!canDeleteAnnouncement(p)) return;

    const ok = Platform.OS === "web" ? window.confirm("Delete this post?") : true;
    if (!ok) return;

    try {
      const { data: deleted, error } = await supabase
        .from("announcements")
        .delete()
        .eq("id", p.id)
        .select("id");

      if (error) throw error;

      // ✅ If RLS blocks, sometimes you get 0 rows deleted without a helpful error
      if (!deleted || deleted.length === 0) {
        throw new Error("Delete was blocked by permissions (RLS).");
      }

      await loadAll(seasonId);
    } catch (e: any) {
      Alert.alert("Delete failed", e?.message || "Could not delete.");
    }
  };

  const deleteReply = async (r: ReplyRow) => {
    if (!canDeleteReply(r)) return;

    const ok = Platform.OS === "web" ? window.confirm("Delete this reply?") : true;
    if (!ok) return;

    try {
      const { data: deleted, error } = await supabase
        .from("announcement_replies")
        .delete()
        .eq("id", r.id)
        .select("id");

      if (error) throw error;

      if (!deleted || deleted.length === 0) {
        throw new Error("Delete was blocked by permissions (RLS).");
      }

      await loadAll(seasonId);
    } catch (e: any) {
      Alert.alert("Delete failed", e?.message || "Could not delete.");
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 10, color: COLORS.text, fontWeight: "800" }}>Loading announcements…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 30 }}>
          <Text style={{ fontSize: 28, fontWeight: "900", color: COLORS.text }}>Announcements</Text>
          <Text style={{ marginTop: 6, fontSize: 14, fontWeight: "800", color: COLORS.subtext }}>
            {postingAsLabel}
          </Text>

          {errorMsg ? (
            <View
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 12,
                backgroundColor: "#FEE2E2",
                borderWidth: 1,
                borderColor: "#EF4444",
              }}
            >
              <Text style={{ fontWeight: "900", color: "#991B1B" }}>{errorMsg}</Text>
            </View>
          ) : null}

          <View
            style={{
              marginTop: 12,
              borderWidth: 2,
              borderColor: COLORS.blue,
              borderRadius: 14,
              padding: 12,
              backgroundColor: "#fff",
            }}
          >
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Type a message…"
              multiline
              style={{
                minHeight: 60,
                borderWidth: 2,
                borderColor: COLORS.rowBorder,
                borderRadius: 12,
                padding: 12,
                fontWeight: "800",
                color: COLORS.text,
              }}
            />

            <Pressable
              onPress={() => void postAnnouncement()}
              style={{
                marginTop: 10,
                backgroundColor: "#000",
                paddingVertical: 14,
                borderRadius: 12,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>Post</Text>
            </Pressable>
          </View>

          <View style={{ marginTop: 14, gap: 12 }}>
            {posts.length === 0 ? (
              <Text style={{ marginTop: 6, fontWeight: "900", color: COLORS.text }}>No announcements yet.</Text>
            ) : (
              posts.map((p) => {
                const headerLabel = p.is_admin ? "ADMIN" : "COMMUNITY";

                return (
                  <View
                    key={p.id}
                    style={{
                      borderWidth: 1,
                      borderColor: COLORS.rowBorder,
                      borderRadius: 14,
                      backgroundColor: COLORS.cardBg,
                      padding: 12,
                    }}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        {p.is_admin ? (
                          <View
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 18,
                              overflow: "hidden",
                              alignItems: "center",
                              justifyContent: "center",
                              marginRight: 4,
                            }}
                          >
                            <Logo size={36} />
                          </View>
                        ) : null}

                        <Text style={{ fontWeight: "900", color: COLORS.text }}>{headerLabel}</Text>
                      </View>

                      {canDeleteAnnouncement(p) ? (
                        <Pressable onPress={() => void deleteAnnouncement(p)}>
                          <Text style={{ fontWeight: "900", color: COLORS.text }}>Delete</Text>
                        </Pressable>
                      ) : null}
                    </View>

                    <Text style={{ marginTop: 6, fontSize: 12, fontWeight: "800", color: COLORS.subtext }}>
                      {p.author_name} • {fmtTime(p.created_at)}
                    </Text>

                    <Text style={{ marginTop: 8, fontSize: 15, fontWeight: "700", color: COLORS.text }}>{p.body}</Text>

                    <Pressable onPress={() => setReplyingTo((cur) => (cur === p.id ? null : p.id))} style={{ marginTop: 10 }}>
                      <Text style={{ fontWeight: "900", color: COLORS.blue }}>
                        {replyingTo === p.id ? "Close replies" : "Reply"}
                      </Text>
                    </Pressable>

                    {replyingTo === p.id ? (
                      <View style={{ marginTop: 10, gap: 8 }}>
                        <TextInput
                          value={replyText}
                          onChangeText={setReplyText}
                          placeholder="Write a reply…"
                          multiline
                          style={{
                            minHeight: 50,
                            borderWidth: 2,
                            borderColor: COLORS.rowBorder,
                            borderRadius: 12,
                            padding: 10,
                            fontWeight: "800",
                            color: COLORS.text,
                            backgroundColor: "#fff",
                          }}
                        />

                        <Pressable
                          onPress={() => void postReply(p.id)}
                          style={{
                            backgroundColor: "#111",
                            paddingVertical: 12,
                            borderRadius: 12,
                            alignItems: "center",
                          }}
                        >
                          <Text style={{ color: "#fff", fontWeight: "900" }}>Post Reply</Text>
                        </Pressable>
                      </View>
                    ) : null}

                    {p.replies.length ? (
                      <View style={{ marginTop: 12, gap: 8 }}>
                        {p.replies.map((r) => (
                          <View
                            key={r.id}
                            style={{
                              borderWidth: 1,
                              borderColor: COLORS.rowBorder,
                              borderRadius: 12,
                              padding: 10,
                              backgroundColor: COLORS.soft,
                            }}
                          >
                            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                {r.is_admin ? (
                                  <View
                                    style={{
                                      width: 36,
                                      height: 36,
                                      borderRadius: 18,
                                      overflow: "hidden",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      marginRight: 4,
                                    }}
                                  >
                                    <Logo size={36} />
                                  </View>
                                ) : null}

                                <Text style={{ fontWeight: "900", color: COLORS.text }}>
                                  {r.is_admin ? "ADMIN" : r.author_name}
                                </Text>
                              </View>

                              {canDeleteReply(r) ? (
                                <Pressable onPress={() => void deleteReply(r)}>
                                  <Text style={{ fontWeight: "900", color: COLORS.text }}>Delete</Text>
                                </Pressable>
                              ) : null}
                            </View>

                            <Text style={{ marginTop: 6, fontSize: 12, fontWeight: "800", color: COLORS.subtext }}>
                              {fmtTime(r.created_at)}
                            </Text>

                            <Text style={{ marginTop: 6, fontSize: 14, fontWeight: "700", color: COLORS.text }}>{r.body}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
