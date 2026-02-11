import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
  ActivityIndicator,
  Platform,
  Modal,
} from "react-native";
import * as SecureStore from "expo-secure-store";
import { supabase } from "@/constants/supabaseClient";

type AppSettingsRow = {
  current_season_id: string | null;
  league_code: string | null;
};

const ACCEPTED_SEASON_KEY = "PPL_ACCEPTED_SEASON_ID_V3";

// ✅ Web uses localStorage, native uses SecureStore
async function getAcceptedSeasonId(): Promise<string> {
  try {
    if (Platform.OS === "web") {
      return window?.localStorage?.getItem(ACCEPTED_SEASON_KEY) ?? "";
    }
    return (await SecureStore.getItemAsync(ACCEPTED_SEASON_KEY)) ?? "";
  } catch {
    return "";
  }
}

async function setAcceptedSeasonId(seasonId: string): Promise<void> {
  try {
    if (Platform.OS === "web") {
      window?.localStorage?.setItem(ACCEPTED_SEASON_KEY, seasonId);
      return;
    }
    await SecureStore.setItemAsync(ACCEPTED_SEASON_KEY, seasonId);
  } catch {
    // ignore
  }
}

export default function LeagueLockScreen() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);

  // Admin setup modal (cross-platform)
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminPass, setAdminPass] = useState("");

  useEffect(() => {
    const ensureSessionAndLoad = async () => {
      // ✅ ENSURE USER SESSION
      let userRes = await supabase.auth.getUser();
      let userId = userRes.data.user?.id ?? null;

      if (!userId) {
        const anon = await supabase.auth.signInAnonymously();
        if (anon.error) {
          Alert.alert("Error", "Could not start user session.");
          setLoading(false);
          return;
        }
        userRes = await supabase.auth.getUser();
        userId = userRes.data.user?.id ?? null;
      }

      if (!userId) {
        Alert.alert("Error", "User session not available.");
        setLoading(false);
        return;
      }

      // ✅ load league settings
      const { data, error } = await supabase
        .from("app_settings")
        .select("current_season_id, league_code")
        .single<AppSettingsRow>();

      if (error || !data?.league_code || !data.current_season_id) {
        Alert.alert(
          "Setup Required",
          "League is not ready yet. Please contact the admin."
        );
        setLoading(false);
        return;
      }

      // ✅ if device already unlocked THIS season, skip password screen
      const acceptedSeasonId = await getAcceptedSeasonId();
      if (acceptedSeasonId && acceptedSeasonId === data.current_season_id) {
        router.replace("choose-team" as any);
        return;
      }

      setLoading(false);
    };

    void ensureSessionAndLoad();
  }, [router]);

  const onUnlock = async () => {
    const cleaned = code.trim();
    if (!cleaned) {
      Alert.alert("Enter code", "Please enter the league access code.");
      return;
    }

    const userRes = await supabase.auth.getUser();
    const userId = userRes.data.user?.id;

    if (!userId) {
      Alert.alert("Error", "User session not available.");
      return;
    }

    const { data: settings } = await supabase
      .from("app_settings")
      .select("current_season_id, league_code")
      .single<AppSettingsRow>();

    if (!settings?.league_code || !settings.current_season_id) {
      Alert.alert("Error", "League settings are missing.");
      return;
    }

    if (cleaned !== settings.league_code) {
      Alert.alert("Wrong code", "That code is not correct.");
      return;
    }

    // ✅ ensure season profile exists
    await supabase.from("user_season_profiles").upsert({
      user_id: userId,
      season_id: settings.current_season_id,
    });

    // ✅ remember this device has unlocked THIS season
    await setAcceptedSeasonId(settings.current_season_id);

    router.replace("choose-team" as any);
  };

  const openAdminSetup = () => {
    setAdminPass("");
    setAdminModalOpen(true);
  };

  const confirmAdminSetup = async () => {
    const pass = adminPass.trim();
    if (pass !== "2468") {
      Alert.alert("Wrong passcode", "That admin passcode is not correct.");
      return;
    }

    setAdminModalOpen(false);

    // Go straight to Admin tab (bypass teams/players)
    router.replace("/(tabs)/admin" as any);
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
      <Text style={{ fontSize: 28, fontWeight: "900", marginBottom: 10 }}>
        Parkland Pickleball League
      </Text>

      <Text style={{ marginBottom: 16 }}>
        Enter the league access code to continue.
      </Text>

      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder="League access code"
        autoCapitalize="characters"
        autoCorrect={false}
        style={{
          borderWidth: 2,
          borderColor: "#000",
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontSize: 16,
          marginBottom: 14,
        }}
      />

      <Pressable
        onPress={onUnlock}
        style={{
          backgroundColor: "black",
          paddingVertical: 14,
          borderRadius: 12,
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <Text style={{ color: "white", fontWeight: "900", fontSize: 16 }}>
          Unlock
        </Text>
      </Pressable>

      <Pressable
        onPress={openAdminSetup}
        style={{
          backgroundColor: "#ddd",
          paddingVertical: 12,
          borderRadius: 12,
          alignItems: "center",
        }}
      >
        <Text style={{ color: "#000", fontWeight: "900", fontSize: 14 }}>
          Admin Setup
        </Text>
      </Pressable>

      {/* Admin passcode modal (works on iOS/Android/Web) */}
      <Modal
        visible={adminModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAdminModalOpen(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.55)",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <View
            style={{
              backgroundColor: "white",
              borderRadius: 14,
              padding: 16,
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: "900", marginBottom: 8 }}>
              Admin Setup
            </Text>
            <Text style={{ color: "#444", marginBottom: 12 }}>
              Enter admin passcode to open Admin (works even if no teams exist).
            </Text>

            <TextInput
              value={adminPass}
              onChangeText={setAdminPass}
              placeholder="Admin passcode"
              secureTextEntry
              autoCorrect={false}
              style={{
                borderWidth: 2,
                borderColor: "#000",
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 16,
                marginBottom: 12,
              }}
            />

            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={() => setAdminModalOpen(false)}
                style={{
                  flex: 1,
                  backgroundColor: "#ddd",
                  paddingVertical: 12,
                  borderRadius: 12,
                  alignItems: "center",
                }}
              >
                <Text style={{ fontWeight: "900" }}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={confirmAdminSetup}
                style={{
                  flex: 1,
                  backgroundColor: "black",
                  paddingVertical: 12,
                  borderRadius: 12,
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "white", fontWeight: "900" }}>
                  Continue
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
