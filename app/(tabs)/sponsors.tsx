import React, { useCallback, useMemo, useState } from "react";
import { Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { supabase } from "@/constants/supabaseClient";

type SponsorRow = {
  id: string;
  name: string;
  website: string | null;
  logo_url: string | null;
  is_active: boolean;
  sort_order: number | null;
};

function normalizeUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://${trimmed}`;
}

export default function SponsorsScreen() {
  const [sponsors, setSponsors] = useState<SponsorRow[]>([]);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);

  const loadSponsors = useCallback(async () => {
    const { data, error } = await supabase
      .from("sponsors")
      .select("id,name,website,logo_url,is_active,sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error || !data) {
      setSponsors([]);
      return;
    }

    setSponsors(data as SponsorRow[]);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadSponsors();
    }, [loadSponsors])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSponsors();
    setRefreshing(false);
  }, [loadSponsors]);

  const openWebsite = useCallback(async (urlMaybe: string | null) => {
    const url = urlMaybe ? normalizeUrl(urlMaybe) : "";
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      // no-op (stability > noise)
    }
  }, []);

  const rows = useMemo(() => sponsors, [sponsors]);

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <ThemedText type="title">Sponsors</ThemedText>
          <ThemedText style={styles.sub}>Tap a sponsor logo to visit their website.</ThemedText>
        </View>

        <View style={styles.list}>
          {rows.map((s) => {
            const logoUri = (s.logo_url ?? "").trim();
            const showFallback = failed[s.id] || !logoUri;

            return (
              <Pressable
                key={s.id}
                onPress={() => openWebsite(s.website)}
                style={styles.card}
              >
                <View style={styles.row}>
                  <View style={styles.logoBox}>
                    {showFallback ? (
                      <ThemedText style={styles.logoFallback}>Logo</ThemedText>
                    ) : (
                      <Image
                        source={{ uri: logoUri }}
                        style={styles.logo}
                        resizeMode="contain"
                        onError={() => setFailed((prev) => ({ ...prev, [s.id]: true }))}
                      />
                    )}
                  </View>

                  <View style={{ flex: 1, gap: 4 }}>
                    <ThemedText type="defaultSemiBold">{s.name}</ThemedText>
                    {!!s.website && <ThemedText style={styles.link}>{normalizeUrl(s.website)}</ThemedText>}
                  </View>

                  <ThemedText style={styles.tap}>Tap</ThemedText>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, gap: 12 },
  header: { gap: 6 },
  sub: { opacity: 0.8 },
  list: { gap: 12, marginTop: 4 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  logoBox: {
    width: 72,
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logo: { width: 64, height: 44 },
  logoFallback: { opacity: 0.6, fontSize: 12 },
  link: { opacity: 0.7, fontSize: 12 },
  tap: { opacity: 0.6, fontSize: 12 },
});
