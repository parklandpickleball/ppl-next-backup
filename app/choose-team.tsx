import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Alert,
  ScrollView,
  Modal,
  TextInput,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "@/constants/supabaseClient";

type TeamRow = {
  id: string;
  team_name: string;
};
const WEB_LAST_TEAM_KEY = "PPL_WEB_LAST_TEAM_ID_V1";


export default function ChooseTeamScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  // Admin setup modal (works on iOS/Android/Web)
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminPass, setAdminPass] = useState("");

  useEffect(() => {
    const loadTeams = async () => {
      try {
        const { data: settings } = await supabase
          .from("app_settings")
          .select("current_season_id")
          .single();

        const seasonId = settings?.current_season_id;
        if (!seasonId) {
          Alert.alert("Not ready", "Season is not set yet.");
          return;
        }

        const { data: teamRows } = await supabase
          .from("teams")
          .select("id, team_name")
          .eq("season_id", seasonId)
          .eq("is_active", true)
          .order("team_name");

        if (!teamRows || teamRows.length === 0) {
          // IMPORTANT: Don’t trap admin. They can use Admin Setup below.
          setTeams([]);
          return;
        }

setTeams(teamRows);

// ✅ WEB ONLY: skip only if season profile already has team_id
if (Platform.OS === "web") {
  const { data: { user } } = await supabase.auth.getUser();

  if (user && settings?.current_season_id) {
    const { data: profile } = await supabase
      .from("user_season_profiles")
      .select("team_id")
      .eq("user_id", user.id)
      .eq("season_id", settings.current_season_id)
      .maybeSingle();

    if (profile?.team_id) {
      router.replace("/choose-player" as any);
      return;
    }
  }
}





      } finally {
        setLoading(false);
      }
    };

    void loadTeams();
  }, []);

  const handleTeamSelect = async (teamId: string) => {
    setSelectedTeamId(teamId);
    setSaving(true);

    try {
      const userRes = await supabase.auth.getUser();
      const userId = userRes.data.user?.id;
      if (!userId) return;

      const { data: settings } = await supabase
        .from("app_settings")
        .select("current_season_id")
        .single();

      const seasonId = settings?.current_season_id;
      if (!seasonId) return;

      const { error } = await supabase
        .from("user_season_profiles")
        .upsert(
          {
            user_id: userId,
            season_id: seasonId,
            team_id: teamId,
          },
          { onConflict: "user_id,season_id" }
        );

      if (error) {
        Alert.alert("Error", error.message);
        return;
      }

            // ✅ WEB ONLY: remember their last selected team for next time
      if (Platform.OS === "web") {
        window?.localStorage?.setItem(WEB_LAST_TEAM_KEY, teamId);
      }

      router.replace("/choose-player" as any);

    } finally {
      setSaving(false);
    }
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
    <View style={{ flex: 1, padding: 20 }}>
      <Text style={{ fontSize: 26, fontWeight: "900", marginBottom: 10 }}>
        Choose Your Team
      </Text>

      <Text style={{ marginBottom: 16, color: "#555" }}>
        Select the team you are playing on for this season.
      </Text>

      {teams.length === 0 ? (
        <View style={{ marginTop: 10 }}>
          <Text style={{ color: "#b00020", fontWeight: "800", marginBottom: 12 }}>
            Teams are not set up for this season yet.
          </Text>

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
        </View>
      ) : (
        <>
          <ScrollView>
            {teams.map((team) => {
              const selected = team.id === selectedTeamId;
              return (
                <Pressable
                  key={team.id}
                  onPress={() => handleTeamSelect(team.id)}
                  disabled={saving}
                  style={{
                    padding: 16,
                    borderRadius: 12,
                    borderWidth: 2,
                    borderColor: selected ? "#000" : "#ddd",
                    backgroundColor: selected ? "#f0f0f0" : "#fff",
                    marginBottom: 12,
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  <Text style={{ fontSize: 18, fontWeight: "700" }}>
                    {team.team_name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Admin Setup always available */}
          <Pressable
            onPress={openAdminSetup}
            style={{
              marginTop: 12,
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
        </>
      )}

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
              Enter admin passcode to open Admin.
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
