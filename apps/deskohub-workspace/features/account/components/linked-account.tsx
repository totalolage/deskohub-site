"use client";

import Interpolate from "@doist/react-interpolate";
import { useState } from "react";
import type { CustomerProfile } from "@/features/account/backend/customer-dotypos-adapter.service";
import { getAccountScreenCopy } from "@/features/account/components/account-screen-copy";
import { DeleteAccountCard } from "@/features/account/components/delete-account-card";
import { LegalScreen } from "@/features/account/components/legal/legal-screen";
import { ProfileForm } from "@/features/account/components/profile-form";
import { ReservationHistory } from "@/features/account/components/reservation-history";
import {
  type AccountSection,
  AccountShell,
} from "@/features/account/components/shell/account-shell";
import { SignOutButton } from "@/features/account/components/sign-out-button";
import type { CustomerReservationHistory } from "@/features/account/contracts";
import { type Locale, m } from "@/features/i18n";
import { GuardedLink } from "@/shared/components/guarded-link";

type LinkedAccountProps = {
  readonly email: string;
  readonly history: CustomerReservationHistory;
  readonly locale: Locale;
  readonly profile: CustomerProfile;
};

export function LinkedAccount({
  email,
  history,
  locale,
  profile,
}: LinkedAccountProps) {
  const [activeSection, setActiveSection] =
    useState<AccountSection>("reservations");
  const [profileSection, setProfileSection] = useState<"profile" | "billing">(
    "profile"
  );
  const copy = getAccountScreenCopy(locale);
  const reservationCount =
    history.kind === "available" ? history.groups.current.length : undefined;

  const changeSection = (section: AccountSection) => {
    if (section === "profile" || section === "billing") {
      setProfileSection(section);
    }
    setActiveSection(section);
  };

  return (
    <AccountShell
      activeSection={activeSection}
      labels={copy.shell}
      onSectionChange={changeSection}
      reservationCount={reservationCount}
      signOut={<SignOutButton locale={locale} />}
      sidebarFooter={
        <div
          className="rounded-2xl border border-[#dfe4ec] p-4"
          style={{ backgroundColor: "#eeebe5" }}
        >
          <h2 className="text-sm font-semibold text-[#344258]">
            {m.accountHelpTitle({}, { locale })}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#52647c]">
            <Interpolate
              string={m.accountHelpBody({ contact: "{contact}" }, { locale })}
              mapping={{
                contact: (
                  <GuardedLink
                    className="font-semibold text-burned-orange underline underline-offset-4"
                    href={`/${locale}/contact`}
                  >
                    {m.accountHelpContact({}, { locale })}
                  </GuardedLink>
                ),
              }}
            />
          </p>
        </div>
      }
      title={m.accountTitle({}, { locale })}
    >
      <div hidden={activeSection !== "reservations"}>
        <ReservationHistory
          copy={copy.reservations}
          history={history}
          locale={locale}
        />
      </div>

      <div hidden={activeSection !== "profile" && activeSection !== "billing"}>
        <ProfileForm
          email={email}
          locale={locale}
          mode="edit"
          onSectionChange={changeSection}
          profile={profile}
          section={profileSection}
        />
      </div>

      <div hidden={activeSection !== "legal"}>
        <LegalScreen locale={locale} strings={copy.legal} />
      </div>

      <div hidden={activeSection !== "danger"}>
        <DeleteAccountCard
          deletionPending={false}
          email={email}
          heading={copy.dangerTitle}
          locale={locale}
        />
      </div>
    </AccountShell>
  );
}
