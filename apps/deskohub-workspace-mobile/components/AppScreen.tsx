import { usePathname } from "expo-router";
import Head from "expo-router/head";
import type { ReactNode } from "react";
import {
  RefreshControl,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { palette, spacing, type } from "@/constants/Theme";
import {
  getScreenSafeAreaEdges,
  isTabNavigationHidden,
} from "@/src/platform/navigation-layout";
import { useShop } from "@/src/state/shop-provider";
import { Brand } from "./Brand";
import { StatusBanner } from "./Controls";

export function AppScreen({
  children,
  footer,
  refresh,
  refreshing = false,
  contentStyle,
  header = true,
  navigationHeader,
}: {
  children: ReactNode;
  footer?: ReactNode;
  refresh?: () => void;
  refreshing?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  header?: boolean;
  navigationHeader?: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const pathname = usePathname();
  const { isOnline, loadState, session, t } = useShop();
  const wide = width >= 840;
  const compact = width < 480;
  const navigationHidden = isTabNavigationHidden({
    loadState,
    pathname,
    sessionKind: session.kind,
  });

  return (
    <>
      <Head>
        <title>{t("appName")}</title>
      </Head>
      <SafeAreaView
        edges={getScreenSafeAreaEdges({ navigationHidden, wide })}
        style={styles.safeArea}
      >
        <View style={styles.page}>
          {header && (
            <View
              role="banner"
              style={[styles.header, compact && styles.headerCompact]}
            >
              <Brand />
            </View>
          )}
          {navigationHeader}
          {!isOnline && (
            <View style={styles.bannerWrap}>
              <StatusBanner title={t("offlineTitle")} tone="warning" />
            </View>
          )}
          <ScrollView
            key={pathname}
            role="main"
            contentContainerStyle={[
              styles.content,
              compact && styles.contentCompact,
              wide && styles.contentWide,
              contentStyle,
            ]}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              refresh ? (
                <RefreshControl refreshing={refreshing} onRefresh={refresh} />
              ) : undefined
            }
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
          {footer}
        </View>
      </SafeAreaView>
    </>
  );
}

export function ScreenIntro({ title }: { title: string }) {
  const { width } = useWindowDimensions();
  const compact = width < 480;

  return (
    <View style={[styles.intro, compact && styles.introCompact]}>
      <Text
        accessibilityRole="header"
        style={[styles.title, compact && styles.titleCompact]}
      >
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    alignItems: "center",
    backgroundColor: palette.surfaceMuted,
    flex: 1,
  },
  page: {
    backgroundColor: palette.canvas,
    flex: 1,
    maxWidth: 1120,
    width: "100%",
  },
  header: {
    alignItems: "center",
    backgroundColor: palette.surfaceMuted,
    borderBottomColor: palette.outline,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 56,
    paddingHorizontal: spacing.md,
  },
  headerCompact: { minHeight: 56 },
  bannerWrap: {
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  content: {
    flexGrow: 1,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  contentCompact: { paddingTop: spacing.md },
  contentWide: {
    alignSelf: "center",
    paddingHorizontal: spacing.xl,
    width: "100%",
  },
  intro: {
    gap: spacing.xs,
    marginBottom: spacing.md,
    maxWidth: 680,
  },
  introCompact: { gap: spacing.xxs, marginBottom: spacing.sm },
  title: {
    ...type.headline,
    color: palette.ink,
  },
  titleCompact: { ...type.headline },
});
