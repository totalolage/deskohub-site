import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { theme } from "../../theme";
import { Text } from "../../ui/text";

/**
 * A labelled checkbox. `children` sits below the label for content such as
 * links, which stay their own tap targets.
 */
export function Checkbox({
  label,
  checked,
  onChange,
  disabled = false,
  children,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly children?: ReactNode;
}) {
  return (
    <View style={styles.container}>
      <Pressable
        role="checkbox"
        aria-checked={checked}
        aria-disabled={disabled}
        disabled={disabled}
        onPress={() => onChange(!checked)}
        style={({ pressed }) => [
          styles.row,
          pressed && !disabled && styles.pressed,
          disabled && styles.disabled,
        ]}
      >
        <View style={[styles.box, checked && styles.checkedBox]}>
          {checked ? <Text style={styles.tick}>✓</Text> : null}
        </View>
        <Text style={styles.label}>{label}</Text>
      </Pressable>
      {children === undefined ? null : (
        <View style={styles.extra}>{children}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: theme.spacing.xs },
  row: {
    minHeight: theme.touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    borderRadius: theme.radius.md,
  },
  pressed: { backgroundColor: theme.colors.surfacePressed },
  disabled: { opacity: 0.5 },
  box: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: theme.colors.textMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  checkedBox: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent,
  },
  tick: {
    ...theme.type.caption,
    fontWeight: "700",
    color: theme.colors.background,
  },
  label: { ...theme.type.body, flex: 1, color: theme.colors.text },
  extra: { paddingLeft: 24 + theme.spacing.md },
});
