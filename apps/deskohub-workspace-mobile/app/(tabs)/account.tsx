import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { AppScreen, ScreenIntro } from "@/components/AppScreen";
import { ActionButton } from "@/components/Controls";
import { palette, radii, spacing, type } from "@/constants/Theme";
import type { Locale } from "@/src/domain/shop";
import { appVersion, getPublicPageUrl } from "@/src/platform/app-info";
import { useShop } from "@/src/state/shop-provider";

function AccountCard({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      {title && (
        <View style={styles.cardHeader}>
          <Text style={styles.cardHeaderText}>{title}</Text>
        </View>
      )}
      {children}
    </View>
  );
}

function AccountRow({
  title,
  body,
  accessory,
  last = false,
}: {
  title: string;
  body?: string;
  accessory?: React.ReactNode;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, !last && styles.rowDivider]}>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        {body && <Text style={styles.rowBody}>{body}</Text>}
      </View>
      {accessory}
    </View>
  );
}

function AnalyticsSwitch({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => onValueChange(!value)}
      style={({ pressed }) => [styles.switchControl, pressed && styles.pressed]}
    >
      <View style={[styles.switchTrack, value && styles.switchTrackEnabled]}>
        <View
          style={[
            styles.switchThumb,
            value ? styles.switchThumbEnabled : styles.switchThumbDisabled,
          ]}
        />
      </View>
    </Pressable>
  );
}

function AccountLink({
  label,
  name,
  onPress,
  divided = false,
}: {
  label: string;
  name: React.ComponentProps<typeof AppIcon>["name"];
  onPress: () => void;
  divided?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [
        styles.accountLink,
        divided && styles.accountLinkDivider,
        pressed && styles.pressed,
      ]}
    >
      <AppIcon color={palette.secondaryInk} name={name} size={20} />
      <Text style={styles.accountLinkText}>{label}</Text>
    </Pressable>
  );
}

function customerInitials(
  displayName: string | null,
  email: string | null
): string {
  if (displayName) {
    const initials = displayName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("");
    if (initials) return initials.toLocaleUpperCase();
  }
  return email?.trim().slice(0, 1).toLocaleUpperCase() || "DW";
}

