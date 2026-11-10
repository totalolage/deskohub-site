import { mapSupportedLocales } from "@deskohub/i18n/locale-registry";
import type { NativeStackNavigationOptions } from "expo-router";
import type { BottomTabNavigationOptions } from "expo-router/tabs";
import { StyleSheet, View } from "react-native";
import type { AppLocale } from "../i18n/app-locale";
import { theme } from "../theme";
import { localeTextStyle } from "./text-style";

// Navigators draw their own text, out of reach of the app's Text: their
// options carry the locale's font (see `localeTextStyle`), one object per
// locale so a navigator sees the same options until the locale changes.

const stackOptionsByLocale = mapSupportedLocales(
  (locale) =>
    ({
      contentStyle: { backgroundColor: theme.colors.background },
      headerShadowVisible: false,
      headerStyle: { backgroundColor: theme.colors.background },
      headerTintColor: theme.colors.text,
      // Native headers read only the family, size and weight; the web header
      // also applies the variation setting that draws the weight.
      headerTitleStyle: localeTextStyle(
        { ...theme.type.bodyStrong, color: theme.colors.text },
        locale
      ),
    }) satisfies NativeStackNavigationOptions
);

/** Headers of the app's stacks: theme text on the theme background, without a shadow. */
export const stackScreenOptions = (locale: AppLocale) =>
  stackOptionsByLocale[locale];

/**
 * The tabs carry text labels; the bar above the label marks the open tab
 * in place of an icon, which the app doesn't ship.
 */
function TabIndicator({ focused }: { readonly focused: boolean }) {
  return (
    <View
      aria-hidden
      style={[styles.indicator, focused && styles.indicatorFocused]}
    />
  );
}

const tabOptionsByLocale = mapSupportedLocales(
  (locale) =>
    ({
      headerShown: false,
      sceneStyle: { backgroundColor: theme.colors.background },
      tabBarActiveTintColor: theme.colors.accent,
      tabBarInactiveTintColor: theme.colors.textMuted,
      tabBarIcon: TabIndicator,
      // The bar holds 49pt: a 28pt icon slot leaves no room for a readable
      // label, so the slot shrinks to the indicator.
      tabBarIconStyle: { height: 3, marginBottom: theme.spacing.xs + 2 },
      tabBarLabelStyle: localeTextStyle(theme.type.captionStrong, locale),
      tabBarStyle: {
        backgroundColor: theme.colors.background,
        borderTopColor: theme.colors.border,
      },
    }) satisfies BottomTabNavigationOptions
);

/** The bottom tab bar; each tab's stack draws its own header. */
export const tabScreenOptions = (locale: AppLocale) =>
  tabOptionsByLocale[locale];

const styles = StyleSheet.create({
  indicator: {
    backgroundColor: "transparent",
    borderRadius: 2,
    height: 3,
    width: 24,
  },
  indicatorFocused: { backgroundColor: theme.colors.accent },
});
