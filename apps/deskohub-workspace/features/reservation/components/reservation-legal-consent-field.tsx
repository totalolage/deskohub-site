"use client";

import Link from "next/link";
import { type Locale, m } from "@/features/i18n";
import { ReservationConsentField } from "./reservation-consent-field";

type ReservationLegalConsentFieldProps = {
  readonly id?: string;
  readonly locale: Locale;
};

export function ReservationLegalConsentField({
  id = "reservation-privacy-consent",
  locale,
}: ReservationLegalConsentFieldProps) {
  return (
    <ReservationConsentField id={id} name="legalConsent">
      {m.reservationPrivacyNoteBefore({}, { locale })}{" "}
      <Link
        className="font-semibold text-burned-orange underline underline-offset-4 transition-colors hover:text-chilean-fire"
        href={`/${locale}/privacy-policy`}
        prefetch={false}
        rel="noreferrer"
        target="_blank"
      >
        {m.reservationPrivacyNoteLinkLabel({}, { locale })}
      </Link>{" "}
      {m.reservationPrivacyNoteAfter({}, { locale })}
    </ReservationConsentField>
  );
}
