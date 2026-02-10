import { Tabs } from "expo-router";
import React from "react";

import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { AdminSessionProvider } from "./adminSession";

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const scheme = colorScheme ?? "light";

  return (
    <AdminSessionProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarButton: HapticTab,

          tabBarStyle: {
            backgroundColor: Colors[scheme].background,
            borderTopColor: "#ddd",
          },

          tabBarActiveTintColor: Colors[scheme].tint,
          tabBarInactiveTintColor: Colors[scheme].text,

          tabBarShowLabel: true,
        }}
      >
        <Tabs.Screen name="adminSession" options={{ href: null }} />

        <Tabs.Screen
          name="schedule"
          options={{
            title: "Schedule",
            tabBarIcon: ({ color }) => (
              <IconSymbol size={28} name="calendar" color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="scoring"
          options={{
            title: "Scoring",
            tabBarIcon: ({ color }) => (
              <IconSymbol size={28} name="pencil" color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="results"
          options={{
            title: "Results",
            tabBarIcon: ({ color }) => (
              <IconSymbol size={28} name="trophy" color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="standings"
          options={{
            title: "Standings",
            tabBarIcon: ({ color }) => (
              <IconSymbol size={28} name="list.bullet" color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="announcements"
          options={{
            title: "Announcements",
            tabBarIcon: ({ color }) => (
              <IconSymbol size={28} name="megaphone" color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="photos"
          options={{
            title: "Photos",
            tabBarIcon: ({ color }) => (
              <IconSymbol size={28} name="photo" color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="winners"
          options={{
            title: "Past Results",
            tabBarIcon: ({ color }) => (
              <IconSymbol size={28} name="rosette" color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="sponsors"
          options={{
            title: "Sponsors",
            tabBarIcon: ({ color }) => (
              <IconSymbol size={28} name="star" color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="admin"
          options={{
            title: "Admin",
            tabBarIcon: ({ color }) => (
              <IconSymbol size={28} name="gearshape" color={color} />
            ),
          }}
        />
      </Tabs>
    </AdminSessionProvider>
  );
}
