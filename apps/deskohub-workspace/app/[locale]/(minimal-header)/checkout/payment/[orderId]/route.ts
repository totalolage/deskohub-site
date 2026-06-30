import { Effect, Option, Schema } from "effect";
import { NextResponse } from "next/server";
import { refreshCheckoutStatus } from "@/features/checkout/backend/checkout-status.server";
import type { CheckoutStatusReturnOutcome } from "@/features/checkout/backend/checkout-status.service";
import { appendVercelPreviewProtectionBypass } from "@/features/checkout/backend/vercel-preview-protection-bypass";
import { getParamsDecoder } from "@/features/i18n/server/route-params";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";
import {
  getSearchParamsDecoder,
  type SearchParamsRecord,
} from "@/shared/utils";

type LocalizedCheckoutPaymentRouteContext = {
  readonly params: Promise<{ locale: string; orderId: string }>;
};

const decodeCheckoutPaymentParams = getParamsDecoder({
  orderId: Schema.NonEmptyString,
});

const decodeCheckoutPaymentSearchParams = getSearchParamsDecoder(
  Schema.Struct({
    outcome: Schema.Literals(["success", "cancelled"]),
  })
);

const refreshStatus = (
  orderId: string,
  returnOutcome: CheckoutStatusReturnOutcome
) => refreshCheckoutStatus({ orderId, returnOutcome });

const getCheckoutStatusRedirectPath = (input: {
  readonly locale: string;
  readonly orderId: string;
  readonly outcome: CheckoutStatusReturnOutcome;
}) => {
  const url = new URL(
    `/${input.locale}/checkout/status/${input.orderId}`,
    "https://deskohub.local"
  );
  url.searchParams.set("outcome", input.outcome);
  appendVercelPreviewProtectionBypass(url, { setBypassCookie: true });

  return `${url.pathname}${url.search}`;
};

const getSearchParamsRecord = (url: URL): SearchParamsRecord =>
  Object.fromEntries(url.searchParams);

export async function GET(
  request: Request,
  { params }: LocalizedCheckoutPaymentRouteContext
): Promise<NextResponse> {
  const decodedParams = decodeCheckoutPaymentParams(await params);
  const routeParams = Option.getOrUndefined(decodedParams);
  if (!routeParams) return new NextResponse(null, { status: 404 });

  const { locale, orderId } = routeParams;
  const { outcome } = Option.getOrElse(
    decodeCheckoutPaymentSearchParams(
      getSearchParamsRecord(new URL(request.url))
    ),
    () => ({ outcome: "unknown" as const })
  );

  await refreshStatus(orderId, outcome).catch(async (cause) => {
    await Effect.logError("Checkout payment return refresh failed", {
      orderId,
      outcome,
      cause,
    }).pipe(runWorkspaceEffect);
  });

  return NextResponse.redirect(
    new URL(
      getCheckoutStatusRedirectPath({ locale, orderId, outcome }),
      request.url
    )
  );
}
