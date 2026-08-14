import type {
  AdvertisedPriceRequest,
  CoworkAdvertisedPriceRequest,
} from "@/features/checkout/advertised-price";
import {
  type WorkspaceCoworkProductTier,
  workspaceCoworkProductTiers,
} from "@/features/checkout/product-catalog";
import type { CanonicalPromotionCode } from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import { getCoworkAdvertisedPriceReservation } from "@/features/reservation/cowork-reservation";

export const getCoworkTierAdvertisedPriceRequests = ({
  coffee,
  date,
  locale,
  submittedCode,
}: {
  readonly coffee: boolean;
  readonly date: string;
  readonly locale: Locale;
  readonly submittedCode?: CanonicalPromotionCode;
}): ReadonlyArray<CoworkAdvertisedPriceRequest> =>
  workspaceCoworkProductTiers.map((tier) => ({
    locale,
    submittedCode,
    reservation: getCoworkAdvertisedPriceReservation({
      entryTier: tier,
      coffee,
      date,
    }),
  }));

export const getCoworkCoffeeAdvertisedPriceRequest = ({
  date,
  locale,
  submittedCode,
  tier,
}: {
  readonly date: string;
  readonly locale: Locale;
  readonly submittedCode?: CanonicalPromotionCode;
  readonly tier: WorkspaceCoworkProductTier;
}): AdvertisedPriceRequest => ({
  locale,
  submittedCode,
  reservation: getCoworkAdvertisedPriceReservation({
    entryTier: tier,
    coffee: true,
    date,
  }),
});
