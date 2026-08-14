import { appendVercelPreviewProtectionBypass } from "@/features/checkout/backend/checkout/vercel-preview-protection-bypass";
import type { Locale } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  type ReservationAccessToken,
  reservationAccessTokenQueryParam,
} from "@/features/reservation/reservation-access-token";

export type ProtectedReservationPathInput = {
  readonly locale: Locale | string;
  readonly orderId: WorkspaceReservationId;
  readonly accessToken: ReservationAccessToken;
  readonly setBypassCookie?: boolean;
};

export const getProtectedReservationPath = (
  reservationPath: string,
  input: ProtectedReservationPathInput
) => {
  const url = new URL(
    `/${input.locale}${reservationPath}/${input.orderId}`,
    "https://deskohub.local"
  );
  url.searchParams.set(reservationAccessTokenQueryParam, input.accessToken);
  appendVercelPreviewProtectionBypass(url, {
    setBypassCookie: input.setBypassCookie,
  });

  return `${url.pathname}${url.search}`;
};
