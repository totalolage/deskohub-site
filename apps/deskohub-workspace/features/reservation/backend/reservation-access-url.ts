import { appendVercelPreviewProtectionBypass } from "@/features/checkout/backend/checkout/vercel-preview-protection-bypass";
import type { Locale } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  reservationAccessPath,
  reservationInvoicePath,
} from "@/features/reservation/routes";
import { reservationAccessTokenQueryParam } from "./reservation-access-token";

export const getReservationAccessPath = (input: {
  readonly locale: Locale | string;
  readonly orderId: WorkspaceReservationId;
  readonly accessToken: string;
  readonly setBypassCookie?: boolean;
}) => {
  const url = new URL(
    `/${input.locale}${reservationAccessPath}/${input.orderId}`,
    "https://deskohub.local"
  );
  url.searchParams.set(reservationAccessTokenQueryParam, input.accessToken);
  appendVercelPreviewProtectionBypass(url, {
    setBypassCookie: input.setBypassCookie,
  });

  return `${url.pathname}${url.search}`;
};

export const getReservationInvoicePath = (
  input: Parameters<typeof getReservationAccessPath>[0]
) => {
  const accessPath = getReservationAccessPath(input);
  return accessPath.replace(reservationAccessPath, reservationInvoicePath);
};
