import { Pressable, StyleSheet, View } from "react-native";
import { theme } from "../../theme";
import { Text } from "../../ui/text";
import { stepperModel } from "./stepper-model";

/**
 * A whole number picked within `min..max` with − and + buttons. Screen
 * readers adjust it as one control with their increment and decrement
 * gestures.
 */
export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  decrementLabel,
  incrementLabel,
  formatValue = String,
  disabled = false,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  /** Below `min` when nothing can be chosen, which disables both buttons. */
  readonly max: number;
  readonly onChange: (value: number) => void;
  readonly decrementLabel: string;
  readonly incrementLabel: string;
  /** The visible and announced value; `String(value)` by default. */
  readonly formatValue?: (value: number) => string;
  readonly disabled?: boolean;
}) {
  const stepper = stepperModel({ value, min, max });
  const canDecrement = !disabled && stepper.canDecrement;
  const canIncrement = !disabled && stepper.canIncrement;
  const step = (by: number) => onChange(stepper.clamp(value + by));
  const valueText = formatValue(value);

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value, text: valueText }}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: "decrement" }, { name: "increment" }]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === "decrement" && canDecrement) step(-1);
        if (nativeEvent.actionName === "increment" && canIncrement) step(1);
      }}
      style={[styles.stepper, disabled && styles.disabled]}
    >
      <Text style={styles.label}>{label}</Text>
      <StepButton
        label={decrementLabel}
        glyph="−"
        disabled={!canDecrement}
        onPress={() => step(-1)}
      />
      <Text style={styles.value}>{valueText}</Text>
      <StepButton
        label={incrementLabel}
        glyph="+"
        disabled={!canIncrement}
        onPress={() => step(1)}
      />
    </View>
  );
}

function StepButton({
  label,
  glyph,
  disabled,
  onPress,
}: {
  readonly label: string;
  readonly glyph: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      role="button"
      aria-label={label}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed && !disabled && styles.pressed,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text aria-hidden style={styles.glyph}>
        {glyph}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stepper: {
    minHeight: theme.touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  disabled: { opacity: 0.5 },
  label: { ...theme.type.body, flex: 1, color: theme.colors.text },
  button: {
    width: theme.touchTarget,
    height: theme.touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  pressed: { backgroundColor: theme.colors.surfacePressed },
  buttonDisabled: { opacity: 0.4 },
  glyph: { ...theme.type.heading, color: theme.colors.accent },
  value: {
    ...theme.type.body,
    minWidth: theme.touchTarget,
    textAlign: "center",
    fontWeight: "600",
    color: theme.colors.text,
    fontVariant: ["tabular-nums"],
  },
});
