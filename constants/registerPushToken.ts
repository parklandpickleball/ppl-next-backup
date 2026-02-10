import { Platform } from "react-native";
import { supabase } from "./supabaseClient";

/**
 * Registers (or refreshes) the current user's Expo push token in Supabase.
 * Safe to call repeatedly (upserts by expo_push_token unique index).
 */
export async function registerExpoPushToken(params: {
  expoPushToken: string;
  seasonId?: string | null;
}) {
  const { expoPushToken, seasonId = null } = params;

  if (!expoPushToken) return;

  // Must be signed in (table is user-scoped via RLS)
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user?.id) {
    // Not logged in or session not ready yet; just skip
    return;
  }

  const payload = {
    user_id: user.id,
    season_id: seasonId,
    expo_push_token: expoPushToken,
    platform: Platform.OS,
    last_seen_at: new Date().toISOString(),
  };

  // Upsert by unique expo_push_token
  const { error } = await supabase
    .from("user_push_tokens")
    .upsert(payload, { onConflict: "expo_push_token" });

  if (error) {
    // Don’t throw (never break app if token save fails)
    console.log("registerExpoPushToken error:", error.message);
  }
}
