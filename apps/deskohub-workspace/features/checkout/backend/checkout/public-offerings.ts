import { Effect, Option } from "effect";
import {
  getPublicOfferingAdvertisedPrice,
  getPublicOfferingListings,
  type PublicOffering,
  type PublicOfferingListing,
  type PublicOfficeOffer,
  type PublicPriceListOffering,
} from "@/features/checkout/public-offerings";
import type { Locale } from "@/features/i18n";
import { loadAdvisoryOfficeSeatCapacity } from "@/features/office/backend/office-advisory-seat-capacity";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";
import { pagePreloadDeadline } from "@/features/reservation/backend/page-preload";
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
    loadOfferings(
      locale,
      whenOfficeOpen(loadPublicOfficeOffer),
      advertisePublicOffering
    ).pipe(
      Effect.map(({ advertisedOn, offerings: advertised }) => ({
        advertisedOn,
        offerings: advertised.map(({ offering }) => offering),
        complete: advertised.every(({ complete }) => complete),
      }))
    )
);

/**
 * The public offerings for a page that must render without its quotes, such
 * as the price list. An offering whose advertised price fails or misses the
 * reservation pages' preload deadline keeps only its catalog price, and
 * `complete` turns false. The office keeps its release gate but not its seat
 * maximum, so the list never reads the availability inventory.
 */
export const loadPublicPriceList = Effect.fn("publicOfferings.loadPriceList")(
  (locale: Locale) =>
    loadOfferings(
      locale,
      whenOfficeOpen(Effect.succeed<PublicOfficeOffer>({})),
      advertiseOrKeepCatalogPrice
    ).pipe(
      Effect.map(({ advertisedOn, offerings: advertised }) => ({
        advertisedOn,
        offerings: advertised.map(({ offering }) => offering),
        complete: advertised.every(({ complete }) => complete),
      }))
    )
);

const loadOfferings = <A, E, R, OE, OR>(
  locale: Locale,
  loadOffice: Effect.Effect<Option.Option<PublicOfficeOffer>, OE, OR>,
  advertise: (listing: PublicOfferingListing) => Effect.Effect<A, E, R>
) =>
  Effect.Do.pipe(
    Effect.bind("advertisedOn", () =>
      currentInstant.pipe(Effect.map(getCurrentWorkspaceDate))
    ),
    Effect.bind("office", () => loadOffice),
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
    Effect.bind("offerings", ({ listings }) =>
      Effect.forEach(listings, advertise, { concurrency: "inherit" })
    ),
    Effect.map(({ advertisedOn, offerings }) => ({ advertisedOn, offerings }))
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

/** The office offer, loaded only while office reservations are open. */
const whenOfficeOpen = <E, R>(offer: Effect.Effect<PublicOfficeOffer, E, R>) =>
  OfficeReservationFeatureFlagService.pipe(
    Effect.flatMap((officeFlag) =>
      offer.pipe(Effect.when(officeFlag.isEnabled))
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
        advertisedPrice: getPublicOfferingAdvertisedPrice(payment),
      } satisfies PublicOffering,
      complete: discountsComplete,
    }))
  );

const advertiseOrKeepCatalogPrice = (listing: PublicOfferingListing) =>
  advertisePublicOffering(listing).pipe(
    Effect.map(
      ({
        offering,
        complete,
      }): { offering: PublicPriceListOffering; complete: boolean } => ({
        offering,
        complete,
      })
    ),
    Effect.timeout(pagePreloadDeadline),
    Effect.catchCause((cause) =>
      Effect.logWarning(
        "Advertised price is unavailable; the price list keeps the catalog price",
        { cause, kind: listing.offering.kind }
      ).pipe(Effect.as({ offering: listing.offering, complete: false }))
    )
  );
