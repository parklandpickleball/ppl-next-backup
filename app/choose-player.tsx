import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "@/constants/supabaseClient";

type PlayerOption = {
  name: string;
};

export default function ChoosePlayerScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [players, setPlayers] = useState<PlayerOption[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);

  useEffect(() => {
    const loadPlayers = async () => {
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

        const { data: profile } = await supabase
          .from("user_season_profiles")
          .select("team_id")
          .eq("user_id", userId)
          .eq("season_id", seasonId)
          .single();

        const teamId = profile?.team_id;
        if (!teamId) {
          router.replace("choose-team" as any);
          return;
        }

        const { data: team } = await supabase
          .from("teams")
          .select("player1_name, player2_name")
          .eq("id", teamId)
          .single();

        const opts: PlayerOption[] = [];
        if (team?.player1_name) opts.push({ name: team.player1_name });
        if (team?.player2_name) opts.push({ name: team.player2_name });

        if (opts.length === 0) {
          Alert.alert(
            "Players not ready",
            "Players have not been added to this team yet."
          );
          return;
        }

        setPlayers(opts);
      } finally {
        setLoading(false);
      }
    };

    void loadPlayers();
  }, [router]);

  const onContinue = async () => {
    if (!selectedPlayer) {
      Alert.alert("Select a player", "Please choose your name to continue.");
      return;
    }

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
        .update({
          player_name: selectedPlayer,
        })
        .eq("user_id", userId)
        .eq("season_id", seasonId);

      if (error) {
        Alert.alert("Error", error.message);
        return;
      }

      router.replace("(tabs)/schedule" as any);
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
      {/* NEW BUTTON: Return to Choose Team */}
      <Pressable
        onPress={() => router.replace("choose-team" as any)}
        style={{
          marginBottom: 20,
          backgroundColor: "#ddd",
          paddingVertical: 10,
          borderRadius: 10,
          alignItems: "center",
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: "700" }}>
          Return to Choose Team
        </Text>
      </Pressable>

      <Text style={{ fontSize: 26, fontWeight: "900", marginBottom: 10 }}>
        Choose Your Name
      </Text>

      <Text style={{ marginBottom: 16, color: "#555" }}>
        Select your name for this season.
      </Text>

      {players.map((p, index) => {
        const selected = selectedPlayer === p.name;
        return (
          <Pressable
            key={`${p.name}-${index}`}
            onPress={() => setSelectedPlayer(p.name)}
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
              {p.name}
            </Text>
          </Pressable>
        );
      })}

      <Pressable
        onPress={onContinue}
        disabled={saving}
        style={{
          marginTop: 16,
          backgroundColor: "black",
          paddingVertical: 14,
          borderRadius: 12,
          alignItems: "center",
          opacity: saving ? 0.6 : 1,
        }}
      >
        <Text style={{ color: "white", fontSize: 16, fontWeight: "900" }}>
          Continue
        </Text>
      </Pressable>
    </View>
  );
}
