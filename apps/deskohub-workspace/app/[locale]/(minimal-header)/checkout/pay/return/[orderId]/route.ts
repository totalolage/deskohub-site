import { Effect, Option, Ref, Schema } from "effect";
import { NextResponse } from "next/server";
import {
  appendVercelPreviewProtectionBypass,
  type CheckoutStatusReturnOutcome,
  CheckoutStatusService,
  CheckoutStatusServiceLiveWithDependencies,
} from "@/features/checkout/backend/checkout";
import { getParamsDecoder } from "@/features/i18n/server/route-params";
import { runWorkspace } from "@/shared/backend/logging/censorship";
import {
  getSearchParamsDecoder,
  type SearchParamsRecord,
} from "@/shared/utils";

export const maxDuration = 45;

type LocalizedCheckoutPayReturnRouteContext = {
  readonly params: Promise<{ locale: string; orderId: string }>;
};

const decodeCheckoutPayReturnParams = getParamsDecoder({
  orderId: Schema.NonEmptyString,
});

const decodeCheckoutPayReturnSearchParams = getSearchParamsDecoder(
  Schema.Struct({
    outcome: Schema.Literals(["success", "cancelled"]),
  })
);

const loadCheckoutStatusEffect = (
  orderId: string,
  returnOutcome: CheckoutStatusReturnOutcome
) =>
  Effect.gen(function* () {
    const service = yield* CheckoutStatusService;
    return yield* service.refreshStatus({
      orderId,
      returnOutcome,
    });
  });

const loadCheckoutStatusAttempt = (
  orderId: string,
  returnOutcome: CheckoutStatusReturnOutcome,
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

    return yield* loadCheckoutStatusEffect(orderId, returnOutcome).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Checkout status refresh retry failed", {
          orderId,
          returnOutcome,
          attempt,
          cause,
        }).pipe(Effect.as(undefined))
      )
    );
  });

const loadCheckoutStatusWithBriefRetry = async (
  orderId: string,
  returnOutcome: CheckoutStatusReturnOutcome
) => {
  const status = Effect.gen(function* () {
    const attempts = yield* Ref.make(0);
    return yield* loadCheckoutStatusAttempt(
      orderId,
      returnOutcome,
      attempts
    ).pipe(
      Effect.repeat({
        times: 3,
        while: (attemptStatus) =>
          !attemptStatus ||
          attemptStatus.status === "created" ||
          attemptStatus.status === "pending",
      })
    );
  }).pipe(
    Effect.provide(CheckoutStatusServiceLiveWithDependencies),
    runWorkspace
  );

  return status;
};

const getCheckoutStatusRedirectPath = (input: {
  readonly locale: string;
  readonly orderId: string;
  readonly outcome: CheckoutStatusReturnOutcome;
}) => {
  const url = new URL(
    `/${input.locale}/reservation/status/${input.orderId}`,
    "https://deskohub.local"
  );
  if (input.outcome !== "unknown")
    url.searchParams.set("outcome", input.outcome);
  appendVercelPreviewProtectionBypass(url, { setBypassCookie: true });

  return `${url.pathname}${url.search}`;
};

const getSearchParamsRecord = (url: URL): SearchParamsRecord =>
  Object.fromEntries(url.searchParams);

export async function GET(
  request: Request,
  { params }: LocalizedCheckoutPayReturnRouteContext
): Promise<NextResponse> {
  const decodedParams = decodeCheckoutPayReturnParams(await params);
  const routeParams = Option.getOrUndefined(decodedParams);
  if (!routeParams) return new NextResponse(null, { status: 404 });

  const { locale, orderId } = routeParams;
  const rawSearchParams = getSearchParamsRecord(new URL(request.url));
  const { outcome } = Option.getOrElse(
    decodeCheckoutPayReturnSearchParams(rawSearchParams),
    () => ({ outcome: "unknown" as const })
  );
  await loadCheckoutStatusWithBriefRetry(orderId, outcome);

  return NextResponse.redirect(
    new URL(
      getCheckoutStatusRedirectPath({ locale, orderId, outcome }),
      request.url
    )
  );
}
