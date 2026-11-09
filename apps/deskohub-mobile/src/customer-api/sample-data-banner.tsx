import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import {
  SafeAreaInsetsContext,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { theme } from "../theme";
import { Text } from "../ui/text";
import type { SampleAccountKind } from "./sample-data-mode";

/**
 * Shown above every signed-in screen while sample data is on (development
 * builds only). The banner takes the top of the window, under the status
 * bar, and the screens lay out below it, so it covers none of their content
 * or the tab bar; they see no top inset, as the banner already clears it.
 * Pressing it switches to the next account state; the state name is a
 * developer-facing identifier.
 */
export function SampleDataBanner({
  kind,
  onNextKind,
  children,
}: {
  readonly kind: SampleAccountKind;
  readonly onNextKind: () => void;
  readonly children: ReactNode;
}) {
  const locale = useAppLocale();
  const insets = useSafeAreaInsets();
  const text = `${m.account_sample_data_banner({}, { locale })} · ${kind}`;
  return (
    <View style={styles.frame}>
      <Pressable
        role="button"
        aria-label={text}
        onPress={onNextKind}
        style={[
          styles.banner,
          {
            minHeight: insets.top + theme.touchTarget,
            paddingTop: insets.top,
            paddingLeft: insets.left + theme.spacing.md,
            paddingRight: insets.right + theme.spacing.md,
          },
        ]}
      >
        <Text style={styles.text}>{text}</Text>
      </Pressable>
      <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
        <View style={styles.screens}>{children}</View>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  banner: {
    alignItems: "center",
    backgroundColor: theme.colors.accent,
    justifyContent: "center",
  },
  screens: { flex: 1 },
  text: {
    color: theme.colors.background,
    paddingVertical: theme.spacing.xs,
    ...theme.type.captionStrong,
  },
});
