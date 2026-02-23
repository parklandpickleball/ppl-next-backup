import React from "react";
import { SafeAreaView, Text, View, StyleSheet } from "react-native";

export default function MemberLogin() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Member Login</Text>
        <Text style={styles.subtitle}>
          This page will be your website-only login/portal entry.
          {"\n\n"}
          Next step: you tell me what you want this login to be (password? email? just links?).
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#FFFFFF" },
  container: { flex: 1, padding: 24, justifyContent: "center" },
  title: { fontSize: 28, fontWeight: "800", marginBottom: 12, color: "#111827" },
  subtitle: { fontSize: 16, color: "#374151", lineHeight: 22 },
});
