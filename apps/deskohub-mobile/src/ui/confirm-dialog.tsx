import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";
import { Button, LiveMessage } from "./controls";

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
}) {
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
      <View style={styles.backdrop}>
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
          <Text role="heading" style={styles.title}>
            {title}
          </Text>
          <Text style={styles.body}>{body}</Text>
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
    padding: theme.spacing.lg,
  },
  dialog: {
    backgroundColor: theme.colors.background,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    boxShadow: "0 12px 32px rgba(0, 0, 0, 0.45)",
    gap: theme.spacing.md,
    maxWidth: 420,
    padding: theme.spacing.lg,
    width: "100%",
  },
  title: { color: theme.colors.text, ...theme.type.heading },
  body: { color: theme.colors.textMuted, ...theme.type.body },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  action: { flexBasis: 140, flexGrow: 1 },
});