export default function AccountScreen() {
  const { width } = useWindowDimensions();
  const {
    analyticsConsent,
    applyUpdate,
    checkForUpdate,
    isActionPending,
    locale,
    session,
    setAnalyticsConsent,
    setLocale,
    signOut,
    t,
    updateState,
  } = useShop();
  const [languageOpen, setLanguageOpen] = useState(false);
  const wide = width >= 760;
  const customer = session.kind === "signed_in" ? session.customer : null;
  const localeNames = { cs: t("czech"), en: t("english") } as const;
  const updateMessages = {
    current: t("updatesCurrent"),
    small_update_ready: t("updatesSmallReady"),
    apk_update_waiting_for_wifi: t("updatesWifi"),
    applying: t("updatesApplying"),
    error: t("updatesError"),
  } as const;
  const updateReady = updateState.kind === "applying";

  const chooseLocale = (nextLocale: Locale) => {
    setLocale(nextLocale);
    setLanguageOpen(false);
  };

  return (
    <AppScreen contentStyle={styles.screenContent}>
      <ScreenIntro title={t("accountTitle")} />
      {customer && (
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {customerInitials(customer.displayName, customer.email)}
            </Text>
          </View>
          <View style={styles.profileCopy}>
            {customer.displayName && (
              <Text numberOfLines={1} style={styles.profileName}>
                {customer.displayName}
              </Text>
            )}
            {customer.email && (
              <Text numberOfLines={1} style={styles.profileEmail}>
                {customer.email}
              </Text>
            )}
          </View>
        </View>
      )}
      <View style={[styles.columns, wide && styles.columnsWide]}>
        <View style={styles.column}>
          <AccountCard>
            <AccountRow
              accessory={
                <Pressable
                  accessibilityLabel={`${t("languageTitle")}: ${localeNames[locale]}`}
                  accessibilityState={{ expanded: languageOpen }}
                  onPress={() => setLanguageOpen((open) => !open)}
                  role="button"
                  style={({ pressed }) => [
                    styles.languageButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.languageButtonText}>
                    {localeNames[locale]} ({locale.toLocaleUpperCase()})
                  </Text>
                  <AppIcon
                    color={palette.secondaryInk}
                    name={{
                      ios: languageOpen ? "chevron.up" : "chevron.down",
                      android: languageOpen
                        ? "keyboard_arrow_up"
                        : "keyboard_arrow_down",
                      web: languageOpen
                        ? "keyboard_arrow_up"
                        : "keyboard_arrow_down",
                    }}
                    size={18}
                  />
                </Pressable>
              }
              title={t("languageTitle")}
            />
            {languageOpen && (
              <View role="radiogroup" style={styles.languageOptions}>
                {(["cs", "en"] as const).map((option) => (
                  <Pressable
                    accessibilityState={{ checked: locale === option }}
                    key={option}
                    onPress={() => chooseLocale(option)}
                    role="radio"
                    style={({ pressed }) => [
                      styles.languageOption,
                      locale === option && styles.languageOptionSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.languageOptionText,
                        locale === option && styles.languageOptionTextSelected,
                      ]}
                    >
                      {localeNames[option]} ({option.toLocaleUpperCase()})
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            <AccountRow
              accessory={
                <AnalyticsSwitch
                  label={t("analyticsTitle")}
                  onValueChange={(enabled) =>
                    setAnalyticsConsent(enabled ? "allowed" : "denied")
                  }
                  value={analyticsConsent === "allowed"}
                />
              }
              body={t("analyticsBody")}
              last
              title={t("analyticsTitle")}
            />
          </AccountCard>
          <AccountCard title={t("updatesTitle")}>
            <View style={styles.updateContent}>
              <Text style={styles.updateStatus}>
                {updateMessages[updateState.kind]}
              </Text>
              <ActionButton
                label={updateReady ? t("installUpdate") : t("checkUpdates")}
                loading={isActionPending}
                onPress={() =>
                  void (updateReady ? applyUpdate() : checkForUpdate())
                }
                variant="secondary"
              />
            </View>
          </AccountCard>
        </View>
        <View style={styles.column}>
          <AccountCard title={t("appName")}>
            <View style={styles.workspaceContent}>
              <Pressable
                accessibilityRole="link"
                onPress={() =>
                  void Linking.openURL(getPublicPageUrl(locale, "account"))
                }
                style={({ pressed }) => [
                  styles.workspaceAction,
                  pressed && styles.pressed,
                ]}
              >
                <AppIcon
                  color={palette.white}
                  name={{ ios: "building.2", android: "domain", web: "domain" }}
                  size={16}
                />
                <Text style={styles.workspaceActionText}>
                  {t("manageAccount")}
                </Text>
              </Pressable>
            </View>
          </AccountCard>
          <AccountCard title={t("supportTitle")}>
            <AccountLink
              label={t("emailSupport")}
              name={{
                ios: "envelope",
                android: "mail_outline",
                web: "mail_outline",
              }}
              onPress={() =>
                void Linking.openURL("mailto:workspace@deskohub.cz")
              }
            />
            <AccountLink
              divided
              label={t("privacyPolicy")}
              name={{
                ios: "hand.raised",
                android: "privacy_tip",
                web: "privacy_tip",
              }}
              onPress={() =>
                void Linking.openURL(getPublicPageUrl(locale, "privacy-policy"))
              }
            />
            <AccountLink
              divided
              label={t("termsOfService")}
              name={{
                ios: "doc.text",
                android: "description",
                web: "description",
              }}
              onPress={() =>
                void Linking.openURL(
                  getPublicPageUrl(locale, "terms-and-conditions")
                )
              }
            />
          </AccountCard>
          <Text style={styles.version}>
            {t("appVersion", { version: appVersion })}
          </Text>
          {session.kind === "signed_in" && (
            <Pressable
              accessibilityRole="button"
              disabled={isActionPending}
              onPress={() => void signOut().then(() => router.replace("/"))}
              style={({ pressed }) => [
                styles.signOutButton,
                pressed && styles.pressed,
                isActionPending && styles.disabled,
              ]}
            >
              <AppIcon
                color={palette.danger}
                name={{
                  ios: "rectangle.portrait.and.arrow.right",
                  android: "logout",
                  web: "logout",
                }}
                size={18}
              />
              <Text style={styles.signOutText}>{t("signOut")}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    alignSelf: "center",
    maxWidth: 896,
    width: "100%",
  },
  profileCard: {
    alignItems: "center",
    backgroundColor: palette.surface,
    borderColor: palette.outline,
    borderRadius: radii.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.lg,
    padding: spacing.lg,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: palette.surfaceMuted,
    borderColor: palette.outline,
    borderRadius: radii.full,
    borderWidth: 1,
    height: 64,
    justifyContent: "center",
    width: 64,
  },
  avatarText: { ...type.title, color: palette.secondaryInk },
  profileCopy: { flex: 1, minWidth: 0 },
  profileName: { ...type.title, color: palette.ink },
  profileEmail: { ...type.caption, color: palette.secondaryInk },
  columns: { gap: spacing.lg },
  columnsWide: { flexDirection: "row" },
  column: { flex: 1, gap: spacing.lg, minWidth: 0 },
  card: {
    backgroundColor: palette.surface,
    borderColor: palette.outline,
    borderRadius: radii.sm,
    borderWidth: 1,
    overflow: "hidden",
  },
  cardHeader: {
    backgroundColor: palette.surfaceMuted,
    borderBottomColor: palette.outline,
    borderBottomWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  cardHeaderText: {
    ...type.caption,
    color: palette.secondaryInk,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    minHeight: 88,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowDivider: {
    borderBottomColor: palette.outline,
    borderBottomWidth: 1,
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { ...type.body, color: palette.ink },
  rowBody: { ...type.caption, color: palette.secondaryInk },
  languageButton: {
    alignItems: "center",
    backgroundColor: palette.canvas,
    borderColor: palette.outline,
    borderRadius: 4,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xxs,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  languageButtonText: { ...type.caption, color: palette.ink },
  languageOptions: {
    borderBottomColor: palette.outline,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  languageOption: {
    alignItems: "center",
    borderColor: palette.outline,
    borderRadius: 4,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  languageOptionSelected: {
    backgroundColor: palette.action,
    borderColor: palette.action,
  },
  languageOptionText: { ...type.caption, color: palette.ink },
  languageOptionTextSelected: { color: palette.white },
  switchControl: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  switchTrack: {
    backgroundColor: palette.outline,
    borderRadius: radii.full,
    height: 24,
    justifyContent: "center",
    paddingHorizontal: 2,
    width: 44,
  },
  switchTrackEnabled: { backgroundColor: palette.action },
  switchThumb: {
    backgroundColor: palette.white,
    borderRadius: radii.full,
    height: 20,
    width: 20,
  },
  switchThumbDisabled: { alignSelf: "flex-start" },
  switchThumbEnabled: { alignSelf: "flex-end" },
  updateContent: { gap: spacing.md, padding: spacing.lg },
  updateStatus: { ...type.body, color: palette.secondaryInk },
  workspaceContent: { padding: spacing.lg },
  workspaceAction: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: palette.action,
    borderRadius: radii.sm,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  workspaceActionText: { ...type.label, color: palette.white },
  accountLink: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  accountLinkDivider: {
    borderTopColor: palette.outline,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  accountLinkText: { ...type.caption, color: palette.ink, flex: 1 },
  version: {
    ...type.label,
    color: palette.neutralInk,
    textAlign: "center",
  },
  signOutButton: {
    alignItems: "center",
    borderColor: palette.danger,
    borderRadius: radii.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  signOutText: { ...type.caption, color: palette.danger, fontWeight: "700" },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.42 },
});
