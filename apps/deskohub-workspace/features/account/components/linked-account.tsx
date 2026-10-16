"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import type { CustomerProfile } from "@/features/account/backend/customer-dotypos-adapter.service";
import { useAccountLayout } from "@/features/account/components/account-layout-shell";
import { getAccountScreenCopy } from "@/features/account/components/account-screen-copy";
import { DeleteAccountCard } from "@/features/account/components/delete-account-card";
import { LegalScreen } from "@/features/account/components/legal/legal-screen";
import { PasskeyPrompt } from "@/features/account/components/passkeys/passkey-prompt";
import { SignInSecurityScreen } from "@/features/account/components/passkeys/sign-in-security-screen";
import { useAccountPasskeys } from "@/features/account/components/passkeys/use-account-passkeys";
import { ProfileCompletionReferralNotice } from "@/features/account/components/profile-completion-referral-notice";
import { ProfileForm } from "@/features/account/components/profile-form";
import { ReferralScreen } from "@/features/account/components/referral-screen";
import type {
  CustomerAvatarPresentation,
  ProfileCompletionReferralOutcome,
} from "@/features/account/contracts";
import type { AccountPasskeySettings } from "@/features/account/passkeys";
import { getAccountPath } from "@/features/account/routes";
import { type Locale, m } from "@/features/i18n";
import {
  formatReferralDiscount,
  formatReferralDiscountReduction,
} from "@/features/referrals/client";
import type { ReferralAccountOverview } from "@/features/referrals/contracts";

type LinkedAccountProps = {
  readonly email: string;
  readonly locale: Locale;
  readonly profile: CustomerProfile;
  readonly avatarPresentation: CustomerAvatarPresentation;
  /** Whether the referral program is released; withheld, nothing shows. */
  readonly referralsEnabled: boolean;
  readonly referrals?: ReferralAccountOverview;
  /** The current reservations, counted in the navigation; unknown while unavailable. */
  readonly reservationCount: number | undefined;
  /**
   * The reservation history, rendered on the server. Its dates come from
   * `Intl`, whose spacing differs between Node and browsers, so formatting
   * them again in the client tree would not match the server HTML.
   */
  readonly reservations: ReactNode;
  readonly signupReferral?: ProfileCompletionReferralOutcome;
  /** The account's passkeys; absent while `login_passkeys` is off. */
  readonly passkeys?: AccountPasskeySettings;
};

export function LinkedAccount({
  avatarPresentation,
  email,
  locale,
  passkeys,
  profile,
  referrals,
  referralsEnabled,
  reservationCount,
  reservations,
  signupReferral,
}: LinkedAccountProps) {
  const pathname = usePathname();
  const {
    activeSection,
    changeSection,
    setReferralBadge,
    setReservationCount,
  } = useAccountLayout();
  const normalizedPathname =
    pathname === null ? null : pathname.replace(/\/+$/, "") || "/";
  const isPrivateAccountPathname =
    normalizedPathname === getAccountPath(locale);
  const profileSection = activeSection === "billing" ? "billing" : "profile";
  const copy = getAccountScreenCopy(locale);
  const accountPasskeys = useAccountPasskeys(passkeys);

  const referralDiscount = referralsEnabled
    ? referrals?.summary.discount
    : undefined;
  const showReferralBadge =
    referralDiscount !== undefined && referralDiscount !== "0";
  const referralBadgeText = showReferralBadge
    ? formatReferralDiscountReduction(referralDiscount, locale)
    : undefined;
  const referralBadgeLabel = showReferralBadge
    ? m.accountReferralsNavigationBadgeLabel(
        { discount: formatReferralDiscount(referralDiscount, locale) },
        { locale }
      )
    : undefined;

  useEffect(() => {
    setReservationCount(reservationCount);
    return () => setReservationCount(undefined);
  }, [reservationCount, setReservationCount]);

  // Depend on the strings, not a badge object, so publishing it cannot loop.
  useEffect(() => {
    setReferralBadge(
      referralBadgeText === undefined || referralBadgeLabel === undefined
        ? undefined
        : { text: referralBadgeText, label: referralBadgeLabel }
    );
    return () => setReferralBadge(undefined);
  }, [referralBadgeLabel, referralBadgeText, setReferralBadge]);

  return (
    <>
      {referralsEnabled && (
        <ProfileCompletionReferralNotice
          locale={locale}
          outcome={signupReferral}
        />
      )}

      <div hidden={activeSection !== "reservations"}>{reservations}</div>

      {referralsEnabled && (
        <div hidden={activeSection !== "referrals"}>
          <ReferralScreen locale={locale} referrals={referrals} />
        </div>
      )}

      <div hidden={activeSection !== "profile" && activeSection !== "billing"}>
        <ProfileForm
          avatarPresentation={avatarPresentation}
          email={email}
          locale={locale}
          mode="edit"
          onSectionChange={changeSection}
          profile={profile}
          section={profileSection}
        />
      </div>

      {accountPasskeys && (
        <>
          <PasskeyPrompt
            accountHasPasskeys={
              accountPasskeys.passkeys === null
                ? undefined
                : accountPasskeys.passkeys.length > 0
            }
            accountId={accountPasskeys.accountId}
            createPasskey={() => accountPasskeys.createPasskey("prompt")}
            locale={locale}
          />
          <div hidden={activeSection !== "security"}>
            <SignInSecurityScreen
              confirmWithPasskey={accountPasskeys.confirmWithPasskey}
              createPasskey={() => accountPasskeys.createPasskey("settings")}
              deletePasskey={accountPasskeys.deletePasskey}
              email={email}
              locale={locale}
              passkeys={accountPasskeys.passkeys}
              renamePasskey={accountPasskeys.renamePasskey}
            />
          </div>
        </>
      )}

      {activeSection === "legal" && isPrivateAccountPathname && (
        <LegalScreen locale={locale} />
      )}

      <div hidden={activeSection !== "danger"}>
        <DeleteAccountCard
          deletionPending={false}
          email={email}
          heading={copy.dangerTitle}
          locale={locale}
          passkeys={accountPasskeys}
        />
      </div>
    </>
  );
}
