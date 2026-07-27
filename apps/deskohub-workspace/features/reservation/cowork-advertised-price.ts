import type { AdvertisedPriceRequest } from "@/features/checkout/advertised-price";
import {
  type WorkspaceCoworkProductTier,
  workspaceCoworkProductCatalog,
} from "@/features/checkout/product-catalog";
import type { Locale } from "@/features/i18n";
import { getCoworkAdvertisedPriceReservation } from "@/features/reservation/cowork-reservation";

export type CoworkTierAdvertisedPriceRequest = {
  readonly tier: WorkspaceCoworkProductTier;
  readonly request: AdvertisedPriceRequest;
};

export const getCoworkTierAdvertisedPriceRequests = ({
  coffee,
  date,
  locale,
}: {
  readonly coffee: boolean;
  readonly date: string;
  readonly locale: Locale;
}): ReadonlyArray<CoworkTierAdvertisedPriceRequest> =>
  workspaceCoworkProductCatalog.map(({ tier }) => ({
    tier,
    request: {
      locale,
      reservation: getCoworkAdvertisedPriceReservation({
        entryTier: tier,
        coffee,
        date,
      }),
    },
  }));
