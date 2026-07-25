import type { Locale } from "@/features/i18n";
import type { CheckoutStatusReturnOutcome } from "./checkout-status.service";
import { appendVercelPreviewProtectionBypass } from "./vercel-preview-protection-bypass";

export const getCheckoutStatusPath = (input: {
  readonly locale: Locale | string;
  readonly orderId: string;
  readonly outcome?: CheckoutStatusReturnOutcome;
  readonly setBypassCookie?: boolean;
}) => {
  const url = new URL(
    `/${input.locale}/checkout/status/${input.orderId}`,
    "https://deskohub.local"
  );
  if (input.outcome) {
    url.searchParams.set("outcome", input.outcome);
  }
  appendVercelPreviewProtectionBypass(url, {
    setBypassCookie: input.setBypassCookie,
  });

  return `${url.pathname}${url.search}`;
};
