import { Effect, Option, Ref, Schema } from "effect";
import { NextResponse } from "next/server";
import {
  appendVercelPreviewProtectionBypass,
  CheckoutStatusService,
  CheckoutStatusServiceLiveWithDependencies,
  type CheckoutStatusViewModel,
} from "@/features/checkout/backend/checkout";
import { appendExistingCheckoutReturnStateToken } from "@/features/checkout/schemas/checkout-return-state-token";
import { getParamsDecoder } from "@/features/i18n/server/route-params";
import {
  defineWorkspaceRoute,
  mapWorkspaceInternalRouteFailure,
} from "@/shared/backend/workspace-route";
import type { SearchParamsRecord } from "@/shared/utils";

export const maxDuration = 45;

type LocalizedCheckoutResultRouteContext = {
  readonly params: Promise<{ locale: string; orderId: string }>;
};

const decodeCheckoutResultParams = getParamsDecoder({
  orderId: Schema.NonEmptyString,
});

const loadCheckoutStatus = (orderId: string) =>
  Effect.gen(function* () {
    const service = yield* CheckoutStatusService;
    return yield* service.refreshStatus({
      orderId,
      returnOutcome: "unknown",
    });
  });

const loadCheckoutStatusAttempt = (
  orderId: string,
  attempts: Ref.Ref<number>
) =>
  Effect.gen(function* () {
    const attempt = yield* Ref.updateAndGet(attempts, (value) => value + 1);
    if (attempt > 1) {
      yield* Effect.logWarning("Retrying checkout status refresh", {
        orderId,
        attempt,
      });
      yield* Effect.sleep("1500 millis");
    }

    return yield* loadCheckoutStatus(orderId).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Checkout status refresh retry failed", {
          orderId,
          attempt,
          cause,
        }).pipe(Effect.as(undefined))
      )
    );
  });

const loadCheckoutStatusWithBriefRetry = Effect.fn(
  "loadCheckoutStatusWithBriefRetry"
)(function* (orderId: string) {
  const attempts = yield* Ref.make(0);
  return yield* loadCheckoutStatusAttempt(orderId, attempts).pipe(
    Effect.repeat({
      times: 3,
      while: (attemptStatus) =>
        !attemptStatus ||
        attemptStatus.status === "created" ||
        attemptStatus.status === "pending",
    })
  );
});

const getRetryOutcome = (status: CheckoutStatusViewModel["status"]) => {
  if (status === "cancelled") return "cancelled";
  if (status === "payment_failed" || status === "expired") return "failed";
  return undefined;
};

const getCheckoutPaymentRetryRedirectPath = (input: {
  readonly locale: string;
  readonly orderId: string;
  readonly outcome: "cancelled" | "failed";
  readonly searchParams: SearchParamsRecord;
}) => {
  const url = new URL(
    `/${input.locale}/checkout/payment/${input.orderId}`,
    "https://deskohub.local"
  );
  url.searchParams.set("outcome", input.outcome);
  appendExistingCheckoutReturnStateToken(url, input.searchParams);
  appendVercelPreviewProtectionBypass(url, { setBypassCookie: true });

  return `${url.pathname}${url.search}`;
};

const getCheckoutStatusRedirectPath = (input: {
  readonly locale: string;
  readonly orderId: string;
}) => {
  const url = new URL(
    `/${input.locale}/checkout/status/${input.orderId}`,
    "https://deskohub.local"
  );
  appendVercelPreviewProtectionBypass(url, { setBypassCookie: true });

  return `${url.pathname}${url.search}`;
};

const getSearchParamsRecord = (url: URL): SearchParamsRecord =>
  Object.fromEntries(url.searchParams);

const handleCheckoutResult = Effect.fn("handleCheckoutResult")(function* (
  request: Request,
  { params }: LocalizedCheckoutResultRouteContext
) {
  const decodedParams = decodeCheckoutResultParams(
    yield* Effect.promise(() => params)
  );
  const routeParams = Option.getOrUndefined(decodedParams);
  if (!routeParams) return new NextResponse(null, { status: 404 });

  const { locale, orderId } = routeParams;
  const rawSearchParams = getSearchParamsRecord(new URL(request.url));
  const status = yield* loadCheckoutStatusWithBriefRetry(orderId);
  const retryOutcome = status ? getRetryOutcome(status.status) : undefined;

  if (retryOutcome) {
    return NextResponse.redirect(
      new URL(
        getCheckoutPaymentRetryRedirectPath({
          locale,
          orderId,
          outcome: retryOutcome,
          searchParams: rawSearchParams,
        }),
        request.url
      )
    );
  }

  return NextResponse.redirect(
    new URL(getCheckoutStatusRedirectPath({ locale, orderId }), request.url)
  );
});

export const GET = defineWorkspaceRoute(
  {
    operation: "checkout.result.refresh",
    cancellation: "continue-after-disconnect",
  },
  (request, context: LocalizedCheckoutResultRouteContext) =>
    handleCheckoutResult(request, context).pipe(
      Effect.provide(CheckoutStatusServiceLiveWithDependencies),
      Effect.mapError(
        mapWorkspaceInternalRouteFailure(
          "Checkout status could not be refreshed"
        )
      )
    )
);
