import type { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { theme } from "../theme";
import { textFieldSubmit } from "./text-field-submit";

/** A centred screen with a heading, used by the sign-in screens. */
export function Screen({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
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
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly variant?: "primary" | "secondary";
}) {
  return (
    <Pressable
      role="button"
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        variant === "primary" ? styles.primary : styles.secondary,
        disabled && styles.disabled,
      ]}
    >
      <Text
        style={[
          styles.buttonLabel,
          variant === "primary" ? styles.primaryLabel : styles.secondaryLabel,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function TextField({
  label,
  onSubmitEditing,
  ...input
}: { readonly label: string } & Pick<
  TextInputProps,
  | "value"
  | "onChangeText"
  | "onSubmitEditing"
  | "autoComplete"
  | "keyboardType"
  | "inputMode"
  | "textContentType"
  | "autoFocus"
  | "editable"
>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        aria-label={label}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        placeholderTextColor={theme.colors.textMuted}
        {...input}
        onSubmitEditing={textFieldSubmit(input.editable, onSubmitEditing)}
      />
    </View>
  );
}

/**
 * Live regions stay mounted so assistive tech announces each change; only
 * their text changes. `status` is polite progress, `alert` an error.
 */
export function LiveMessage({
  role,
  message,
}: {
  readonly role: "status" | "alert";
  readonly message: string | undefined;
}) {
  return (
    <Text
      role={role}
      aria-live={role === "alert" ? "assertive" : "polite"}
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
  title: { color: theme.colors.text, ...theme.type.title },
  body: { color: theme.colors.textMuted, ...theme.type.body },
  button: {
    alignItems: "center",
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
  disabled: { opacity: 0.5 },
  buttonLabel: { ...theme.type.body, fontWeight: "600" },
  primaryLabel: { color: theme.colors.background },
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
  status: { color: theme.colors.textMuted, ...theme.type.body },
  alert: { color: theme.colors.accent, ...theme.type.body },
});
