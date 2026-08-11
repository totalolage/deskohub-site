import { StyleSheet, Text, View } from "react-native";

import { palette, radii, spacing, type } from "@/constants/Theme";

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
      <View style={[styles.mark, inverse && styles.markInverse]}>
        <Text style={[styles.markText, inverse && styles.markTextInverse]}>
          DW
        </Text>
      </View>
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
    alignItems: "center",
    backgroundColor: palette.navy,
    borderRadius: radii.sm,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  markInverse: {
    backgroundColor: palette.aquamarine,
  },
  markText: {
    ...type.label,
    color: palette.white,
    letterSpacing: -0.2,
  },
  markTextInverse: {
    color: palette.navy,
  },
  name: {
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0.1,
    lineHeight: 19,
  },
  subname: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.9,
    lineHeight: 16,
    textTransform: "uppercase",
  },
});
