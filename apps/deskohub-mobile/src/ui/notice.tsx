import { StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";
import { useLiveRegionAnnouncement } from "./live-announcement";

export type NoticeTone = "info" | "warning" | "error";

/**
 * A message about the screen's state, such as an account gate or a failed
 * save. It stays mounted as a live region and draws its box only while there
 * is a message, so assistive tech announces each change: `error` interrupts
 * (`alert`), `info` and `warning` wait their turn (`status`).
 */
export function Notice({
  tone,
  message,
}: {
  readonly tone: NoticeTone;
  readonly message: string | undefined;
}) {
  useLiveRegionAnnouncement(message);
  const shown = message !== undefined && message !== "";
  const alert = tone === "error";
  return (
    <View style={shown && [styles.box, toneStyles[tone].box]}>
      {shown && (
        <View
          aria-hidden
          style={[styles.glyph, { borderColor: toneStyles[tone].color }]}
        >
          <Text style={[styles.glyphText, { color: toneStyles[tone].color }]}>
            {tone === "info" ? "i" : "!"}
          </Text>
        </View>
      )}
      <Text
        role={alert ? "alert" : "status"}
        aria-live={alert ? "assertive" : "polite"}
        style={styles.message}
      >
        {message ?? ""}
      </Text>
    </View>
  );
}

const toneStyles = {
  info: {
    color: theme.colors.info,
    box: { borderColor: theme.colors.border },
  },
  warning: {
    color: theme.colors.warning,
    box: { borderColor: theme.colors.warning },
  },
  error: {
    color: theme.colors.danger,
    box: { borderColor: theme.colors.danger },
  },
} as const;

const styles = StyleSheet.create({
  box: {
    alignItems: "flex-start",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: theme.spacing.sm + theme.spacing.xs,
    padding: theme.spacing.md,
  },
  glyph: {
    alignItems: "center",
    borderRadius: 11,
    borderWidth: 1.5,
    height: 22,
    justifyContent: "center",
    marginTop: 1,
    width: 22,
  },
  glyphText: { fontSize: 13, fontWeight: "700", lineHeight: 16 },
  message: { color: theme.colors.text, flex: 1, ...theme.type.body },
});
