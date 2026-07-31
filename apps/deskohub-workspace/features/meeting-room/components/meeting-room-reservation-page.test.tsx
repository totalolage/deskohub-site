import { beforeEach, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { ReactElement, ReactNode } from "react";
import { normalizedMeetingRoomReservationOrderSchema } from "@/features/reservation/meeting-room-reservation";
import type { MeetingRoomReservationForm } from "./meeting-room-reservation-form";

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

beforeEach(() => mock.clearAllMocks());

test("preloads the preserved quote for a restored hourly slot that has started", async () => {
  const originalNow = Temporal.Now.instant;
  Temporal.Now.instant = () => Temporal.Instant.from("2099-07-30T13:01:00Z");
  const restoredReservation = normalizedMeetingRoomReservationOrderSchema.make({
    kind: "meeting-room",
    duration: { unit: "hour", amount: 4 },
    reservationDate: "2099-07-30",
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
          duration: { unit: "hour", amount: 4 },
          reservationDate: "2099-07-30",
        },
      },
    });
    expect(loadInitialAdvertisedPrices.mock.calls[0]?.[0]).toContainEqual({
      locale: "en-US",
      reservation: {
        kind: "meeting-room",
        details: {
          kind: "meeting-room",
          duration: { unit: "hour", amount: 1 },
          reservationDate: "2099-07-30",
        },
      },
    });
  } finally {
    Temporal.Now.instant = originalNow;
  }
});

test("restores a whole-day reservation after its start and before its end", async () => {
  const originalNow = Temporal.Now.instant;
  Temporal.Now.instant = () => Temporal.Instant.from("2099-07-30T13:01:00Z");
  const restoredReservation = normalizedMeetingRoomReservationOrderSchema.make({
    kind: "meeting-room",
    duration: { unit: "day", amount: 1 },
    reservationDate: "2099-07-30",
    startsAt: "2099-07-29T22:00:00Z",
    endsAt: "2099-07-30T22:00:00Z",
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+420777777777",
  });

  try {
    const rendered = await meetingRoomReservationPage.render({
      initialReservation: restoredReservation,
      locale: "en-US",
    });
    const form = rendered.children as ReactElement<
      Parameters<typeof MeetingRoomReservationForm>[0]
    >;

    expect(form.props.initialReservation).toBe(restoredReservation);
    expect(form.props.initialValues).toMatchObject({
      startDateTime: "2099-07-30T00:00",
      duration: "day:1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420777777777",
    });
    expect(loadInitialAdvertisedPrices.mock.calls[0]?.[0]).toContainEqual({
      locale: "en-US",
      reservation: {
        kind: "meeting-room",
        details: {
          kind: "meeting-room",
          duration: { unit: "day", amount: 1 },
          reservationDate: "2099-07-30",
        },
      },
    });
  } finally {
    Temporal.Now.instant = originalNow;
  }
});
