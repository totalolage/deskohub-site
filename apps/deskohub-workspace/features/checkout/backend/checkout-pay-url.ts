import type { Locale } from "@/features/i18n";
import {
  type BuildSignedPayStateInput,
  buildPayUrl,
  buildSignedPayState,
  type SealPayStateForUrlResult,
  sealPayStateForUrl,
} from "./pay-state";

export const getCheckoutPayBaseUrl = (locale: Locale) =>
  new URL(`/${locale}/checkout/pay`, "https://deskohub.local");

export const buildCheckoutPayUrl = (
  locale: Locale,
  sealedState: SealPayStateForUrlResult
) => buildPayUrl(getCheckoutPayBaseUrl(locale), sealedState);

export const buildCheckoutPayPath = (
  locale: Locale,
  sealedState: SealPayStateForUrlResult
) => {
  const payUrl = buildCheckoutPayUrl(locale, sealedState);
  if (payUrl.type !== "payUrl") return payUrl;

  return {
    type: "payPath" as const,
    path: `${payUrl.url.pathname}${payUrl.url.search}`,
  };
};

export const buildFreshCheckoutPayPath = (input: BuildSignedPayStateInput) => {
  const freshState = buildSignedPayState(input);
  const sealedState = sealPayStateForUrl(freshState);
  const payUrl = buildCheckoutPayPath(input.locale, sealedState);

  if (payUrl.type !== "payPath") return undefined;
  return payUrl.path;
};
