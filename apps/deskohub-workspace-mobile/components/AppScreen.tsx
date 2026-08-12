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
  const { isOnline, t } = useShop();
  const pageWidth = Math.min(width, 1120);
  const wide = width >= 840;
  const compact = width < 480;

  return (
    <>
      <Head>
        <title>{t("appName")}</title>
      </Head>
      <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea}>
        <View style={[styles.page, { width: pageWidth }]}>
          {header && (
            <View
              role="banner"
              style={[styles.header, compact && styles.headerCompact]}
            >
              <Brand inverse />
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
    backgroundColor: palette.navy,
    flex: 1,
  },
  page: {
    backgroundColor: palette.paper,
    flex: 1,
    maxWidth: 1120,
  },
  header: {
    alignItems: "center",
    backgroundColor: palette.navy,
    flexDirection: "row",
    minHeight: 72,
    paddingHorizontal: spacing.md,
  },
  headerCompact: { minHeight: 64 },
  bannerWrap: {
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  content: {
    flexGrow: 1,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
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
    ...type.display,
    color: palette.navy,
  },
  titleCompact: { ...type.headline },
});
