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
}: {
  children: ReactNode;
  footer?: ReactNode;
  refresh?: () => void;
  refreshing?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  header?: boolean;
}) {
  const { width } = useWindowDimensions();
  const pathname = usePathname();
  const { isOnline, t } = useShop();
  const pageWidth = Math.min(width, 920);

  return (
    <>
      <Head>
        <title>{t("appName")}</title>
      </Head>
      <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea}>
        <View style={[styles.page, { width: pageWidth }]}>
          {header && (
            <View role="banner" style={styles.header}>
              <Brand />
            </View>
          )}
          {!isOnline && (
            <View style={styles.bannerWrap}>
              <StatusBanner
                title={t("offlineTitle")}
                body={t("offlineBody")}
                tone="warning"
              />
            </View>
          )}
          <ScrollView
            key={pathname}
            role="main"
            contentContainerStyle={[styles.content, contentStyle]}
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

export function ScreenIntro({
  kicker,
  title,
  body,
}: {
  kicker?: string;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.intro}>
      {kicker && <Text style={styles.kicker}>{kicker}</Text>}
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    alignItems: "center",
    backgroundColor: palette.paper,
    flex: 1,
  },
  page: {
    flex: 1,
    maxWidth: 920,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 68,
    paddingHorizontal: spacing.md,
  },
  bannerWrap: {
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  content: {
    flexGrow: 1,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
  },
  intro: {
    gap: spacing.xs,
    marginBottom: spacing.lg,
    maxWidth: 680,
  },
  kicker: {
    ...type.caption,
    color: palette.orangeInk,
    letterSpacing: 1.4,
  },
  title: {
    ...type.display,
    color: palette.navy,
  },
  body: {
    ...type.body,
    color: palette.navyMuted,
    maxWidth: 640,
  },
});
