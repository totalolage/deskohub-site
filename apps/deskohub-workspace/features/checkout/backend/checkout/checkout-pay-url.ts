import type { Locale } from "@/features/i18n";
import {
  type BuildSignedPayStateInput,
  buildPayUrl,
  buildSignedPayState,
  type PayStateCryptoOptions,
  type SealPayStateForUrlResult,
  type SignedPayState,
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

  return `${payUrl.url.pathname}${payUrl.url.search}`;
};

export const buildFreshCheckoutPayPath = (
  input: BuildSignedPayStateInput,
  options: PayStateCryptoOptions = {}
) => {
  const freshState = buildSignedPayState(input, options);
  const sealedState = sealPayStateForUrl(freshState, options);
  return buildCheckoutPayPath(input.locale, sealedState);
};

export const buildReviewedCheckoutPayPath = (
  state: SignedPayState,
  options: PayStateCryptoOptions = {}
) =>
  buildFreshCheckoutPayPath(
    {
      locale: state.locale,
      reservation: state.reservation,
      quote: state.quote,
      orderId: state.orderId,
      submittedCode: state.submittedCode,
    },
    options
  );
