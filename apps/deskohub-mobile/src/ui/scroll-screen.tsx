import type { ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { theme } from "../theme";

/**
 * A scrolling screen under a navigation header and above the tab bar, which
 * own the top and bottom insets. Passing `onRefresh` turns on
 * pull-to-refresh; `refreshing` shows the pull spinner while it runs.
 */
export function ScrollScreen({
  children,
  refreshing = false,
  onRefresh,
}: {
  readonly children: ReactNode;
  readonly refreshing?: boolean;
  readonly onRefresh?: () => void;
}) {
  return (
    <SafeAreaView edges={["left", "right"]} style={styles.screen}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        refreshControl={
          onRefresh && (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.accent}
              colors={[theme.colors.background]}
              progressBackgroundColor={theme.colors.accent}
            />
          )
        }
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: theme.colors.background, flex: 1 },
  content: {
    alignSelf: "center",
    gap: theme.spacing.md,
    maxWidth: 640,
    padding: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
    width: "100%",
  },
});
