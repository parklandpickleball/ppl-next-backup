import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Alert,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "@/constants/supabaseClient";

type TeamRow = {
  id: string;
  team_name: string;
};

export default function ChooseTeamScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

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
          Alert.alert(
            "Teams not ready",
            "Teams have not been created yet. Please check back later."
          );
          return;
        }

        setTeams(teamRows);
      } finally {
        setLoading(false);
      }
    };

    void loadTeams();
  }, []);

  // This replaces your old onContinue
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
        .update({ team_id: teamId })
        .eq("user_id", userId)
        .eq("season_id", seasonId);

      if (error) {
        Alert.alert("Error", error.message);
        return;
      }

      // Navigate immediately to Choose Player
      router.replace("choose-player" as any);
    } finally {
      setSaving(false);
    }
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

      <ScrollView>
        {teams.map((team) => {
          const selected = team.id === selectedTeamId;
          return (
            <Pressable
              key={team.id}
              onPress={() => handleTeamSelect(team.id)}
              style={{
                padding: 16,
                borderRadius: 12,
                borderWidth: 2,
                borderColor: selected ? "#000" : "#ddd",
                backgroundColor: selected ? "#f0f0f0" : "#fff",
                marginBottom: 12,
              }}
            >
              <Text style={{ fontSize: 18, fontWeight: "700" }}>
                {team.team_name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
