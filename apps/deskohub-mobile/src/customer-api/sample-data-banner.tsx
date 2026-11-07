import { Pressable, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { theme } from "../theme";
import type { SampleAccountKind } from "./sample-data-mode";

// Above the tab bar, so it never shifts the screens' own layout.
const tabBarClearance = 64;

/**
 * Shown on every signed-in screen while sample data is on (development builds
 * only). Pressing it switches to the next account state; the state name is a
 * developer-facing identifier.
 */
export function SampleDataBanner({
  kind,
  onNextKind,
}: {
  readonly kind: SampleAccountKind;
  readonly onNextKind: () => void;
}) {
  const locale = useAppLocale();
  const { bottom } = useSafeAreaInsets();
  const text = `${m.account_sample_data_banner({}, { locale })} · ${kind}`;
  return (
    <Pressable
      role="button"
      aria-label={text}
      onPress={onNextKind}
      style={[styles.banner, { bottom: bottom + tabBarClearance }]}
    >
      <Text style={styles.text}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignSelf: "center",
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.md,
    minHeight: theme.touchTarget,
    justifyContent: "center",
    paddingHorizontal: theme.spacing.md,
    position: "absolute",
  },
  text: {
    color: theme.colors.background,
    ...theme.type.caption,
    fontWeight: "600",
  },
});
