import { Pressable, StyleSheet, View } from "react-native";
import { theme } from "../../theme";
import { Text } from "../../ui/text";

/**
 * The customer's explicit "I understand" before a destructive action: the
 * whole row toggles it and assistive tech reads it as a checkbox.
 */
export function ConfirmationCheckbox({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
}) {
  return (
    <Pressable
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled}
      aria-label={label}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => [
        styles.row,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <View
        importantForAccessibility="no-hide-descendants"
        style={[styles.box, checked && styles.checked]}
      >
        {checked && <Text style={styles.mark}>✓</Text>}
      </View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing.md,
    minHeight: theme.touchTarget,
    paddingVertical: theme.spacing.sm,
  },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  box: {
    alignItems: "center",
    borderColor: theme.colors.textMuted,
    borderRadius: theme.radius.sm,
    borderWidth: 2,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  checked: {
    backgroundColor: theme.colors.danger,
    borderColor: theme.colors.danger,
  },
  mark: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
  label: { color: theme.colors.text, flex: 1, ...theme.type.body },
});
