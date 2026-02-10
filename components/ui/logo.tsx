import React from "react";
import { Image, StyleSheet, View } from "react-native";

type LogoProps = {
  size?: number;
};

export default function Logo({ size = 120 }: LogoProps) {
  return (
    <View style={styles.wrap}>
      <Image
source={require("../../assets/images/icon.png")}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
  },
});
