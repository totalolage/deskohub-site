import { Effect, Layer } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import {
  CheckoutReturnStateTokenRepository,
  CheckoutReturnStateTokenRepositoryLive,
} from "@/features/checkout/backend/checkout-return-state-token.repository";
import { CheckoutFlowLayout } from "@/features/checkout/components/checkout-flow-layout";
import { CheckoutPaymentRetryPage } from "@/features/checkout/components/checkout-payment-retry-page";
import { checkoutReturnStateJsonSchema } from "@/features/checkout/schemas/checkout-return-state";
import { getCheckoutReturnStateTokenFromSearchParams } from "@/features/checkout/schemas/checkout-return-state-token";
import { isLocale, locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import type { ReservationInput } from "@/features/reservation/schemas/reservation";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";
import {
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

const loadCheckoutReturnStateReservation = (input: {
  readonly orderId: string;
  readonly checkoutToken: string;
}) =>
  Effect.gen(function* () {
    // Consume only at final retry form rendering so the opaque token survives
    // Nexi return/cancel plus internal result/order/status redirects.
    const repository = yield* CheckoutReturnStateTokenRepository;
    const token = yield* repository.consume({
      paymentOrderId: input.orderId,
      token: input.checkoutToken,
    });
    const state = checkoutReturnStateJsonSchema.safeParse(token.state);

    if (!state.success) {
      return yield* Effect.fail(
        new Error("Invalid checkout return-state token payload")
      );
    }

    return {
      ...state.data.reservation,
      legalConsent: false,
    } satisfies ReservationInput;
  }).pipe(Effect.provide(checkoutReturnStateTokenLayer), runWorkspaceEffect);

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

  const reservation = await loadCheckoutReturnStateReservation({
    orderId,
    checkoutToken,
  }).catch(() => notFound());

  return runWithRequestLocale(locale, () => (
    <CheckoutFlowLayout activeStepIndex={1} locale={locale}>
      <CheckoutPaymentRetryPage
        locale={locale}
        orderId={orderId}
        reservation={reservation}
      />
    </CheckoutFlowLayout>
  ));
}
