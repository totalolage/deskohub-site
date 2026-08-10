import Link from "next/link";
import { type Locale, m } from "@/features/i18n";

type ReservationPrivacyNoticeProps = {
  readonly locale: Locale;
};

export function ReservationPrivacyNotice({
  locale,
}: ReservationPrivacyNoticeProps) {
  return (
    <p className="rounded-[1.35rem] border border-navy-blue/10 bg-navy-blue/2.5 p-4 text-sm leading-6 text-navy-blue/66">
      {m.reservationPrivacyNoteBefore({}, { locale })}{" "}
      <Link
        className="font-semibold text-burned-orange underline underline-offset-4 transition-colors hover:text-chilean-fire"
        href={`/${locale}/privacy-policy`}
        prefetch={false}
        rel="noreferrer"
        target="_blank"
      >
        {m.reservationPrivacyNoteLinkLabel({}, { locale })}
      </Link>
      {m.reservationPrivacyNoteAfter({}, { locale })}
    </p>
  );
}
