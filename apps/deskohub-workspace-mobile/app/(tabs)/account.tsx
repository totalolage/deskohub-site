import * as Linking from "expo-linking";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { AppScreen, ScreenIntro } from "@/components/AppScreen";
import { ActionButton, StatusBanner } from "@/components/Controls";
import { palette, radii, spacing, type } from "@/constants/Theme";
import type { Locale } from "@/src/domain/shop";
import { useShop } from "@/src/state/shop-provider";

function SettingsSection({
  title,
  body,
  accessory,
  children,
}: {
  title: string;
  body?: string;
  accessory?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <Text aria-level={2} role="heading" style={styles.sectionTitle}>
          {title}
        </Text>
        {accessory}
      </View>
      {body && <Text style={styles.sectionBody}>{body}</Text>}
      {children && <View style={styles.sectionActions}>{children}</View>}
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
      <ScreenIntro title={t("accountTitle")} />
      <SettingsSection title={t("languageTitle")}>
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
      <SettingsSection
        accessory={
          <Switch
            accessibilityHint={t("analyticsBody")}
            accessibilityLabel={t("analyticsTitle")}
            onValueChange={(enabled) =>
              setAnalyticsConsent(enabled ? "allowed" : "denied")
            }
            style={styles.analyticsSwitch}
            thumbColor={palette.white}
            trackColor={{ false: palette.silver, true: palette.success }}
            value={analyticsAllowed}
          />
        }
        body={t("analyticsBody")}
        title={t("analyticsTitle")}
      />
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
      <SettingsSection title={t("supportTitle")}>
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
    borderColor: palette.outline,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  sectionTitle: { ...type.title, color: palette.navy },
  sectionHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
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
  analyticsSwitch: {
    height: 30,
    width: 52,
  },
});
