"use client";

import { type ReactNode, useEffect } from "react";
import { useAccountLayout } from "@/features/account/components/account-layout-shell";
import { CustomerAgentConnectionsSection } from "@/features/account/components/customer-agent-connections/customer-agent-connections-section";
import { DeleteAccountCard } from "@/features/account/components/delete-account-card";
import { SignInSecuritySection } from "@/features/account/components/passkeys/sign-in-security-section";
import { useAccountPasskeys } from "@/features/account/components/passkeys/use-account-passkeys";
import type { CustomerAgentConnection } from "@/features/account/customer-agent-connections";
import type { AccountPasskeySettings } from "@/features/account/passkeys";
import type { Locale } from "@/features/i18n";

type AccountWithoutProfileProps = {
  readonly email: string;
  readonly locale: Locale;
  /** True when the durable deletion marker is set and deletion is retryable. */
  readonly deletionPending?: boolean;
  /**
   * False for a shared review account, which must keep working for later
   * review rounds, and while that can't be ruled out.
   */
  readonly deletable: boolean;
  /** The account's passkeys; absent while `login_passkeys` is off. */
  readonly passkeys?: AccountPasskeySettings;
  /**
   * The connected AI assistants; null when they couldn't be read, absent
   * while deletion is pending.
   */
  readonly assistants?: readonly CustomerAgentConnection[] | null;
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
 * A signed-in account whose profile can't be shown. Sign-in methods and
 * connected assistants need only the session, so Sign-in & security, the
 * post-sign-in passkey prompt, and Connected assistants still work; an
 * account pending deletion only confirms the deletion, and a review account
 * offers no deletion.
 */
export function AccountWithoutProfile({
  assistants,
  children,
  deletable,
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
  const assistantsActive =
    assistants !== undefined && activeSection === "assistants";

  useEffect(() => {
    setReservationCount(reservationCount);
    return () => setReservationCount(undefined);
  }, [reservationCount, setReservationCount]);

  return (
    <>
      <div hidden={securityActive || assistantsActive}>
        <div className="grid items-start gap-6">
          {reservations && (
            <div hidden={activeSection !== "reservations"}>{reservations}</div>
          )}
          {children}
          {deletable && (
            <DeleteAccountCard
              deletionPending={deletionPending}
              email={email}
              locale={locale}
              passkeys={accountPasskeys}
            />
          )}
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
      {assistants !== undefined && (
        <CustomerAgentConnectionsSection
          connections={assistants}
          hidden={!assistantsActive}
          locale={locale}
        />
      )}
    </>
  );
}
