import { Image, StyleSheet, Text, View } from "react-native";

import { palette, spacing } from "@/constants/Theme";

const logo = require("../assets/images/icon.png");

export function Brand({
  inverse = false,
  compact = false,
}: {
  inverse?: boolean;
  compact?: boolean;
}) {
  const foreground = inverse ? palette.white : palette.navy;
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
      {!compact && (
        <View>
          <Text style={[styles.name, { color: foreground }]}>Deskohub</Text>
          <Text style={[styles.subname, { color: foreground }]}>Workspace</Text>
        </View>
      )}
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
    height: 44,
    width: 44,
  },
  name: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.2,
    lineHeight: 20,
  },
  subname: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.35,
    lineHeight: 14,
    textTransform: "uppercase",
  },
});
