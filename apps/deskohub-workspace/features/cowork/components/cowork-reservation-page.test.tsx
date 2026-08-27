import { beforeEach, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { ReactElement } from "react";
import type { CoworkReservationForm } from "./cowork-reservation-form";

mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));

const loadAdvertisedPrices = mock((requests: ReadonlyArray<unknown>) =>
  Effect.succeed(requests)
);

mock.module(
  "@/features/checkout/backend/checkout/checkout-pricing.service",
  () => ({
    CheckoutPricingService: { Live: Layer.empty },
  })
);
mock.module("@/features/reservation/backend/advertised-prices.server", () => ({
  loadAdvertisedPrices,
}));

const { renderCoworkReservationContent } = await import(
  "./cowork-reservation-page"
);

beforeEach(() => mock.clearAllMocks());

test("preloads only the default selected cowork quote", async () => {
  const originalNow = Temporal.Now.instant;
  Temporal.Now.instant = () => Temporal.Instant.from("2099-07-30T13:01:00Z");

  try {
    await renderCoworkReservationContent({
      locale: "en-US",
      searchParams: {},
    });

    expect(loadAdvertisedPrices).toHaveBeenCalledTimes(1);
    expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toEqual([
      {
        locale: "en-US",
        reservation: {
          kind: "cowork",
          details: {
            kind: "cowork",
            entryTier: "basic",
            coffee: false,
            date: "2099-07-30",
          },
        },
      },
    ]);
  } finally {
    Temporal.Now.instant = originalNow;
  }
});

test("preloads the selection resolved from reservation query values", async () => {
  const form = (await renderCoworkReservationContent({
    locale: "cs-CZ",
    searchParams: {
      entryTier: "profi",
      coffee: "true",
      date: "2099-08-01",
      monitorOption: "2x27-qhd",
    },
  })) as ReactElement<Parameters<typeof CoworkReservationForm>[0]>;

  expect(form.props.initialValues).toMatchObject({
    entryTier: "profi",
    coffee: true,
    date: "2099-08-01",
    monitorOption: "2x27-qhd",
    name: "",
    email: "",
    phone: "",
  });

  expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toEqual([
    {
      locale: "cs-CZ",
      reservation: {
        kind: "cowork",
        details: {
          kind: "cowork",
          entryTier: "profi",
          coffee: true,
          date: "2099-08-01",
        },
      },
    },
  ]);
});
