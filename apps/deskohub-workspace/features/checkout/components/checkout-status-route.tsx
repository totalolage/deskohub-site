import { Effect, Layer, Option, Schema } from "effect";
import { cookies } from "next/headers";
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
import { CheckoutStatusPage } from "@/features/checkout/components/checkout-status-page";
import { CheckoutStatusPageSkeleton } from "@/features/checkout/components/checkout-status-page-skeleton";
import type { Locale } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { readReservationAccessCookie } from "@/features/reservation/backend/reservation-access-cookie";
import { ReservationAuthorizationService } from "@/features/reservation/backend/reservation-authorization.service";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { RouteAutoRefresh } from "@/shared/components/route-auto-refresh";
import {
  getSearchParamsDecoder,
  type SearchParamsRecord,
} from "@/shared/utils";

type CheckoutStatusPresentation = "page" | "modal";

type CheckoutStatusRouteProps = {
  readonly params: Promise<{ orderId: string }>;
  readonly searchParams: Promise<SearchParamsRecord>;
  readonly presentation?: CheckoutStatusPresentation;
};

const decodeCheckoutStatusParams = Schema.decodeUnknownOption(
  Schema.Struct({ orderId: workspaceReservationIdSchema })
);

const decodeCheckoutStatusSearchParams = getSearchParamsDecoder(
  Schema.Struct({
    outcome: Schema.optional(Schema.Literals(["success", "cancelled"])),
  })
);

export function CheckoutStatusRoute({
  params,
  searchParams,
  presentation = "page",
}: CheckoutStatusRouteProps) {
  return runWithRequestLocale((locale) => (
    <>
      <CheckoutPaymentWindowCoordinator />
      <Suspense
        fallback={
          <CheckoutStatusFallback locale={locale} presentation={presentation} />
        }
      >
        <CheckoutStatusContent
          params={params}
          presentation={presentation}
          searchParams={searchParams}
        />
      </Suspense>
    </>
  ));
}

async function CheckoutStatusContent({
  params,
  presentation,
  searchParams,
}: {
  readonly params: Promise<{ orderId: string }>;
  readonly presentation: CheckoutStatusPresentation;
  readonly searchParams: Promise<SearchParamsRecord>;
}) {
  const decodedParams = decodeCheckoutStatusParams(await params);
  const { orderId } = Option.getOrElse(decodedParams, () => notFound());

  return runWithRequestLocale(async (locale) => {
    await connection();
    const cookieStore = await cookies();
    const accessCookie = readReservationAccessCookie(cookieStore, orderId);
    const rawSearchParams = await searchParams;
    const decodedSearchParams = Option.getOrElse(
      decodeCheckoutStatusSearchParams(rawSearchParams),
      () => ({ outcome: undefined })
    );
    const returnOutcome = decodedSearchParams.outcome ?? "unknown";
    const status = await Effect.gen(function* () {
      const service = yield* CheckoutStatusService;
      const authorization = yield* ReservationAuthorizationService;
      return yield* loadCheckoutStatusPage(service, authorization, {
        accessCookie,
        locale,
        orderId,
        returnOutcome,
      });
    }).pipe(
      Effect.tapError((cause) =>
        Effect.logError("Checkout status load failed", {
          orderId,
          returnOutcome,
          cause,
        })
      ),
      Effect.provide(
        Layer.mergeAll(
          CheckoutStatusService.Live,
          ReservationAuthorizationService.Live
        )
      ),
      runWorkspaceEffect("checkout.status.load")
    );
    return (
      <>
        <RouteAutoRefresh
          enabled={shouldAutoRefreshCheckoutStatus(status.status)}
        />
        <CheckoutStatusPage
          locale={locale}
          presentation={presentation}
          status={status}
        />
      </>
    );
  });
}

function CheckoutStatusFallback({
  locale,
  presentation,
}: {
  readonly locale: Locale;
  readonly presentation: CheckoutStatusPresentation;
}) {
  const skeleton = (
    <CheckoutStatusPageSkeleton locale={locale} presentation={presentation} />
  );

  if (presentation === "modal") return skeleton;

  return (
    <CheckoutFlowLayout activeStepKey="access" locale={locale}>
      {skeleton}
    </CheckoutFlowLayout>
  );
}
