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

  // Pre-reservation quotes cannot safely resolve duplicate Dotypos customers.
  // Final checkout recalculates against the persisted Dotypos customer ID.
  return lookup._tag === "Matched"
    ? yield* dotypos.getCustomerDiscount(lookup.customer)
    : undefined;
});

export const getConfirmedDotyposCustomerDiscountById = Effect.fn(
  "checkout.getConfirmedDotyposCustomerDiscountById"
)(function* (customerId: string) {
  const dotypos = yield* DotyposService;
  const customer = yield* dotypos.getCustomer(customerId);

  return yield* dotypos.getCustomerDiscount(customer);
});
