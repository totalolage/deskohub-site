import { Effect, Option, Schema } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { type Locale, locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { ReservationAccessService } from "@/features/reservation/backend/reservation-access.service";
import { reservationAccessTokenQueryParam } from "@/features/reservation/backend/reservation-access-token";
import { ReservationAccessPage } from "@/features/reservation/components/reservation-access-page";
import { ReservationAccessPageSkeleton } from "@/features/reservation/components/reservation-access-page-skeleton";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { reservationAccessPath } from "@/features/reservation/routes";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { RouteAutoRefresh } from "@/shared/components/route-auto-refresh";
import {
  getSearchParamsDecoder,
  getWorkspaceLocalizedCanonicalUrl,
  type SearchParamsRecord,
  workspaceSiteConstants,
} from "@/shared/utils";

export const maxDuration = 30;
export const instant = true;

type LocalizedReservationAccessPageProps = {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<SearchParamsRecord>;
};

const decodeReservationAccessParams = Schema.decodeUnknownOption(
  Schema.Struct({ orderId: workspaceReservationIdSchema })
);

const decodeReservationAccessSearchParams = getSearchParamsDecoder(
  Schema.Struct({
    [reservationAccessTokenQueryParam]: Schema.optional(
      Schema.NonEmptyString.check(Schema.isMaxLength(4096))
    ),
  })
);

export async function generateMetadata({
  params,
}: LocalizedReservationAccessPageProps): Promise<Metadata> {
  const decodedParams = decodeReservationAccessParams(await params);
  const { orderId } = Option.getOrElse(decodedParams, () => notFound());

  return runWithRequestLocale((locale) => {
    const title = m.reservationAccessMetadataTitle({}, { locale });
    const description = m.reservationAccessMetadataDescription({}, { locale });
    const url = getWorkspaceLocalizedCanonicalUrl(
      locale,
      `${reservationAccessPath}/${orderId}`
    );

    return {
      title,
      description,
      alternates: {
        canonical: url,
        languages: Object.fromEntries(
          locales.map((itemLocale) => [
            itemLocale,
            getWorkspaceLocalizedCanonicalUrl(
              itemLocale,
              `${reservationAccessPath}/${orderId}`
            ),
          ])
        ),
      },
      openGraph: {
        title,
        description,
        url,
        siteName: workspaceSiteConstants.brand.name,
        locale,
        type: "website",
      },
      robots: { index: false, follow: false },
      referrer: "no-referrer",
    } satisfies Metadata;
  });
}

export default async function LocalizedReservationAccessPage({
  params,
  searchParams,
}: LocalizedReservationAccessPageProps) {
  return runWithRequestLocale((locale) => (
    <Suspense fallback={<ReservationAccessFallback locale={locale} />}>
      <ReservationAccessContent params={params} searchParams={searchParams} />
    </Suspense>
  ));
}

async function ReservationAccessContent({
  params,
  searchParams,
}: LocalizedReservationAccessPageProps) {
  const decodedParams = decodeReservationAccessParams(await params);
  const { orderId } = Option.getOrElse(decodedParams, () => notFound());

  return runWithRequestLocale(async (locale) => {
    await connection();
    const decodedSearchParams = Option.getOrElse(
      decodeReservationAccessSearchParams(await searchParams),
      () => ({ accessToken: undefined })
    );
    const accessToken = decodedSearchParams[reservationAccessTokenQueryParam];
    const access = await Effect.flatMap(ReservationAccessService, (service) =>
      service.getAccess({ orderId, locale, accessToken })
    ).pipe(
      Effect.provide(ReservationAccessService.LiveWithDependencies),
      runWorkspaceEffect("reservation.access.load")
    );

    let refreshAt: string | undefined;
    if (access.state === "upcoming") {
      refreshAt = access.availableAt.toString();
    } else if (access.state === "available") {
      refreshAt = access.unavailableAt.toString();
    }

    return (
      <>
        <RouteAutoRefresh
          enabled={access.state === "available"}
          intervalMs={60_000}
          refreshAt={refreshAt}
          refreshOnFocus={access.state !== "ended"}
        />
        <ReservationAccessPage access={access} locale={locale} />
      </>
    );
  });
}

function ReservationAccessFallback({ locale }: { readonly locale: Locale }) {
  return <ReservationAccessPageSkeleton locale={locale} />;
}
