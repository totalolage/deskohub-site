import { notFound } from "next/navigation";
import { type Locale, m, setLocale } from "@/features/i18n";
import { siteConstants } from "@/shared/utils/constants";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../route";

const choiceQrLocale: Record<Locale, string> = {
  "cs-CZ": "cs",
  "en-US": "en",
};

export const generateMetadata = metadata({
  title: m["reservation.pageTitle"](),
  description: m["reservation.pageDescription"](),
});

export default async function ReservationPage({ params }: RouteProps_locale) {
  const { locale } = await params;
  setLocale(locale, { reload: false });

  if (!siteConstants.featureFlags.tableReservations) {
    notFound();
  }

  return (
    <iframe
      className="h-full w-full min-h-[calc(100dvh-var(--header-height))] "
      src={`https://embed.choiceqr.com/booking/deskohub?lang=${choiceQrLocale[locale]}`}
      title={m["tableReservation.pageTitle"]()}
    />
  );
}
