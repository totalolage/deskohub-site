import { Effect, Option, Schema } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  type PostOrderInvoiceState,
  ReservationInvoiceService,
} from "@/features/accounting/backend/reservation-invoice";
import { ReservationInvoiceServiceLiveWithDependencies } from "@/features/accounting/backend/reservation-invoice-live.server";
import { PostOrderInvoicePage } from "@/features/accounting/components/post-order-invoice-page";
import { type Locale, locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { reservationAccessTokenQueryParam } from "@/features/reservation/backend/reservation-access-token";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { reservationInvoicePath } from "@/features/reservation/routes";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  getSearchParamsDecoder,
  getWorkspaceLocalizedCanonicalUrl,
  type SearchParamsRecord,
} from "@/shared/utils";

export const maxDuration = 30;
export const instant = true;

type PageProps = {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<SearchParamsRecord>;
};

const decodeParams = Schema.decodeUnknownOption(
  Schema.Struct({ orderId: workspaceReservationIdSchema })
);
const decodeSearchParams = getSearchParamsDecoder(
  Schema.Struct({
    [reservationAccessTokenQueryParam]: Schema.optional(
      Schema.NonEmptyString.check(Schema.isMaxLength(4096))
    ),
  })
);

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { orderId } = Option.getOrElse(decodeParams(await params), () =>
    notFound()
  );
  return runWithRequestLocale((locale) => ({
    title: m.postOrderInvoiceMetadataTitle({}, { locale }),
    description: m.postOrderInvoiceMetadataDescription({}, { locale }),
    alternates: {
      canonical: getWorkspaceLocalizedCanonicalUrl(
        locale,
        `${reservationInvoicePath}/${orderId}`
      ),
      languages: Object.fromEntries(
        locales.map((itemLocale) => [
          itemLocale,
          getWorkspaceLocalizedCanonicalUrl(
            itemLocale,
            `${reservationInvoicePath}/${orderId}`
          ),
        ])
      ),
    },
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  }));
}

export default async function LocalizedPostOrderInvoicePage(props: PageProps) {
  return runWithRequestLocale((locale) => (
    <Suspense fallback={null}>
      <PostOrderInvoiceContent {...props} locale={locale} />
    </Suspense>
  ));
}

async function PostOrderInvoiceContent({
  locale,
  params,
  searchParams,
}: PageProps & { readonly locale: Locale }) {
  await connection();
  const { orderId } = Option.getOrElse(decodeParams(await params), () =>
    notFound()
  );
  const decodedSearchParams = Option.getOrElse(
    decodeSearchParams(await searchParams),
    () => ({ accessToken: undefined })
  );
  const accessToken = decodedSearchParams[reservationAccessTokenQueryParam];
  const initialState = await Effect.flatMap(
    ReservationInvoiceService,
    (service) => service.getPostOrderState({ orderId, locale, accessToken })
  ).pipe(
    Effect.tapError(() =>
      Effect.logWarning("Post-order invoice state could not be loaded")
    ),
    Effect.orElseSucceed((): PostOrderInvoiceState => "unavailable"),
    Effect.provide(ReservationInvoiceServiceLiveWithDependencies),
    runWorkspaceEffect("accounting.post-order-invoice.load")
  );

  return (
    <PostOrderInvoicePage
      accessToken={accessToken}
      initialState={initialState}
      locale={locale}
      orderId={orderId}
    />
  );
}
