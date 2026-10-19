"use client";

import { type ReactNode, useEffect } from "react";
import { useAccountLayout } from "@/features/account/components/account-layout-shell";
import { DeleteAccountCard } from "@/features/account/components/delete-account-card";
import { SignInSecuritySection } from "@/features/account/components/passkeys/sign-in-security-section";
import { useAccountPasskeys } from "@/features/account/components/passkeys/use-account-passkeys";
import type { AccountPasskeySettings } from "@/features/account/passkeys";
import type { Locale } from "@/features/i18n";

type AccountWithoutProfileProps = {
  readonly email: string;
  readonly locale: Locale;
  /** True when the durable deletion marker is set and deletion is retryable. */
  readonly deletionPending?: boolean;
  /** The account's passkeys; absent while `login_passkeys` is off. */
  readonly passkeys?: AccountPasskeySettings;
  /** The card explaining why the profile isn't shown. */
  readonly children?: ReactNode;
  /**
   * The reservations the account booked without a profile, shown in the
   * Reservations section before the card.
   */
  readonly reservations?: ReactNode;
  /** The current reservations, counted in the navigation. */
  readonly reservationCount?: number;
};

/**
 * A signed-in account whose profile can't be shown. Sign-in methods need only
 * the session, so Sign-in & security and the post-sign-in passkey prompt
 * still work; an account pending deletion only confirms the deletion.
 */
export function AccountWithoutProfile({
  children,
  deletionPending = false,
  email,
  locale,
  passkeys,
  reservationCount,
  reservations,
}: AccountWithoutProfileProps) {
  const { activeSection, setReservationCount } = useAccountLayout();
  const accountPasskeys = useAccountPasskeys(passkeys);
  const signInSecurity = accountPasskeys && !deletionPending;
  const securityActive = signInSecurity && activeSection === "security";

  useEffect(() => {
    setReservationCount(reservationCount);
    return () => setReservationCount(undefined);
  }, [reservationCount, setReservationCount]);

  return (
    <>
      <div hidden={securityActive}>
        <div className="grid items-start gap-6">
          {reservations && (
            <div hidden={activeSection !== "reservations"}>{reservations}</div>
          )}
          {children}
          <DeleteAccountCard
            deletionPending={deletionPending}
            email={email}
            locale={locale}
            passkeys={accountPasskeys}
          />
        </div>
      </div>
      {signInSecurity && (
        <SignInSecuritySection
          accountPasskeys={accountPasskeys}
          email={email}
          hidden={!securityActive}
          locale={locale}
        />
      )}
    </>
  );
}
