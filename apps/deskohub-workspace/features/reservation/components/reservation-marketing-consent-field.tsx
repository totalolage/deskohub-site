"use client";

import Link from "next/link";
import { type Locale, m } from "@/features/i18n";
import { ReservationConsentField } from "./reservation-consent-field";

type ReservationMarketingConsentFieldProps = {
  readonly id?: string;
  readonly locale: Locale;
};

export function ReservationMarketingConsentField({
  id = "reservation-marketing-consent",
  locale,
}: ReservationMarketingConsentFieldProps) {
  return (
    <ReservationConsentField id={id} name="marketingConsent">
      {m.reservationMarketingConsentBefore({}, { locale })}{" "}
      <Link
        className="font-semibold text-burned-orange underline underline-offset-4 transition-colors hover:text-chilean-fire"
        href={`/${locale}/marketing-communications`}
        prefetch={false}
        rel="noreferrer"
        target="_blank"
      >
        {m.reservationMarketingConsentLinkLabel({}, { locale })}
      </Link>
      {m.reservationMarketingConsentAfter({}, { locale })}
    </ReservationConsentField>
  );
}
