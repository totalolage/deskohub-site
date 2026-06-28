import { notFound } from "next/navigation";
import { type Locale, m, setLocale } from "@/features/i18n";
import { getSearchParam, type SearchParamsRecord } from "@/shared/utils";
import { siteConstants } from "@/shared/utils/constants";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../route";

type ReservationPageProps = RouteProps_locale<{
  searchParams: Promise<SearchParamsRecord>;
}>;

const choiceQrLocale: Record<Locale, string> = {
  "cs-CZ": "cs",
  "en-US": "en",
};

export const generateMetadata = metadata({
  title: m["reservation.pageTitle"](),
  description: m["reservation.pageDescription"](),
});

export default async function ReservationPage({
  params,
  searchParams,
}: ReservationPageProps) {
  const { locale } = await params;
  setLocale(locale, { reload: false });

  if (!siteConstants.featureFlags.tableReservations) {
    notFound();
  }

  const bookingParams = new URLSearchParams({ lang: choiceQrLocale[locale] });
  const message = getSearchParam(await searchParams, "message")?.slice(0, 1000);
  if (message) {
    bookingParams.set("message", message);
  }

  return (
    <iframe
      className="h-full w-full min-h-[calc(100dvh-var(--header-height))] "
      src={`https://embed.choiceqr.com/booking/deskohub?${bookingParams}`}
      title={m["tableReservation.pageTitle"]()}
    />
  );
}
