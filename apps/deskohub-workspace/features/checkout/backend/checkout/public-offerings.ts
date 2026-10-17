import { Effect, Option } from "effect";
import {
  getPublicOfferings,
  type PublicOfficeOffer,
} from "@/features/checkout/public-offerings";
import type { Locale } from "@/features/i18n";
import { loadAdvisoryOfficeSeatCapacity } from "@/features/office/backend/office-reservation-capacity";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";

/**
 * The public offerings with what only the server knows: whether office
 * reservations are open and, from the shared table snapshot, how many seats
 * the office has.
 */
export const loadPublicOfferings = Effect.fn("publicOfferings.load")(function* (
  locale: Locale
) {
  const officeFlag = yield* OfficeReservationFeatureFlagService;
  const office = yield* loadPublicOfficeOffer.pipe(
    Effect.when(officeFlag.isEnabled)
  );

  return getPublicOfferings({
    locale,
    ...Option.match(office, {
      onNone: () => ({}),
      onSome: (offer) => ({ office: offer }),
    }),
  });
});

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
