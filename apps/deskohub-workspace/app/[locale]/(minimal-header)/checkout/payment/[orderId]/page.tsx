import { Effect, Layer } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import {
  CheckoutReturnStateTokenRepository,
  CheckoutReturnStateTokenRepositoryLive,
} from "@/features/checkout/backend/checkout-return-state-token.repository";
import {
  CheckoutStatusService,
  CheckoutStatusServiceLiveWithDependencies,
  type CheckoutStatusViewModel,
} from "@/features/checkout/backend/checkout-status.service";
import {
  buildSignedPayState,
  sealPayStateForUrl,
} from "@/features/checkout/backend/pay-state.server";
import { buildAuthoritativeWorkspaceCheckoutQuote } from "@/features/checkout/backend/workspace-checkout-quote.server";
import { CheckoutFlowLayout } from "@/features/checkout/components/checkout-flow-layout";
import { CheckoutPayPage } from "@/features/checkout/components/checkout-pay-page";
import { checkoutReturnStateJsonSchema } from "@/features/checkout/schemas/checkout-return-state";
import { getCheckoutReturnStateTokenFromSearchParams } from "@/features/checkout/schemas/checkout-return-state-token";
import { isLocale, locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";
import {
  getSearchParam,
  getWorkspaceLocalizedCanonicalUrl,
  workspaceSiteConstants,
} from "@/shared/utils";

export const dynamic = "force-dynamic";

type CheckoutPaymentSearchParams = Record<
  string,
  string | string[] | undefined
>;

type LocalizedCheckoutPaymentPageProps = {
  params: Promise<{ locale: string; orderId: string }>;
  searchParams: Promise<CheckoutPaymentSearchParams>;
};

const checkoutReturnStateTokenLayer =
  CheckoutReturnStateTokenRepositoryLive.pipe(
    Layer.provide(WorkspaceDatabaseLive),
    Layer.orDie
  );

const checkoutStatusLayer = CheckoutStatusServiceLiveWithDependencies.pipe(
  Layer.provide(WorkspaceDatabaseLive),
  Layer.orDie
);

const getRetryOutcome = (
  status: CheckoutStatusViewModel["status"]
): "cancelled" | "failed" | undefined => {
  if (status === "cancelled") return "cancelled";
  if (status === "payment_failed" || status === "expired") return "failed";
  return undefined;
};

const loadCheckoutReturnStateReservation = (input: {
  readonly orderId: string;
  readonly checkoutToken: string;
  readonly outcome: string | undefined;
}) =>
  Effect.gen(function* () {
    const repository = yield* CheckoutReturnStateTokenRepository;
    const checkoutStatus = yield* CheckoutStatusService;
    const token = yield* repository.readValid({
      paymentOrderId: input.orderId,
      token: input.checkoutToken,
    });
    const originalOrderStatus =
      input.outcome === "cancelled"
        ? yield* checkoutStatus.recordProviderReturn({
            orderId: input.orderId,
            returnOutcome: "cancelled",
          })
        : yield* checkoutStatus.getStatus({
            orderId: input.orderId,
            returnOutcome: "unknown",
          });
    const retryOutcome = getRetryOutcome(originalOrderStatus.status);

    if (!retryOutcome) {
      return yield* Effect.fail(
        new Error("Original payment order is not retryable")
      );
    }

    const state = checkoutReturnStateJsonSchema.safeParse(token.state);

    if (!state.success) {
      return yield* Effect.fail(
        new Error("Invalid checkout return-state token payload")
      );
    }

    const reservation = state.data.reservation;
    const quote = yield* Effect.tryPromise(() =>
      buildAuthoritativeWorkspaceCheckoutQuote(reservation)
    );

    return { reservation, quote, retryOutcome };
  }).pipe(
    Effect.provide(checkoutReturnStateTokenLayer),
    Effect.provide(checkoutStatusLayer),
    runWorkspaceEffect
  );

export async function generateMetadata({
  params,
}: LocalizedCheckoutPaymentPageProps): Promise<Metadata> {
  const { locale, orderId } = await params;
  if (!isLocale(locale) || !orderId) notFound();

  return runWithRequestLocale(locale, () => {
    const title = m.checkoutPaymentRetryMetadataTitle({}, { locale });
    const description = m.checkoutPaymentRetryMetadataDescription(
      {},
      { locale }
    );
    const url = getWorkspaceLocalizedCanonicalUrl(
      locale,
      `/checkout/payment/${orderId}`
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
              `/checkout/payment/${orderId}`
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
    } satisfies Metadata;
  });
}

export default async function LocalizedCheckoutPaymentPage({
  params,
  searchParams,
}: LocalizedCheckoutPaymentPageProps) {
  const { locale, orderId } = await params;
  if (!isLocale(locale) || !orderId) notFound();

  const checkoutToken = getCheckoutReturnStateTokenFromSearchParams(
    await searchParams
  );
  if (!checkoutToken) notFound();
  const outcome = getSearchParam(await searchParams, "outcome");

  const retryState = await loadCheckoutReturnStateReservation({
    orderId,
    checkoutToken,
    outcome,
  }).catch(() => notFound());
  const payState = buildSignedPayState({
    locale,
    reservation: retryState.reservation,
    quote: retryState.quote,
    orderId,
  });
  const sealedPayState = sealPayStateForUrl(payState);
  if (sealedPayState.type !== "sealedPayState") notFound();

  return runWithRequestLocale(locale, () => (
    <CheckoutFlowLayout activeStepKey="pay" locale={locale}>
      <CheckoutPayPage
        locale={locale}
        orderId={orderId}
        payStateToken={sealedPayState.token}
        retryOutcome={retryState.retryOutcome}
        summary={retryState.quote.summary}
        variant="retry"
      />
    </CheckoutFlowLayout>
  ));
}
