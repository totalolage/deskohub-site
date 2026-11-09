import Interpolate from "@doist/react-interpolate";
import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { type Locale, m } from "@/features/i18n";
import { ReservationFormLegalCard } from "./reservation-form-legal-card";

type ReservationPrivacyNoticeProps = {
  readonly locale: Locale;
};

export function ReservationPrivacyNotice({
  locale,
}: ReservationPrivacyNoticeProps) {
  return (
    <ReservationFormLegalCard
      indicator={
        <CircleCheck
          aria-hidden="true"
          className="size-6 text-burned-orange"
          focusable="false"
        />
      }
    >
      <Interpolate
        string={m.reservationPrivacyNote({}, { locale })}
        mapping={{
          privacyPolicy: (label) => (
            <Link
              className="font-semibold text-burned-orange underline underline-offset-4 transition-colors hover:text-chilean-fire"
              href={`/${locale}/privacy-policy`}
              prefetch={false}
              rel="noreferrer"
              target="_blank"
            >
              {label}
            </Link>
          ),
        }}
      />
    </ReservationFormLegalCard>
  );
}
