import { useId } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";

export type Choice<T extends string> = {
  readonly value: T;
  readonly label: string;
};

/**
 * A labelled set of options of which exactly one is chosen, such as a
 * billing type. It reads as a radio group, each option as a radio with its
 * checked state; the visible label names the group.
 */
export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  readonly label: string;
  readonly options: ReadonlyArray<Choice<T>>;
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
}) {
  const labelId = useId();
  return (
    <View role="radiogroup" aria-labelledby={labelId} style={styles.group}>
      <Text id={labelId} style={styles.label}>
        {label}
      </Text>
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <Pressable
            key={option.value}
            role="radio"
            aria-checked={checked}
            aria-disabled={disabled}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.option,
              checked && styles.checkedOption,
              pressed && !disabled && styles.pressedOption,
              disabled && styles.disabled,
            ]}
          >
            <View
              style={[styles.indicator, checked && styles.checkedIndicator]}
            >
              {checked && <View style={styles.indicatorDot} />}
            </View>
            <Text style={styles.optionLabel}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const indicatorSize = 22;
const indicatorDotSize = 10;

const styles = StyleSheet.create({
  group: { gap: theme.spacing.sm },
  label: { color: theme.colors.text, ...theme.type.body },
  option: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: theme.spacing.sm + theme.spacing.xs,
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  checkedOption: { borderColor: theme.colors.accent },
  pressedOption: { backgroundColor: theme.colors.surfacePressed },
  disabled: { opacity: 0.5 },
  indicator: {
    alignItems: "center",
    borderColor: theme.colors.textMuted,
    borderRadius: indicatorSize / 2,
    borderWidth: 2,
    height: indicatorSize,
    justifyContent: "center",
    width: indicatorSize,
  },
  checkedIndicator: { borderColor: theme.colors.accent },
  indicatorDot: {
    backgroundColor: theme.colors.accent,
    borderRadius: indicatorDotSize / 2,
    height: indicatorDotSize,
    width: indicatorDotSize,
  },
  optionLabel: { color: theme.colors.text, flex: 1, ...theme.type.body },
});
