import { Pressable, StyleSheet, View } from "react-native";
import type { AppLocale } from "../i18n/app-locale";
import { theme } from "../theme";
import { Text } from "./text";

export interface Choice<Value extends string> {
  readonly value: Value;
  readonly label: string;
  /** The language the label is in when it isn't the app's, such as a language's own name. */
  readonly labelLocale?: AppLocale;
  /** A second line, such as a price or why the choice is unavailable. */
  readonly description?: string;
  readonly disabled?: boolean;
}

/** A single-choice group: one row per choice, the selected one marked. */
export function ChoiceList<Value extends string>({
  label,
  choices,
  selected,
  onSelect,
  disabled = false,
}: {
  /** Names the group for assistive technology. */
  readonly label: string;
  readonly choices: ReadonlyArray<Choice<Value>>;
  readonly selected: Value | undefined;
  readonly onSelect: (value: Value) => void;
  readonly disabled?: boolean;
}) {
  return (
    <View role="radiogroup" aria-label={label} style={styles.group}>
      {choices.map((choice) => {
        const isSelected = choice.value === selected;
        const isDisabled = disabled || choice.disabled === true;
        return (
          <Pressable
            key={choice.value}
            role="radio"
            aria-checked={isSelected}
            aria-disabled={isDisabled}
            disabled={isDisabled}
            onPress={() => onSelect(choice.value)}
            style={({ pressed }) => [
              styles.row,
              isSelected && styles.selectedRow,
              pressed && !isDisabled && styles.pressed,
              isDisabled && styles.disabled,
            ]}
          >
            <View style={[styles.mark, isSelected && styles.selectedMark]} />
            <View style={styles.text}>
              <Text style={styles.label} locale={choice.labelLocale}>
                {choice.label}
              </Text>
              {choice.description === undefined ? null : (
                <Text style={styles.description}>{choice.description}</Text>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: theme.spacing.sm },
  row: {
    minHeight: theme.touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  selectedRow: { borderColor: theme.colors.accent },
  pressed: { backgroundColor: theme.colors.surfacePressed },
  disabled: { opacity: 0.5 },
  mark: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: theme.colors.textMuted,
  },
  selectedMark: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent,
  },
  text: { flex: 1, gap: theme.spacing.xs },
  label: { ...theme.type.body, color: theme.colors.text },
  description: { ...theme.type.caption, color: theme.colors.textMuted },
});
