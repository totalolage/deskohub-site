import type { WorkspaceCoworkProductTier } from "@/features/checkout/product-catalog";
import {
  getWorkspaceMeetingRoomProductTitle,
  getWorkspaceOfficeProductTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import type { Locale } from "@/features/i18n";
import type { StoredWorkspaceReservationDetails } from "@/features/reservation/persistence-contracts";

/** The product a reservation booked, as the customer catalog names it. */
export type AdministrationReservationProduct =
  | { readonly kind: "cowork"; readonly tier: WorkspaceCoworkProductTier }
  | { readonly kind: "meeting-room" }
  | { readonly kind: "office" };

export const getAdministrationReservationProduct = (
  details: StoredWorkspaceReservationDetails
): AdministrationReservationProduct =>
  details.kind === "cowork"
    ? { kind: "cowork", tier: details.entryTier }
    : { kind: details.kind };

/** Product names are customer-facing, so they come from the customer catalog. */
export const getAdministrationReservationProductTitle = (
  product: AdministrationReservationProduct,
  locale: Locale
) => {
  if (product.kind === "meeting-room") {
    return getWorkspaceMeetingRoomProductTitle(locale);
  }
  if (product.kind === "office") return getWorkspaceOfficeProductTitle(locale);
  return getWorkspaceProductTierTitle(product.tier, locale);
};
