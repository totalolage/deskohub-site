import { Effect, Option, Ref, Schema } from "effect";
import { notFound, redirect } from "next/navigation";
import {
  CheckoutStatusService,
  CheckoutStatusServiceLiveWithDependencies,
  type CheckoutStatusViewModel,
} from "@/features/checkout/backend/checkout-status.service";
import { appendVercelPreviewProtectionBypass } from "@/features/checkout/backend/vercel-preview-protection-bypass";
import { appendExistingCheckoutReturnStateToken } from "@/features/checkout/schemas/checkout-return-state-token";
import { getParamsDecoder } from "@/features/i18n/server/route-params";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";
import type { SearchParamsRecord } from "@/shared/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

type LocalizedCheckoutResultPageProps = {
  params: Promise<{ locale: string; orderId: string }>;
  searchParams: Promise<SearchParamsRecord>;
};

const decodeCheckoutResultParams = getParamsDecoder({
  orderId: Schema.NonEmptyString,
});

const loadCheckoutStatusEffect = (orderId: string) =>
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
    if (attempt > 1) yield* Effect.sleep("1500 millis");

    return yield* loadCheckoutStatusEffect(orderId).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Checkout status refresh retry failed", {
          orderId,
          attempt,
          cause,
        }).pipe(Effect.as(undefined))
      )
    );
  });

const loadCheckoutStatusWithBriefRetry = async (orderId: string) => {
  const status = Effect.gen(function* () {
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
  }).pipe(
    Effect.provide(CheckoutStatusServiceLiveWithDependencies),
    runWorkspaceEffect
  );

  return status;
};

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

export default async function LocalizedCheckoutResultPage({
  params,
  searchParams,
}: LocalizedCheckoutResultPageProps) {
  const decodedParams = decodeCheckoutResultParams(await params);
  const { locale, orderId } = Option.getOrElse(decodedParams, () => notFound());
  const rawSearchParams = await searchParams;
  const status = await loadCheckoutStatusWithBriefRetry(orderId);
  const retryOutcome = status ? getRetryOutcome(status.status) : undefined;

  if (retryOutcome) {
    redirect(
      getCheckoutPaymentRetryRedirectPath({
        locale,
        orderId,
        outcome: retryOutcome,
        searchParams: rawSearchParams,
      })
    );
  }

  redirect(
    getCheckoutStatusRedirectPath({
      locale,
      orderId,
    })
  );
}
