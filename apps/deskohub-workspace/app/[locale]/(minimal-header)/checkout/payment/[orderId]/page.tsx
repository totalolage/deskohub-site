import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Effect, Array as EffectArray, Either, Layer, Schema } from "effect";
import {
  type CheckoutStatusReturnOutcome,
  CheckoutStatusService,
  CheckoutStatusServiceLiveWithDependencies,
} from "@/features/checkout/backend/checkout-status.service";
import { appendVercelPreviewProtectionBypass } from "@/features/checkout/backend/vercel-preview-protection-bypass";
import { isLocale, locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";
import {
  getWorkspaceLocalizedCanonicalUrl,
  workspaceSiteConstants,
} from "@/shared/utils";

export const dynamic = "force-dynamic";

type LocalizedCheckoutPaymentPageProps = {
  params: Promise<{ locale: string; orderId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const checkoutStatusLayer = CheckoutStatusServiceLiveWithDependencies.pipe(
  Layer.orDie
);

const CheckoutPaymentSearchParamsSchema = Schema.transform(
  Schema.Record({
    key: Schema.String,
    value: Schema.UndefinedOr(
      Schema.Union(Schema.String, Schema.Array(Schema.String))
    ),
  }),
  Schema.Struct({
    outcome: Schema.Literal("success", "cancelled", "unknown"),
  }),
  {
    strict: true,
    decode: (searchParams) => {
      const outcome = EffectArray.ensure(searchParams.outcome)[0];
      const normalizedOutcome: CheckoutStatusReturnOutcome =
        outcome === "success" || outcome === "cancelled" ? outcome : "unknown";

      return { outcome: normalizedOutcome };
    },
    encode: ({ outcome }) => ({ outcome }),
  }
);

const decodeCheckoutPaymentSearchParams = Schema.decodeUnknownEither(
  CheckoutPaymentSearchParamsSchema
);

const recordProviderReturn = (
  orderId: string,
  returnOutcome: CheckoutStatusReturnOutcome
) =>
  Effect.gen(function* () {
    const service = yield* CheckoutStatusService;
    return yield* service.recordProviderReturn({ orderId, returnOutcome });
  }).pipe(Effect.provide(checkoutStatusLayer), runWorkspaceEffect);

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

  const { outcome } = Either.getOrElse(
    decodeCheckoutPaymentSearchParams(await searchParams),
    () => ({ outcome: "unknown" as const })
  );

  await recordProviderReturn(orderId, outcome).catch(() => undefined);
  redirect(getCheckoutStatusRedirectPath({ locale, orderId, outcome }));
}
