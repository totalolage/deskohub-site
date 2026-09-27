import type {
  AdvertisedPriceRequest,
  CoworkAdvertisedPriceRequest,
} from "@/features/checkout/advertised-price";
import type { WorkspaceProductMonitorOption } from "@/features/checkout/product-catalog";
import type { CanonicalPromotionCode } from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import { getCoworkAdvertisedPriceReservation } from "@/features/reservation/cowork-reservation";
import type { WorkspaceCoworkSaleableTier } from "@/features/checkout/product-catalog";

export type CoworkAdvertisedPriceOfferSelection = {
  readonly entryTier: WorkspaceCoworkSaleableTier;
  readonly coffee: boolean;
  readonly monitorOption?: WorkspaceProductMonitorOption;
};

export const getCoworkTierAdvertisedPriceRequests = ({
  date,
  locale,
  offers,
  submittedCode,
}: {
  readonly date: string;
  readonly locale: Locale;
  readonly offers: ReadonlyArray<CoworkAdvertisedPriceOfferSelection>;
  readonly submittedCode?: CanonicalPromotionCode;
}): ReadonlyArray<CoworkAdvertisedPriceRequest> =>
  offers.map((offer) => ({
    locale,
    ...(submittedCode && { submittedCode }),
    reservation: getCoworkAdvertisedPriceReservation({
      entryTier: offer.entryTier,
      coffee: offer.coffee,
      ...(offer.monitorOption !== undefined && {
        monitorOption: offer.monitorOption,
      }),
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
  readonly tier: WorkspaceCoworkSaleableTier;
}): AdvertisedPriceRequest => ({
  locale,
  ...(submittedCode && { submittedCode }),
  reservation: getCoworkAdvertisedPriceReservation({
    entryTier: tier,
    coffee: true,
    date,
  }),
});
