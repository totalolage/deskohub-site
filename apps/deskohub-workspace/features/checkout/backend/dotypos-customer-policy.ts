import { DotyposService, type FindCustomerResult } from "@deskohub/dotypos";
import { Data, Effect, Match } from "effect";
import type { ReservationOrderData } from "@/features/reservation/schemas/reservation";

export class AmbiguousDotyposCustomerError extends Data.TaggedError(
  "AmbiguousDotyposCustomerError"
)<{
  readonly message: string;
}> {}

export const splitCustomerName = (name: string) => {
  const [firstName = "", ...lastNameParts] = name.trim().split(/\s+/);
  return {
    firstName,
    lastName: lastNameParts.join(" ") || undefined,
  };
};

export const failClosedOnAmbiguousDotyposCustomer = (
  lookup: FindCustomerResult
) =>
  Match.value(lookup).pipe(
    Match.tag("Ambiguous", (ambiguousLookup) =>
      Effect.gen(function* () {
        const matches = ambiguousLookup.matches ?? [];
        yield* Effect.logError("Ambiguous Dotypos customer lookup", {
          customerIds: matches.map((customer) => customer.id),
          matchCount: matches.length,
        });

        return yield* Effect.fail(
          new AmbiguousDotyposCustomerError({
            message:
              "Customer discount could not be confirmed. Please contact us to complete checkout.",
          })
        );
      })
    ),
    Match.tag("Matched", (matchedLookup) => Effect.succeed(matchedLookup)),
    Match.tag("NotFound", (notFoundLookup) => Effect.succeed(notFoundLookup)),
    Match.exhaustive
  );

export const getConfirmedDotyposCustomerDiscount = Effect.fn(
  "checkout.getConfirmedDotyposCustomerDiscount"
)(function* (reservation: ReservationOrderData) {
  const dotypos = yield* DotyposService;
  const lookup = yield* dotypos.findCustomer(
    {
      ...splitCustomerName(reservation.name),
      email: reservation.email,
      phone: reservation.phone,
    },
    { lookupFields: ["email"] }
  );

  const confirmedLookup = yield* failClosedOnAmbiguousDotyposCustomer(lookup);

  return yield* Match.value(confirmedLookup).pipe(
    Match.tag("Matched", (matchedLookup) =>
      dotypos.getCustomerDiscount(matchedLookup.customer)
    ),
    Match.tag("NotFound", () => Effect.succeed(undefined)),
    Match.exhaustive
  );
});

export const getConfirmedDotyposCustomerDiscountById = Effect.fn(
  "checkout.getConfirmedDotyposCustomerDiscountById"
)(function* (customerId: string) {
  const dotypos = yield* DotyposService;
  const customer = yield* dotypos.getCustomer(customerId);

  return yield* dotypos.getCustomerDiscount(customer);
});
