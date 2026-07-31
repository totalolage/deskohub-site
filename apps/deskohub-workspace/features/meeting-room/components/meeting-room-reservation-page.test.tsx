import { expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { ReactNode } from "react";
import { normalizedMeetingRoomReservationOrderSchema } from "@/features/reservation/meeting-room-reservation";

const loadInitialAdvertisedPrices = mock((requests: ReadonlyArray<unknown>) =>
  Effect.succeed(requests)
);

mock.module(
  "@/features/checkout/backend/checkout/checkout-pricing.runtime",
  () => ({
    CheckoutPricingServiceLiveWithDependencies: Layer.empty,
  })
);
mock.module(
  "@/features/reservation/backend/initial-advertised-prices.server",
  () => ({ loadInitialAdvertisedPrices })
);
mock.module(
  "@/features/reservation/components/create-reservation-page.server",
  () => ({
    createReservationPage: (definition: {
      readonly render: (context: {
        readonly checkoutSessionId?: string;
        readonly initialReservation?: unknown;
        readonly locale: "en-US";
      }) => Promise<{
        readonly children: ReactNode;
        readonly fallback: ReactNode;
      }>;
    }) => definition,
  })
);
const { meetingRoomReservationPage } = await import(
  "./meeting-room-reservation-page"
);

test("preloads the preserved quote for a restored hourly slot that has started", async () => {
  const originalNow = Temporal.Now.instant;
  Temporal.Now.instant = () => Temporal.Instant.from("2099-07-30T13:01:00Z");
  const restoredReservation = normalizedMeetingRoomReservationOrderSchema.make({
    kind: "meeting-room",
    startsAt: "2099-07-30T13:00:00Z",
    endsAt: "2099-07-30T17:00:00Z",
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+420777777777",
  });

  try {
    await meetingRoomReservationPage.render({
      initialReservation: restoredReservation,
      locale: "en-US",
    });

    expect(loadInitialAdvertisedPrices).toHaveBeenCalledTimes(1);
    expect(loadInitialAdvertisedPrices.mock.calls[0]?.[0]).toContainEqual({
      locale: "en-US",
      reservation: {
        kind: "meeting-room",
        details: {
          kind: "meeting-room",
          startsAt: "2099-07-30T13:00:00Z",
          endsAt: "2099-07-30T17:00:00Z",
        },
      },
    });
    expect(loadInitialAdvertisedPrices.mock.calls[0]?.[0]).toContainEqual({
      locale: "en-US",
      reservation: {
        kind: "meeting-room",
        details: {
          kind: "meeting-room",
          startsAt: "2099-07-30T14:00:00Z",
          endsAt: "2099-07-30T15:00:00Z",
        },
      },
    });
  } finally {
    Temporal.Now.instant = originalNow;
  }
});
