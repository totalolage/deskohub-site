"use client";

import { type ReactNode, useEffect } from "react";
import { useAccountLayout } from "@/features/account/components/account-layout-shell";
import { CustomerAgentConnectionsSection } from "@/features/account/components/customer-agent-connections/customer-agent-connections-section";
import { DeleteAccountCard } from "@/features/account/components/delete-account-card";
import { SignInSecuritySection } from "@/features/account/components/passkeys/sign-in-security-section";
import { useAccountPasskeys } from "@/features/account/components/passkeys/use-account-passkeys";
import { ProfileCompletionReferralNotice } from "@/features/account/components/profile-completion-referral-notice";
import { ProfileForm } from "@/features/account/components/profile-form";
import { ReferralScreen } from "@/features/account/components/referral-screen";
import type {
  CustomerAvatarPresentation,
  CustomerProfile,
  ProfileCompletionReferralOutcome,
} from "@/features/account/contracts";
import type { CustomerAgentConnection } from "@/features/account/customer-agent-connections";
import type { AccountPasskeySettings } from "@/features/account/passkeys";
import { accountSectionLabel } from "@/features/account/sections";
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
  /** The connected AI assistants; null when they couldn't be read. */
  readonly assistants?: readonly CustomerAgentConnection[] | null;
};

export function LinkedAccount({
  assistants,
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
  const {
    activeSection,
    changeSection,
    setReferralBadge,
    setReservationCount,
  } = useAccountLayout();
  const profileSection = activeSection === "billing" ? "billing" : "profile";
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
        <SignInSecuritySection
          accountPasskeys={accountPasskeys}
          email={email}
          hidden={activeSection !== "security"}
          locale={locale}
        />
      )}

      {assistants !== undefined && (
        <CustomerAgentConnectionsSection
          connections={assistants}
          hidden={activeSection !== "assistants"}
          locale={locale}
        />
      )}

      <div hidden={activeSection !== "danger"}>
        <DeleteAccountCard
          deletionPending={false}
          email={email}
          heading={accountSectionLabel("danger", locale)}
          locale={locale}
          passkeys={accountPasskeys}
        />
      </div>
    </>
  );
}
