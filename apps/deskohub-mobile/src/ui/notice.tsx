import { StyleSheet, View } from "react-native";
import { theme } from "../theme";
import { useLiveRegionAnnouncement } from "./live-announcement";
import {
  idleLiveRegionLayout,
  type NoticeTone,
  noticePresentation,
} from "./notice-presentation";
import { Text } from "./text";

export type { NoticeTone } from "./notice-presentation";

/**
 * A message about the screen's state, such as an account gate or a failed
 * save. It stays mounted as a live region, so assistive tech announces each
 * change, and draws its box only while there is a message; while idle it
 * sits out of the layout flow and takes no space.
 */
export function Notice({
  tone,
  message,
}: {
  readonly tone: NoticeTone;
  readonly message: string | undefined;
}) {
  const { shown, role, live, glyph } = noticePresentation(tone, message);
  useLiveRegionAnnouncement(message, live);
  return (
    <View
      style={shown ? [styles.box, toneStyles[tone].box] : idleLiveRegionLayout}
    >
      {shown && (
        <View
          aria-hidden
          style={[styles.glyph, { borderColor: toneStyles[tone].color }]}
        >
          <Text style={[styles.glyphText, { color: toneStyles[tone].color }]}>
            {glyph}
          </Text>
        </View>
      )}
      <Text
        role={role}
        aria-live={live}
        // Text doesn't map `aria-live` to Android's live region; View does.
        accessibilityLiveRegion={live}
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
