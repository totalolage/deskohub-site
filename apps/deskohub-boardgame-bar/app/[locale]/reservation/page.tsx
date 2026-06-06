import { notFound } from "next/navigation";
import { type Locale, m, setLocale } from "@/features/i18n";
import { siteConstants } from "@/shared/utils/constants";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../route";

const choiceQrLocale = (locale: Locale) => (locale === "cs-CZ" ? "cz" : "en");

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
    <div className="container py-8 px-4 xl:max-w-5xl">
      <iframe
        className="mx-auto h-[620px] w-full max-w-[360px] rounded-lg border-0"
        src={`https://embed.choiceqr.com/booking/deskohub?lang=${choiceQrLocale(locale)}`}
        style={{ border: "none" }}
        title={m["tableReservation.pageTitle"]()}
      />
    </div>
  );
}
