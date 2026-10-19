import { Effect, Option } from "effect";
import {
  getPublicOfferingListings,
  type PublicOffering,
  type PublicOfferingListing,
  type PublicOfficeOffer,
} from "@/features/checkout/public-offerings";
import { getReservationQuoteDiscount } from "@/features/checkout/reservation-quote-schema";
import type { Locale } from "@/features/i18n";
import { loadAdvisoryOfficeSeatCapacity } from "@/features/office/backend/office-advisory-seat-capacity";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { currentInstant } from "@/shared/utils/temporal";
import { CheckoutPricingService } from "./checkout-pricing.service";

/**
 * The public offerings with what only the server knows: whether office
 * reservations are open, how many seats the shared table snapshot gives the
 * office, and each offering's price as the reservation pages advertise it
 * today. Advertised prices read only the anonymous, cached Calendar sales;
 * `complete` is false when a sale source could not answer, so the prices are
 * right for this request but not to share.
 */
export const loadPublicOfferings = Effect.fn("publicOfferings.load")(
  (locale: Locale) =>
    Effect.Do.pipe(
      Effect.bind("advertisedOn", () =>
        currentInstant.pipe(Effect.map(getCurrentWorkspaceDate))
      ),
      Effect.bind("office", () => loadOpenPublicOfficeOffer),
      Effect.let("listings", ({ advertisedOn, office }) =>
        getPublicOfferingListings({
          date: advertisedOn,
          locale,
          ...Option.match(office, {
            onNone: () => ({}),
            onSome: (offer) => ({ office: offer }),
          }),
        })
      ),
      Effect.bind("advertised", ({ listings }) =>
        Effect.forEach(listings, advertisePublicOffering, {
          concurrency: "inherit",
        })
      ),
      Effect.map(({ advertisedOn, advertised }) => ({
        advertisedOn,
        offerings: advertised.map(({ offering }) => offering),
        complete: advertised.every(({ complete }) => complete),
      }))
    )
);

/** A capacity read failure only omits the seat maximum. */
const loadPublicOfficeOffer = loadAdvisoryOfficeSeatCapacity.pipe(
  Effect.map((maximumSeats): PublicOfficeOffer => ({ maximumSeats })),
  Effect.tapError((cause) =>
    Effect.logWarning(
      "Office seat capacity is unavailable for the public offerings",
      { cause }
    )
  ),
  Effect.orElseSucceed((): PublicOfficeOffer => ({}))
);

const loadOpenPublicOfficeOffer = OfficeReservationFeatureFlagService.pipe(
  Effect.flatMap((officeFlag) =>
    loadPublicOfficeOffer.pipe(Effect.when(officeFlag.isEnabled))
  )
);

const advertisePublicOffering = ({
  offering,
  advertisedPriceRequest,
}: PublicOfferingListing) =>
  CheckoutPricingService.pipe(
    Effect.flatMap((pricing) =>
      pricing.quoteAdvertisement(advertisedPriceRequest)
    ),
    Effect.map(({ quote: { payment }, discountsComplete }) => ({
      offering: {
        ...offering,
        advertisedPrice: {
          price: payment.expectedPrice,
          discount: getReservationQuoteDiscount(payment),
        },
      } satisfies PublicOffering,
      complete: discountsComplete,
    }))
  );
