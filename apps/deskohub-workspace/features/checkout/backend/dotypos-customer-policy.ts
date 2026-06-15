import { DotyposService, type FindCustomerResult } from "@deskohub/dotypos";
import { Data, Effect } from "effect";
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
  lookup._tag === "Ambiguous"
    ? Effect.fail(
        new AmbiguousDotyposCustomerError({
          message:
            "Customer discount could not be confirmed. Please contact us to complete checkout.",
        })
      )
    : Effect.succeed(lookup);

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

  return confirmedLookup._tag === "Matched" && confirmedLookup.customer
    ? yield* dotypos.getCustomerDiscount(confirmedLookup.customer)
    : undefined;
});
