"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import type { CustomerProfile } from "@/features/account/backend/customer-dotypos-adapter.service";
import { useAccountLayout } from "@/features/account/components/account-layout-shell";
import { getAccountScreenCopy } from "@/features/account/components/account-screen-copy";
import { DeleteAccountCard } from "@/features/account/components/delete-account-card";
import { LegalScreen } from "@/features/account/components/legal/legal-screen";
import { ProfileForm } from "@/features/account/components/profile-form";
import { ReservationHistory } from "@/features/account/components/reservation-history";
import type { CustomerReservationHistory } from "@/features/account/contracts";
import type { Locale } from "@/features/i18n";

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
  const pathname = usePathname();
  const { activeSection, changeSection, setReservationCount } =
    useAccountLayout();
  const normalizedPathname =
    pathname === null ? null : pathname.replace(/\/+$/, "") || "/";
  const isPrivateAccountPathname = normalizedPathname === `/${locale}/account`;
  const profileSection = activeSection === "billing" ? "billing" : "profile";
  const copy = getAccountScreenCopy(locale);
  const reservationCount =
    history.kind === "available" ? history.groups.current.length : undefined;

  useEffect(() => {
    setReservationCount(reservationCount);
    return () => setReservationCount(undefined);
  }, [reservationCount, setReservationCount]);

  return (
    <>
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

      {activeSection === "legal" && isPrivateAccountPathname && (
        <LegalScreen locale={locale} strings={copy.legal} />
      )}

      <div hidden={activeSection !== "danger"}>
        <DeleteAccountCard
          deletionPending={false}
          email={email}
          heading={copy.dangerTitle}
          locale={locale}
        />
      </div>
    </>
  );
}
