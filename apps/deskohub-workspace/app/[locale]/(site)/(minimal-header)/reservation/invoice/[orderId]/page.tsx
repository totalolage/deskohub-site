import { Effect, Option, Schema } from "effect";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  type PostOrderInvoiceState,
  ReservationInvoiceService,
} from "@/features/accounting/backend/reservation-invoice.service";
import { PostOrderInvoicePage } from "@/features/accounting/components/post-order-invoice-page";
import { CheckoutFlowPageSkeleton } from "@/features/checkout/components/checkout-flow-page-skeleton";
import { type Locale, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { privateOrderPage } from "@/features/reservation/private-order-page.server";
import {
  reservationAccessTokenQueryParam,
  reservationAccessTokenSchema,
} from "@/features/reservation/reservation-access-token";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  getSearchParamsDecoder,
  type SearchParamsRecord,
} from "@/shared/utils";

export const maxDuration = 30;
export const instant = true;

type PageProps = {
  params: Promise<{ locale: string; orderId: string }>;
  searchParams: Promise<SearchParamsRecord>;
};

const { generateMetadata, readOrderId } = privateOrderPage({
  title: m.postOrderInvoiceMetadataTitle,
  description: m.postOrderInvoiceMetadataDescription,
});

export { generateMetadata };

const decodeSearchParams = getSearchParamsDecoder(
  Schema.Struct({
    [reservationAccessTokenQueryParam]: Schema.optional(
      reservationAccessTokenSchema
    ),
  })
);

export default async function LocalizedPostOrderInvoicePage(props: PageProps) {
  return runWithRequestLocale((locale) => (
    <Suspense
      fallback={
        <CheckoutFlowPageSkeleton
          label={m.postOrderInvoiceMetadataTitle({}, { locale })}
          locale={locale}
        />
      }
    >
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
  const orderId = await readOrderId(params);
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
    Effect.provide(ReservationInvoiceService.Live),
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
