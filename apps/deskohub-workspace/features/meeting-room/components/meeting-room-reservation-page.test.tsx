import { beforeEach, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { ReactElement } from "react";
import { normalizedMeetingRoomReservationOrderSchema } from "@/features/reservation/meeting-room-reservation";
import type { MeetingRoomReservationForm } from "./meeting-room-reservation-form";

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
const { renderMeetingRoomReservationContent } = await import(
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
    await renderMeetingRoomReservationContent({
      initialReservation: restoredReservation,
      locale: "en-US",
      searchParams: {},
    });

    expect(loadAdvertisedPrices).toHaveBeenCalledTimes(1);
    expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toHaveLength(1);
    expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toContainEqual({
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
    const form = (await renderMeetingRoomReservationContent({
      initialReservation: restoredReservation,
      locale: "en-US",
      replacementToken: "signed-replacement-token",
      searchParams: {},
    })) as ReactElement<Parameters<typeof MeetingRoomReservationForm>[0]>;

    expect(form.props.initialReservation).toBe(restoredReservation);
    expect(form.props.replacementToken).toBe("signed-replacement-token");
    expect(form.props.initialValues).toMatchObject({
      startDateTime: "2099-07-30T00:00",
      duration: "day:1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420777777777",
    });
    expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toHaveLength(1);
    expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toContainEqual({
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

test("preloads only the default selected duration", async () => {
  const originalNow = Temporal.Now.instant;
  Temporal.Now.instant = () => Temporal.Instant.from("2099-07-30T13:01:00Z");

  try {
    await renderMeetingRoomReservationContent({
      locale: "en-US",
      searchParams: {},
    });

    expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toEqual([
      {
        locale: "en-US",
        reservation: {
          kind: "meeting-room",
          details: {
            kind: "meeting-room",
            duration: { unit: "hour", amount: 1 },
            reservationDate: "2099-07-30",
          },
        },
      },
    ]);
  } finally {
    Temporal.Now.instant = originalNow;
  }
});

test("prefills the fresh form from checkout query defaults", async () => {
  const originalNow = Temporal.Now.instant;
  Temporal.Now.instant = () => Temporal.Instant.from("2099-07-30T13:01:00Z");

  try {
    const form = (await renderMeetingRoomReservationContent({
      locale: "en-US",
      searchParams: {
        duration: "hour:1",
        email: "ada@example.com",
        name: "Ada Lovelace",
        phone: "+420777777777",
        startDateTime: "2099-08-12T09:00",
      },
    })) as ReactElement<Parameters<typeof MeetingRoomReservationForm>[0]>;

    expect(form.props.initialValues).toEqual({
      startDateTime: "2099-08-12T09:00",
      duration: "hour:1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420777777777",
      message: "",
      billing: { purpose: "personal", invoice: "none" },
      marketingConsent: false,
    });
  } finally {
    Temporal.Now.instant = originalNow;
  }
});

test("keeps restored reservation values over checkout query defaults", async () => {
  const originalNow = Temporal.Now.instant;
  Temporal.Now.instant = () => Temporal.Instant.from("2099-07-30T13:01:00Z");
  const restoredReservation = normalizedMeetingRoomReservationOrderSchema.make({
    kind: "meeting-room",
    duration: { unit: "hour", amount: 4 },
    reservationDate: "2099-07-30",
    startsAt: "2099-07-30T15:00:00Z",
    endsAt: "2099-07-30T19:00:00Z",
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+420777777777",
  });

  try {
    const form = (await renderMeetingRoomReservationContent({
      initialReservation: restoredReservation,
      locale: "en-US",
      searchParams: {
        duration: "hour:1",
        name: "Query Override",
        startDateTime: "2099-08-12T09:00",
      },
    })) as ReactElement<Parameters<typeof MeetingRoomReservationForm>[0]>;

    expect(form.props.initialValues).toMatchObject({
      startDateTime: "2099-07-30T17:00",
      duration: "hour:4",
      name: "Ada Lovelace",
    });
  } finally {
    Temporal.Now.instant = originalNow;
  }
});

test("falls back to query-free defaults for an ended signed reservation", async () => {
  const endedReservation = normalizedMeetingRoomReservationOrderSchema.make({
    kind: "meeting-room",
    duration: { unit: "hour", amount: 4 },
    reservationDate: "2020-07-30",
    startsAt: "2020-07-30T15:00:00Z",
    endsAt: "2020-07-30T19:00:00Z",
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+420777777777",
  });

  const restoredForm = (await renderMeetingRoomReservationContent({
    initialReservation: endedReservation,
    locale: "en-US",
    searchParams: {
      duration: "hour:1",
      email: "override@example.com",
      name: "Query Override",
      startDateTime: "2099-08-12T09:00",
    },
  })) as ReactElement<Parameters<typeof MeetingRoomReservationForm>[0]>;

  const freshForm = (await renderMeetingRoomReservationContent({
    locale: "en-US",
    searchParams: {},
  })) as ReactElement<Parameters<typeof MeetingRoomReservationForm>[0]>;

  expect(restoredForm.props.initialValues).toEqual(
    freshForm.props.initialValues
  );
  expect(restoredForm.props.initialValues).toMatchObject({
    name: "",
    email: "",
    duration: "hour:1",
  });
  expect(restoredForm.props.initialReservation).toBeUndefined();
});
