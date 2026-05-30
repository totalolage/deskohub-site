import { Effect, Array as EffectArray, Either, Layer, Schema } from "effect";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import {
  type CheckoutStatusReturnOutcome,
  CheckoutStatusService,
  CheckoutStatusServiceLiveWithDependencies,
  type CheckoutStatusViewModel,
} from "@/features/checkout/backend/checkout-status.service";
import { appendVercelPreviewProtectionBypass } from "@/features/checkout/backend/vercel-preview-protection-bypass";
import { CheckoutStatusPage } from "@/features/checkout/components/checkout-status-page";
import {
  appendExistingCheckoutReturnStateToken,
  getCheckoutReturnStateTokenFromSearchParams,
} from "@/features/checkout/schemas/checkout-return-state-token";
import { locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";
import {
  getWorkspaceLocalizedCanonicalUrl,
  workspaceSiteConstants,
} from "@/shared/utils";

export const dynamic = "force-dynamic";

type CheckoutStatusSearchParams = Record<string, string | string[] | undefined>;

type LocalizedCheckoutStatusPageProps = {
  params: Promise<{ locale: string; orderId: string }>;
  searchParams: Promise<CheckoutStatusSearchParams>;
};

const checkoutStatusLayer = CheckoutStatusServiceLiveWithDependencies.pipe(
  Layer.provide(WorkspaceDatabaseLive),
  Layer.orDie
);

const CheckoutStatusRouteParamsSchema = Schema.Struct({
  locale: Schema.Literal(...locales),
  orderId: Schema.NonEmptyString,
});

const NextSearchParamsSchema = Schema.Record({
  key: Schema.String,
  value: Schema.UndefinedOr(
    Schema.Union(Schema.String, Schema.Array(Schema.String))
  ),
});

const CheckoutStatusSearchParamsSchema = Schema.transform(
  NextSearchParamsSchema,
  Schema.Struct({
    outcome: Schema.Literal("success", "cancelled", "unknown"),
  }),
  {
    strict: true,
    decode: (searchParams) => {
      const outcome = EffectArray.ensure(searchParams.outcome)[0];
      const normalizedOutcome: CheckoutStatusReturnOutcome =
        outcome === "success" || outcome === "cancelled" ? outcome : "unknown";

      return {
        outcome: normalizedOutcome,
      };
    },
    encode: ({ outcome }) => ({ outcome }),
  }
);

const decodeCheckoutStatusParams = Schema.decodeUnknownEither(
  CheckoutStatusRouteParamsSchema
);

const decodeCheckoutStatusSearchParams = Schema.decodeUnknownEither(
  CheckoutStatusSearchParamsSchema
);

const loadCheckoutStatus = (
  orderId: string,
  returnOutcome: CheckoutStatusReturnOutcome
) =>
  Effect.gen(function* () {
    const service = yield* CheckoutStatusService;
    return yield* service.getStatus({ orderId, returnOutcome });
  }).pipe(Effect.provide(checkoutStatusLayer), runWorkspaceEffect);

const getFallbackStatus = (
  orderId: string,
  returnOutcome: CheckoutStatusReturnOutcome
): CheckoutStatusViewModel => ({
  orderId,
  returnOutcome,
  status: "not_found",
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
  readonly searchParams: CheckoutStatusSearchParams;
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

export async function generateMetadata({
  params,
}: LocalizedCheckoutStatusPageProps): Promise<Metadata> {
  const decodedParams = decodeCheckoutStatusParams(await params);
  if (Either.isLeft(decodedParams)) notFound();

  const { locale, orderId } = decodedParams.right;

  return runWithRequestLocale(locale, () => {
    const title = m.checkoutStatusMetadataTitle({}, { locale });
    const description = m.checkoutStatusMetadataDescription({}, { locale });
    const url = getWorkspaceLocalizedCanonicalUrl(
      locale,
      `/checkout/status/${orderId}`
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
              `/checkout/status/${orderId}`
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

export default async function LocalizedCheckoutStatusPage({
  params,
  searchParams,
}: LocalizedCheckoutStatusPageProps) {
  const decodedParams = decodeCheckoutStatusParams(await params);
  if (Either.isLeft(decodedParams)) notFound();

  const { locale, orderId } = decodedParams.right;

  const rawSearchParams = await searchParams;
  const { outcome: returnOutcome } = Either.getOrElse(
    decodeCheckoutStatusSearchParams(rawSearchParams),
    () => ({ outcome: "unknown" as const })
  );
  const status = await loadCheckoutStatus(orderId, returnOutcome).catch(() =>
    getFallbackStatus(orderId, returnOutcome)
  );
  const retryOutcome = getRetryOutcome(status.status);

  if (
    retryOutcome &&
    getCheckoutReturnStateTokenFromSearchParams(rawSearchParams)
  ) {
    redirect(
      getCheckoutPaymentRetryRedirectPath({
        locale,
        orderId,
        outcome: retryOutcome,
        searchParams: rawSearchParams,
      })
    );
  }

  return runWithRequestLocale(locale, () => (
    <CheckoutStatusPage locale={locale} status={status} />
  ));
}
