import type {
  AdvertisedPriceRequest,
  CoworkAdvertisedPriceRequest,
} from "@/features/checkout/advertised-price";
import {
  type WorkspaceCoworkProductTier,
  workspaceCoworkProductTiers,
} from "@/features/checkout/product-catalog";
import type { Locale } from "@/features/i18n";
import { getCoworkAdvertisedPriceReservation } from "@/features/reservation/cowork-reservation";

export const getCoworkTierAdvertisedPriceRequests = ({
  coffee,
  date,
  locale,
}: {
  readonly coffee: boolean;
  readonly date: string;
  readonly locale: Locale;
}): ReadonlyArray<CoworkAdvertisedPriceRequest> =>
  workspaceCoworkProductTiers.map((tier) => ({
    locale,
    reservation: getCoworkAdvertisedPriceReservation({
      entryTier: tier,
      coffee,
      date,
    }),
  }));

export const getCoworkCoffeeAdvertisedPriceRequest = ({
  date,
  locale,
  tier,
}: {
  readonly date: string;
  readonly locale: Locale;
  readonly tier: WorkspaceCoworkProductTier;
}): AdvertisedPriceRequest => ({
  locale,
  reservation: getCoworkAdvertisedPriceReservation({
    entryTier: tier,
    coffee: true,
    date,
  }),
});
