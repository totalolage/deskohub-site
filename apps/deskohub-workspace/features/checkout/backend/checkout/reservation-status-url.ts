import type { Locale } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { reservationStatusPath } from "@/features/reservation/routes";
import type { CheckoutStatusReturnOutcome } from "./checkout-status.service";
import { appendVercelPreviewProtectionBypass } from "./vercel-preview-protection-bypass";

export const getReservationStatusPath = (input: {
  readonly locale: Locale | string;
  readonly orderId: WorkspaceReservationId;
  readonly outcome?: CheckoutStatusReturnOutcome;
  readonly statusToken?: string;
  readonly setBypassCookie?: boolean;
  readonly skipPreviewProtectionBypass?: boolean;
}) => {
  const url = new URL(
    `/${input.locale}${reservationStatusPath}/${input.orderId}`,
    "https://deskohub.local"
  );
  if (input.outcome && input.outcome !== "unknown") {
    url.searchParams.set("outcome", input.outcome);
  }
  if (input.statusToken) url.searchParams.set("statusToken", input.statusToken);
  if (!input.skipPreviewProtectionBypass) {
    appendVercelPreviewProtectionBypass(url, {
      setBypassCookie: input.setBypassCookie,
    });
  }

  return `${url.pathname}${url.search}`;
};
