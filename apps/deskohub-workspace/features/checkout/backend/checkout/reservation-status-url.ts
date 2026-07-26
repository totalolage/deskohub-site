import type { Locale } from "@/features/i18n";
import { reservationStatusPath } from "@/features/reservation/routes";
import type { CheckoutStatusReturnOutcome } from "./checkout-status.service";
import { appendVercelPreviewProtectionBypass } from "./vercel-preview-protection-bypass";

export const getReservationStatusPath = (input: {
  readonly locale: Locale | string;
  readonly orderId: string;
  readonly outcome?: CheckoutStatusReturnOutcome;
  readonly setBypassCookie?: boolean;
}) => {
  const url = new URL(
    `/${input.locale}${reservationStatusPath}/${input.orderId}`,
    "https://deskohub.local"
  );
  if (input.outcome && input.outcome !== "unknown") {
    url.searchParams.set("outcome", input.outcome);
  }
  appendVercelPreviewProtectionBypass(url, {
    setBypassCookie: input.setBypassCookie,
  });

  return `${url.pathname}${url.search}`;
};
