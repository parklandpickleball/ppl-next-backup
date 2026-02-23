import { Platform } from "react-native";
import { Redirect } from "expo-router";

export default function Index() {
  // Web = Homepage
  if (Platform.OS === "web") {
    return <Redirect href="/home" />;
  }

  // Native App = League Lock
  return <Redirect href="/league-lock" />;
}
