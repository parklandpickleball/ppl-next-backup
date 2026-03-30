import React from "react";
import { SafeAreaView, View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";

export default function RegisterPage() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Register for Season</Text>
        <Text style={styles.body}>
          Intake form coming next.
        </Text>

        <Pressable onPress={() => router.push("/")} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Back to Home</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },

  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },

  title: {
    fontSize: 32,
    fontWeight: "900",
    color: "#0F172A",
    textAlign: "center",
  },

  body: {
    marginTop: 16,
    fontSize: 16,
    lineHeight: 24,
    color: "#475569",
    textAlign: "center",
  },

  backBtn: {
    marginTop: 28,
    backgroundColor: "#0F172A",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },

  backBtnText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
});