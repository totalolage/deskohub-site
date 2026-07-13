import { describe, expect, test } from "bun:test";
import { Result } from "effect";
import "@/shared/polyfills/temporal";
import { checkoutReturnStateReservationSchema } from "./checkout-return-state";

const makeCheckoutReturnStateReservation = (
  overrides: Record<string, unknown> = {}
) => ({
  _tag: "cowork" as const,
  tier: "basic" as const,
  startsAt: "2099-06-09T22:00:00Z",
  endsAt: "2099-06-10T22:00:00Z",
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420 777 777 777",
  coffee: true,
  ...overrides,
});

describe("checkout return-state reservation schema", () => {
  test("validates customer fields at the schema attribute level", () => {
    expect(
      Result.isSuccess(
        checkoutReturnStateReservationSchema.safeParse(
          makeCheckoutReturnStateReservation()
        )
      )
    ).toBe(true);
    expect(
      Result.isSuccess(
        checkoutReturnStateReservationSchema.safeParse(
          makeCheckoutReturnStateReservation({ name: "A" })
        )
      )
    ).toBe(false);
    expect(
      Result.isSuccess(
        checkoutReturnStateReservationSchema.safeParse(
          makeCheckoutReturnStateReservation({ email: "invalid-email" })
        )
      )
    ).toBe(false);
    expect(
      Result.isSuccess(
        checkoutReturnStateReservationSchema.safeParse(
          makeCheckoutReturnStateReservation({ phone: "not-a-phone" })
        )
      )
    ).toBe(false);
    expect(
      Result.isSuccess(
        checkoutReturnStateReservationSchema.safeParse(
          makeCheckoutReturnStateReservation({ message: "x".repeat(1001) })
        )
      )
    ).toBe(false);
  });
});
