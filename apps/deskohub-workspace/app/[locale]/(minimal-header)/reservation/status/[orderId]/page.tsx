import { Effect, Option, Schema } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  CheckoutStatusService,
  loadCheckoutStatusPage,
} from "@/features/checkout/backend/checkout";
import { shouldAutoRefreshCheckoutStatus } from "@/features/checkout/checkout-status-refresh-policy";
import { CheckoutFlowLayout } from "@/features/checkout/components/checkout-flow-layout";
import { CheckoutPaymentWindowCoordinator } from "@/features/checkout/components/checkout-payment-window";
import { CheckoutStatusAutoRefresh } from "@/features/checkout/components/checkout-status-auto-refresh";
import { CheckoutStatusPage } from "@/features/checkout/components/checkout-status-page";
import { CheckoutStatusPageSkeleton } from "@/features/checkout/components/checkout-status-page-skeleton";
import { type Locale, locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { reservationStatusPath } from "@/features/reservation/routes";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  getSearchParamsDecoder,
  getWorkspaceLocalizedCanonicalUrl,
  type SearchParamsRecord,
  workspaceSiteConstants,
} from "@/shared/utils";

export const maxDuration = 30;
export const instant = true;

type LocalizedCheckoutStatusPageProps = {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<SearchParamsRecord>;
};

const decodeCheckoutStatusParams = Schema.decodeUnknownOption(
  Schema.Struct({ orderId: workspaceReservationIdSchema })
);

const decodeCheckoutStatusSearchParams = getSearchParamsDecoder(
  Schema.Struct({
    outcome: Schema.optional(Schema.Literals(["success", "cancelled"])),
    statusToken: Schema.optional(
      Schema.NonEmptyString.check(Schema.isMaxLength(4096))
    ),
  })
);

export async function generateMetadata({
  params,
}: LocalizedCheckoutStatusPageProps): Promise<Metadata> {
  const decodedParams = decodeCheckoutStatusParams(await params);
  const { orderId } = Option.getOrElse(decodedParams, () => notFound());

  return runWithRequestLocale((locale) => {
    const title = m.checkoutStatusMetadataTitle({}, { locale });
    const description = m.checkoutStatusMetadataDescription({}, { locale });
    const url = getWorkspaceLocalizedCanonicalUrl(
      locale,
      `${reservationStatusPath}/${orderId}`
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
              `${reservationStatusPath}/${orderId}`
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

export default async function LocalizedCheckoutStatusPage({
  params,
  searchParams,
}: LocalizedCheckoutStatusPageProps) {
  return runWithRequestLocale((locale) => (
    <>
      <CheckoutPaymentWindowCoordinator />
      <Suspense fallback={<CheckoutStatusFallback locale={locale} />}>
        <CheckoutStatusContent params={params} searchParams={searchParams} />
      </Suspense>
    </>
  ));
}

async function CheckoutStatusContent({
  params,
  searchParams,
}: LocalizedCheckoutStatusPageProps) {
  const decodedParams = decodeCheckoutStatusParams(await params);
  const { orderId } = Option.getOrElse(decodedParams, () => notFound());

  return runWithRequestLocale(async (locale) => {
    await connection();
    const rawSearchParams = await searchParams;
    const decodedSearchParams = Option.getOrElse(
      decodeCheckoutStatusSearchParams(rawSearchParams),
      () => ({ outcome: undefined, statusToken: undefined })
    );
    const returnOutcome = decodedSearchParams.outcome ?? "unknown";
    const statusToken = decodedSearchParams.statusToken;
    const status = await Effect.flatMap(CheckoutStatusService, (service) =>
      loadCheckoutStatusPage(service, {
        orderId,
        returnOutcome,
        ...(statusToken ? { statusToken } : {}),
      })
    ).pipe(
      Effect.tapError((cause) =>
        Effect.logError("Checkout status load failed", {
          orderId,
          returnOutcome,
          hasStatusToken: statusToken !== undefined,
          cause,
        })
      ),
      Effect.provide(CheckoutStatusService.LiveWithDependencies),
      runWorkspaceEffect("checkout.status.load")
    );
    const accessCode =
      status.status === "not_found" ? undefined : status.accessCode;
    let accessRefreshAt: string | undefined;
    if (accessCode?.state === "upcoming") {
      accessRefreshAt = accessCode.availableAt.toString();
    } else if (accessCode?.state === "available") {
      accessRefreshAt = accessCode.unavailableAt.toString();
    }

    return (
      <>
        <CheckoutStatusAutoRefresh
          enabled={
            shouldAutoRefreshCheckoutStatus(status.status) ||
            accessCode?.state === "available"
          }
          intervalMs={accessCode?.state === "available" ? 60_000 : undefined}
          refreshAt={accessRefreshAt}
          refreshOnFocus={accessCode !== undefined}
        />
        <CheckoutStatusPage locale={locale} status={status} />
      </>
    );
  });
}

function CheckoutStatusFallback({ locale }: { readonly locale: Locale }) {
  return (
    <CheckoutFlowLayout activeStepKey="access" locale={locale}>
      <CheckoutStatusPageSkeleton locale={locale} />
    </CheckoutFlowLayout>
  );
}
