import {
  type ComponentRef,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
} from "react";
import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { theme } from "../theme";

/**
 * Scrolls the enclosing `ScrollScreen` back to its top; outside one, it does
 * nothing.
 */
export const ScrollScreenContext = createContext<() => void>(() => undefined);

/**
 * Brings the top of the enclosing `ScrollScreen` into view at once, for
 * content that just appeared there, such as a notice about why the screen
 * changed.
 */
export const useScrollScreenToTop = () => useContext(ScrollScreenContext);

/**
 * A scrolling screen under a navigation header and above the tab bar, which
 * own the top and bottom insets. Passing `onRefresh` turns on
 * pull-to-refresh; `refreshing` shows the pull spinner while it runs. Its
 * content can scroll it back to the top with `useScrollScreenToTop`.
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
  const scrollView = useRef<ComponentRef<typeof ScrollView>>(null);
  // Instantly: a screen coming back into view shows its top right away.
  const scrollToTop = useCallback(
    () => scrollView.current?.scrollTo({ y: 0, animated: false }),
    []
  );
  return (
    <SafeAreaView edges={["left", "right"]} style={styles.screen}>
      <ScrollView
        ref={scrollView}
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
        <ScrollScreenContext value={scrollToTop}>
          {children}
        </ScrollScreenContext>
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
