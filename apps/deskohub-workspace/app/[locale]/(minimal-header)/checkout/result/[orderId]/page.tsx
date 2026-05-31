import { Effect, Either, Layer, Schema } from "effect";
import { notFound, redirect } from "next/navigation";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import {
  CheckoutStatusService,
  CheckoutStatusServiceLiveWithDependencies,
  type CheckoutStatusViewModel,
} from "@/features/checkout/backend/checkout-status.service";
import { appendVercelPreviewProtectionBypass } from "@/features/checkout/backend/vercel-preview-protection-bypass";
import { appendExistingCheckoutReturnStateToken } from "@/features/checkout/schemas/checkout-return-state-token";
import { locales } from "@/features/i18n";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";
import { getSearchParam } from "@/shared/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

type CheckoutResultSearchParams = Record<string, string | string[] | undefined>;

type LocalizedCheckoutResultPageProps = {
  params: Promise<{ locale: string; orderId: string }>;
  searchParams: Promise<CheckoutResultSearchParams>;
};

const checkoutStatusLayer = CheckoutStatusServiceLiveWithDependencies.pipe(
  Layer.provide(WorkspaceDatabaseLive),
  Layer.orDie
);

const CheckoutResultRouteParamsSchema = Schema.Struct({
  locale: Schema.Literal(...locales),
  orderId: Schema.NonEmptyString,
});

const decodeCheckoutResultParams = Schema.decodeUnknownEither(
  CheckoutResultRouteParamsSchema
);

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const loadProviderReturnStatus = (orderId: string) =>
  Effect.gen(function* () {
    const service = yield* CheckoutStatusService;
    return yield* service.recordProviderReturn({
      orderId,
      returnOutcome: "unknown",
    });
  }).pipe(Effect.provide(checkoutStatusLayer), runWorkspaceEffect);

const loadProviderReturnStatusWithBriefRetry = async (orderId: string) => {
  let status: CheckoutStatusViewModel | undefined;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    status = await loadProviderReturnStatus(orderId).catch(() => undefined);
    if (status && status.status !== "created" && status.status !== "pending") {
      return status;
    }

    if (attempt < 3) await sleep(1500);
  }

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
  readonly searchParams: CheckoutResultSearchParams;
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

const getCheckoutOrderRedirectPath = (input: {
  readonly locale: string;
  readonly orderId: string;
  readonly searchParams: CheckoutResultSearchParams;
}) => {
  const url = new URL(
    `/${input.locale}/checkout/order`,
    "https://deskohub.local"
  );
  url.searchParams.set("paymentOrderId", input.orderId);
  appendExistingCheckoutReturnStateToken(url, input.searchParams);
  appendVercelPreviewProtectionBypass(url, { setBypassCookie: true });

  const paymentId = getSearchParam(input.searchParams, "paymentid");
  if (paymentId) {
    url.searchParams.set("paymentid", paymentId);
  }

  return `${url.pathname}${url.search}`;
};

export default async function LocalizedCheckoutResultPage({
  params,
  searchParams,
}: LocalizedCheckoutResultPageProps) {
  const decodedParams = decodeCheckoutResultParams(await params);
  if (Either.isLeft(decodedParams)) notFound();

  const { locale, orderId } = decodedParams.right;
  const rawSearchParams = await searchParams;
  const status = await loadProviderReturnStatusWithBriefRetry(orderId);
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
    getCheckoutOrderRedirectPath({
      locale,
      orderId,
      searchParams: rawSearchParams,
    })
  );
}
