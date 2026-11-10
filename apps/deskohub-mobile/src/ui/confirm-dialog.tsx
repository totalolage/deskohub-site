import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "../theme";
import { Button, LiveMessage } from "./controls";
import { Text } from "./text";

/**
 * Asks the customer to confirm an action before it runs. While `busy`, both
 * actions are disabled and the dialog can't be dismissed (back button or
 * backdrop), so the action's outcome stays on screen; `busyMessage` is
 * announced meanwhile.
 */
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  destructive = false,
  busy = false,
  busyMessage,
  children,
}: {
  readonly visible: boolean;
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly destructive?: boolean;
  readonly busy?: boolean;
  readonly busyMessage?: string;
  /** Content between the body and the actions, such as a field or the last attempt's failure. */
  readonly children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const dismiss = () => {
    if (!busy) onCancel();
  };
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismiss}
    >
      <View
        style={[
          styles.backdrop,
          {
            paddingBottom: insets.bottom + theme.spacing.lg,
            paddingTop: insets.top + theme.spacing.lg,
          },
        ]}
      >
        <Pressable
          accessible={false}
          importantForAccessibility="no"
          onPress={dismiss}
          style={StyleSheet.absoluteFill}
        />
        <View
          role="alertdialog"
          aria-modal
          aria-label={title}
          aria-busy={busy}
          accessibilityViewIsModal
          style={styles.dialog}
        >
          {/* Long copy or large text scrolls; the actions stay in view. */}
          <ScrollView style={styles.scroll} contentContainerStyle={styles.copy}>
            <Text role="heading" style={styles.title}>
              {title}
            </Text>
            <Text style={styles.body}>{body}</Text>
            {children}
          </ScrollView>
          <LiveMessage role="status" message={busy ? busyMessage : undefined} />
          <View style={styles.actions}>
            <View style={styles.action}>
              <Button
                variant="secondary"
                label={cancelLabel}
                onPress={onCancel}
                disabled={busy}
              />
            </View>
            <View style={styles.action}>
              <Button
                variant={destructive ? "destructive" : "primary"}
                label={confirmLabel}
                onPress={onConfirm}
                disabled={busy}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: "center",
    backgroundColor: theme.colors.scrim,
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: theme.spacing.lg,
  },
  dialog: {
    backgroundColor: theme.colors.background,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    boxShadow: "0 12px 32px rgba(0, 0, 0, 0.45)",
    gap: theme.spacing.md,
    maxHeight: "100%",
    maxWidth: 420,
    padding: theme.spacing.lg,
    width: "100%",
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  copy: { gap: theme.spacing.md },
  title: { color: theme.colors.text, ...theme.type.heading },
  body: { color: theme.colors.textMuted, ...theme.type.body },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  action: { flexBasis: 140, flexGrow: 1 },
});
