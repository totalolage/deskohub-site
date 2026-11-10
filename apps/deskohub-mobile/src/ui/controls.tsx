import { type ReactNode, type Ref, useId } from "react";
import {
  Pressable,
  StyleSheet,
  type TextInputInstance,
  type TextInputProps,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { theme } from "../theme";
import { fieldErrorPresentation } from "./field-error-presentation";
import { useLiveRegionAnnouncement } from "./live-announcement";
import { Text, TextInput } from "./text";
import { textFieldSubmit } from "./text-field-submit";

/**
 * A centred screen with a heading. Its content keeps to a readable width;
 * `align="center"` also centres each item, as on the home screen.
 */
export function Screen({
  title,
  align = "start",
  children,
}: {
  readonly title: string;
  readonly align?: "start" | "center";
  readonly children: ReactNode;
}) {
  return (
    <SafeAreaView style={styles.screen}>
      <View
        style={[styles.content, align === "center" && styles.centeredContent]}
      >
        <Text role="heading" style={styles.title}>
          {title}
        </Text>
        {children}
      </View>
    </SafeAreaView>
  );
}

export function BodyText({ children }: { readonly children: ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  disabled = false,
  variant = "primary",
  accessibilityLabel,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly variant?: "primary" | "secondary" | "destructive";
  /** The accessible name when the visible label alone is ambiguous, such as "Delete" in a list. */
  readonly accessibilityLabel?: string;
}) {
  return (
    <Pressable
      role="button"
      aria-label={accessibilityLabel}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          primary: styles.primary,
          secondary: styles.secondary,
          destructive: styles.destructive,
        }[variant],
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text
        style={[
          styles.buttonLabel,
          {
            primary: styles.filledLabel,
            secondary: styles.secondaryLabel,
            destructive: styles.filledLabel,
          }[variant],
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * A labelled text input. With an `error` the input turns invalid and shows
 * the error beneath it, in a live region that stays mounted so assistive
 * tech announces each new error, and in the input's description, so it is
 * read again when the input gains focus.
 */
export function TextField({
  label,
  error,
  autoCapitalize = "none",
  onSubmitEditing,
  ...input
}: {
  readonly label: string;
  readonly error?: string;
  /** Lets a form focus the field, such as its first invalid one. */
  readonly ref?: Ref<TextInputInstance>;
} & Pick<
  TextInputProps,
  | "value"
  | "onChangeText"
  | "onSubmitEditing"
  | "onBlur"
  | "autoCapitalize"
  | "autoComplete"
  | "keyboardType"
  | "inputMode"
  | "textContentType"
  | "returnKeyType"
  | "maxLength"
  | "autoFocus"
  | "editable"
>) {
  const errorId = useId();
  const { invalid, description, role, live, idleLayout } =
    fieldErrorPresentation(error);
  useLiveRegionAnnouncement(description, live);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        aria-label={label}
        // Native platforms read the hint; the web reads `aria-describedby`
        // and `aria-invalid`, which react-native-web maps and RN ignores.
        accessibilityHint={description}
        aria-describedby={invalid ? errorId : undefined}
        aria-invalid={invalid}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        style={[styles.input, invalid && styles.invalidInput]}
        placeholderTextColor={theme.colors.textMuted}
        {...input}
        onSubmitEditing={textFieldSubmit(input.editable, onSubmitEditing)}
      />
      <Text
        id={errorId}
        role={role}
        aria-live={live}
        // Text doesn't map `aria-live` to Android's live region; View does.
        accessibilityLiveRegion={live}
        style={idleLayout ?? styles.fieldError}
      >
        {description ?? ""}
      </Text>
    </View>
  );
}

/**
 * Live regions stay mounted so assistive tech announces each change; only
 * their text changes. `status` is polite progress, `alert` an error. iOS,
 * which ignores `aria-live`, has each change announced directly.
 */
export function LiveMessage({
  role,
  message,
}: {
  readonly role: "status" | "alert";
  readonly message: string | undefined;
}) {
  useLiveRegionAnnouncement(message, role === "alert" ? "assertive" : "polite");
  return (
    <Text
      role={role}
      aria-live={role === "alert" ? "assertive" : "polite"}
      // Text doesn't map `aria-live` to Android's live region; View does.
      accessibilityLiveRegion={role === "alert" ? "assertive" : "polite"}
      style={role === "alert" ? styles.alert : styles.status}
    >
      {message ?? ""}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  content: {
    alignSelf: "center",
    flex: 1,
    gap: theme.spacing.md,
    justifyContent: "center",
    maxWidth: 480,
    padding: theme.spacing.lg,
    width: "100%",
  },
  centeredContent: { alignItems: "center" },
  title: { color: theme.colors.text, ...theme.type.title },
  body: { color: theme.colors.textMuted, ...theme.type.body },
  button: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: theme.touchTarget,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 4,
  },
  primary: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  secondary: { borderColor: theme.colors.textMuted },
  destructive: {
    backgroundColor: theme.colors.danger,
    borderColor: theme.colors.danger,
  },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  buttonLabel: theme.type.bodyStrong,
  filledLabel: { color: theme.colors.background },
  secondaryLabel: { color: theme.colors.text },
  field: { gap: theme.spacing.sm },
  fieldLabel: { color: theme.colors.text, ...theme.type.body },
  input: {
    borderColor: theme.colors.textMuted,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    color: theme.colors.text,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 4,
    ...theme.type.body,
  },
  invalidInput: { borderColor: theme.colors.danger },
  fieldError: { color: theme.colors.danger, ...theme.type.caption },
  status: { color: theme.colors.textMuted, ...theme.type.body },
  alert: { color: theme.colors.accent, ...theme.type.body },
});
