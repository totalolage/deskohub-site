import { Effect, Option, Schema } from "effect";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CheckoutFlowPageSkeleton } from "@/features/checkout/components/checkout-flow-page-skeleton";
import { type Locale, locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { ReservationAccessService } from "@/features/reservation/backend/reservation-access.service";
import { readReservationAccessCookie } from "@/features/reservation/backend/reservation-access-cookie";
import { ReservationAccessPage } from "@/features/reservation/components/reservation-access-page";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { reservationAccessPath } from "@/features/reservation/routes";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  getWorkspaceLocalizedCanonicalUrl,
  workspaceSiteConstants,
} from "@/shared/utils";

export const maxDuration = 30;
export const instant = true;

type LocalizedReservationAccessPageProps = {
  params: Promise<{ orderId: string }>;
};

const decodeReservationAccessParams = Schema.decodeUnknownOption(
  Schema.Struct({ orderId: workspaceReservationIdSchema })
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
}: LocalizedReservationAccessPageProps) {
  return runWithRequestLocale((locale) => (
    <Suspense fallback={<ReservationAccessFallback locale={locale} />}>
      <ReservationAccessContent params={params} />
    </Suspense>
  ));
}

async function ReservationAccessContent({
  params,
}: LocalizedReservationAccessPageProps) {
  const decodedParams = decodeReservationAccessParams(await params);
  const { orderId } = Option.getOrElse(decodedParams, () => notFound());

  return runWithRequestLocale(async (locale) => {
    await connection();
    const cookieStore = await cookies();
    const accessCookie = readReservationAccessCookie(cookieStore, orderId);
    const access = await Effect.flatMap(ReservationAccessService, (service) =>
      service.getAccess({ orderId, locale, accessCookie })
    ).pipe(
      Effect.provide(ReservationAccessService.Live),
      runWorkspaceEffect("reservation.access.load")
    );

    return (
      <ReservationAccessPage
        access={access}
        locale={locale}
        orderId={orderId}
      />
    );
  });
}

function ReservationAccessFallback({ locale }: { readonly locale: Locale }) {
  return (
    <CheckoutFlowPageSkeleton
      label={m.reservationAccessMetadataTitle({}, { locale })}
      locale={locale}
    />
  );
}
