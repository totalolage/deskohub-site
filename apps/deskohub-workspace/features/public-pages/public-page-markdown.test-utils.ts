import {
  getPublicCatalogOfferings,
  type PublicOffering,
} from "@/features/checkout/public-offerings";
import { workspaceMoneyWithValue } from "@/features/checkout/workspace-money";
import type { Locale } from "@/features/i18n";

/** Every bookable product advertised at its catalog price, without a sale. */
export const catalogPricedOfferings = (
  locale: Locale,
  { officeOpen }: { readonly officeOpen: boolean }
): ReadonlyArray<PublicOffering> =>
  getPublicCatalogOfferings({
    locale,
    ...(officeOpen && { office: {} }),
  }).map((offering) => ({
    ...offering,
    advertisedPrice: {
      price: offering.price,
      discount: workspaceMoneyWithValue(0, offering.price),
    },
  }));
