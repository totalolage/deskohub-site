import { beforeEach, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { ReactElement } from "react";
import type { OfficeReservationForm } from "./office-reservation-form";

mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));

const loadAdvertisedPrices = mock((requests: ReadonlyArray<unknown>) =>
  Effect.succeed(requests)
);
const loadOfficeReservationSeatCapacity = mock(() => Promise.resolve(5));

mock.module(
  "@/features/checkout/backend/checkout/checkout-pricing.service",
  () => ({
    CheckoutPricingService: { Live: Layer.empty },
  })
);
mock.module("@/features/reservation/backend/advertised-prices.server", () => ({
  loadAdvertisedPrices,
}));
mock.module(
  "@/features/office/backend/office-reservation-capacity.server",
  () => ({ loadOfficeReservationSeatCapacity })
);

const { renderOfficeReservationContent } = await import(
  "./office-reservation-page"
);

beforeEach(() => mock.clearAllMocks());

test("prefills safe office shape on a fresh date and quote", async () => {
  const originalNow = Temporal.Now.instant;
  Temporal.Now.instant = () => Temporal.Instant.from("2099-07-30T13:01:00Z");

  try {
    const form = (await renderOfficeReservationContent({
      locale: "en-US",
      searchParams: { dayCount: "3", seats: "4" },
    })) as ReactElement<Parameters<typeof OfficeReservationForm>[0]>;

    expect(form.props.initialValues).toMatchObject({
      startsOn: "2099-07-30",
      dayCount: 3,
      seats: 4,
      name: "",
      email: "",
      phone: "",
    });
    expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toEqual([
      {
        locale: "en-US",
        reservation: {
          kind: "office",
          details: {
            kind: "office",
            startsOn: "2099-07-30",
            endsOn: "2099-08-01",
            seats: 4,
          },
        },
      },
    ]);
  } finally {
    Temporal.Now.instant = originalNow;
  }
});
