import * as Linking from "expo-linking";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppScreen, ScreenIntro } from "@/components/AppScreen";
import { ActionButton, StatusBanner } from "@/components/Controls";
import { palette, radii, spacing, type } from "@/constants/Theme";
import type { Locale } from "@/src/domain/shop";
import { useShop } from "@/src/state/shop-provider";

function SettingsSection({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text aria-level={2} role="heading" style={styles.sectionTitle}>
        {title}
      </Text>
      <Text style={styles.sectionBody}>{body}</Text>
      <View style={styles.sectionActions}>{children}</View>
    </View>
  );
}

export default function AccountScreen() {
  const {
    analyticsConsent,
    applyUpdate,
    checkForUpdate,
    isActionPending,
    isOnWifi,
    locale,
    session,
    setAnalyticsConsent,
    setLocale,
    signOut,
    t,
    updateState,
  } = useShop();

  const updateMessages = {
    current: t("updatesCurrent"),
    small_update_ready: t("updatesSmallReady"),
    apk_update_waiting_for_wifi: t("updatesWifi"),
    applying: t("updatesApplying"),
    error: t("updatesError"),
  } as const;
  const localeNames = { cs: t("czech"), en: t("english") } as const;
  const analyticsAllowed = analyticsConsent === "allowed";
  const updateReady = updateState.kind === "applying";

  const chooseLocale = (nextLocale: Locale) => setLocale(nextLocale);

  return (
    <AppScreen>
      <ScreenIntro title={t("accountTitle")} body={t("accountBody")} />
      {session.kind === "signed_in" && (
        <StatusBanner
          body={session.customer.displayName ?? t("appName")}
          title={
            session.customer.email
              ? t("signedInAs", { email: session.customer.email })
              : t("appName")
          }
          tone="success"
        />
      )}
      <SettingsSection title={t("languageTitle")} body={t("languageBody")}>
        <View role="radiogroup" style={styles.segmented}>
          {(["cs", "en"] as const).map((option) => (
            <Pressable
              aria-checked={locale === option}
              key={option}
              onPress={() => chooseLocale(option)}
              role="radio"
              style={({ pressed }) => [
                styles.segment,
                locale === option && styles.segmentSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  locale === option && styles.segmentTextSelected,
                ]}
              >
                {localeNames[option]}
              </Text>
            </Pressable>
          ))}
        </View>
      </SettingsSection>
      <SettingsSection title={t("analyticsTitle")} body={t("analyticsBody")}>
        <StatusBanner
          title={
            analyticsAllowed ? t("analyticsAllowed") : t("analyticsDenied")
          }
          tone={analyticsAllowed ? "success" : "info"}
        />
        <ActionButton
          label={analyticsAllowed ? t("disableAnalytics") : t("allowAnalytics")}
          onPress={() =>
            setAnalyticsConsent(analyticsAllowed ? "denied" : "allowed")
          }
          variant="secondary"
        />
      </SettingsSection>
      <SettingsSection
        title={t("updatesTitle")}
        body={updateMessages[updateState.kind]}
      >
        {updateState.kind === "apk_update_waiting_for_wifi" && isOnWifi && (
          <StatusBanner title={t("updatesApplying")} tone="success" />
        )}
        <ActionButton
          label={updateReady ? t("installUpdate") : t("checkUpdates")}
          onPress={() => void (updateReady ? applyUpdate() : checkForUpdate())}
          variant="secondary"
        />
      </SettingsSection>
      <SettingsSection title={t("supportTitle")} body={t("supportBody")}>
        <ActionButton
          label={t("emailSupport")}
          onPress={() => void Linking.openURL("mailto:workspace@deskohub.cz")}
          variant="secondary"
        />
      </SettingsSection>
      {session.kind === "signed_in" && (
        <ActionButton
          label={t("signOut")}
          loading={isActionPending}
          onPress={() => void signOut().then(() => router.replace("/"))}
          variant="danger"
        />
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: palette.surface,
    borderRadius: radii.md,
    gap: spacing.xs,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  sectionTitle: { ...type.title, color: palette.navy },
  sectionBody: { ...type.body, color: palette.navyMuted },
  sectionActions: { gap: spacing.sm, marginTop: spacing.sm },
  segmented: {
    backgroundColor: palette.surfaceMuted,
    borderRadius: radii.md,
    flexDirection: "row",
    padding: spacing.xxs,
  },
  segment: {
    alignItems: "center",
    borderRadius: radii.sm,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  segmentSelected: { backgroundColor: palette.navy },
  segmentText: { ...type.label, color: palette.navyMuted },
  segmentTextSelected: { color: palette.white },
  pressed: { opacity: 0.75 },
});
