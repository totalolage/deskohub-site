import { Image, StyleSheet, Text, View } from "react-native";

import { palette, spacing, type } from "@/constants/Theme";

const logo = require("../assets/images/brand-mark.png");

export function Brand() {
  return (
    <View
      accessible
      accessibilityLabel="Deskohub Workspace"
      accessibilityRole="image"
      style={styles.row}
    >
      <Image
        accessibilityIgnoresInvertColors
        resizeMode="contain"
        source={logo}
        style={styles.mark}
      />
      <View style={styles.copy}>
        <Text style={styles.name}>Deskohub</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  mark: {
    height: 22,
    width: 22,
  },
  copy: { justifyContent: "center" },
  name: {
    ...type.title,
    color: palette.action,
    fontWeight: "700",
  },
});
