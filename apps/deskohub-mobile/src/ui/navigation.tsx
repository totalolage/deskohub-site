import type { NativeStackNavigationOptions } from "expo-router";
import type { BottomTabNavigationOptions } from "expo-router/tabs";
import { StyleSheet, View } from "react-native";
import { theme } from "../theme";

/** Headers of the app's stacks: brand navy with white titles. */
export const stackScreenOptions = {
  contentStyle: { backgroundColor: theme.colors.background },
  headerShadowVisible: false,
  headerStyle: { backgroundColor: theme.colors.background },
  headerTintColor: theme.colors.text,
  // Native headers read only the family, size and weight; the web header
  // also applies the variation setting that draws the weight.
  headerTitleStyle: { ...theme.type.bodyStrong, color: theme.colors.text },
} satisfies NativeStackNavigationOptions;

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

/** The bottom tab bar; each tab's stack draws its own header. */
export const tabScreenOptions = {
  headerShown: false,
  sceneStyle: { backgroundColor: theme.colors.background },
  tabBarActiveTintColor: theme.colors.accent,
  tabBarInactiveTintColor: theme.colors.textMuted,
  tabBarIcon: TabIndicator,
  // The bar holds 49pt: a 28pt icon slot leaves no room for a readable
  // label, so the slot shrinks to the indicator.
  tabBarIconStyle: { height: 3, marginBottom: theme.spacing.xs + 2 },
  tabBarLabelStyle: theme.type.captionStrong,
  tabBarStyle: {
    backgroundColor: theme.colors.background,
    borderTopColor: theme.colors.border,
  },
} satisfies BottomTabNavigationOptions;

const styles = StyleSheet.create({
  indicator: {
    backgroundColor: "transparent",
    borderRadius: 2,
    height: 3,
    width: 24,
  },
  indicatorFocused: { backgroundColor: theme.colors.accent },
});
