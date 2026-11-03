import { beforeEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect } from "effect";
import {
  type CheckoutSessionId,
  checkoutSessionIdSchema,
} from "@/features/checkout/checkout-identifiers";
import { recordReservationPagePreloads } from "@/features/reservation/backend/reservation-page-preloads.service.mock";
import { getMeetingRoomDurationAdvertisedPriceRequests } from "@/features/reservation/meeting-room-advertised-price";
import {
  type NormalizedMeetingRoomReservationOrder,
  normalizedMeetingRoomReservationOrderSchema,
} from "@/features/reservation/meeting-room-reservation";
import { meetingRoomReservationDurations } from "@/features/reservation/meeting-room-reservation-duration";

const adaEmail = testEmailAddress("ada");
const overrideEmail = testEmailAddress("override");
const restoredCheckoutSessionId = checkoutSessionIdSchema.make(
  "restored-checkout-session"
);

mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));

let isRememberedDurationAvailable = true;
const isRememberedMeetingRoomReservationAvailable = mock(() =>
  Effect.succeed(isRememberedDurationAvailable)
);
mock.module(
  "@/features/reservation/backend/reservation-existing-customer.server",
  () => ({
    isRememberedCoworkOfferAvailable: () => Effect.succeed(false),
    isRememberedMeetingRoomReservationAvailable,
    loadReservationCheckoutAccount: () =>
      Promise.resolve({ status: "signed-out" }),
  })
);
const { meetingRoomReservationPage } = await import(
  "./meeting-room-reservation-page"
);

// Each request preloads, without a price the structured data could use.
const recordEveryPricePreload = () =>
  recordReservationPagePreloads({
    advertisedPrices: (requests) =>
      Effect.succeed(requests.map((request) => ({ request })) as never),
  });
let preloads = recordEveryPricePreload();

type MeetingRoomPageRequest = Parameters<
  typeof meetingRoomReservationPage.loadContent
>[0];

/** The form the page renders beside its structured data. */
const renderMeetingRoomReservationForm = async ({
  checkoutAccount = { status: "signed-out" },
  checkoutSessionId,
  initialReservation,
  replacementToken = "signed-replacement-token",
  ...request
}: Omit<MeetingRoomPageRequest, "checkoutAccount" | "pageData"> & {
  readonly checkoutAccount?: MeetingRoomPageRequest["checkoutAccount"];
  readonly checkoutSessionId?: CheckoutSessionId;
  readonly initialReservation?: NormalizedMeetingRoomReservationOrder;
  readonly replacementToken?: string;
}) => {
  const content = await Effect.runPromise(
    meetingRoomReservationPage
      .loadContent({
        checkoutAccount,
        pageData: undefined,
        ...request,
        ...(initialReservation && {
          restoredReservation: {
            checkoutSessionId,
            replacementToken,
            reservation: initialReservation,
          },
        }),
      })
      .pipe(Effect.provide(preloads.layer))
  );
  if (content.kind !== "form") throw new Error("Expected the reservation form");
  return content.form;
};

beforeEach(() => {
  mock.clearAllMocks();
  preloads = recordEveryPricePreload();
  isRememberedDurationAvailable = true;
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
    email: adaEmail,
    phone: "+420777777777",
  });

  try {
    const form = await renderMeetingRoomReservationForm({
      initialReservation: restoredReservation,
      locale: "en-US",
      replacementToken: "signed-replacement-token",
      searchParams: {},
    });

    expect(form.replacementToken).toBe("signed-replacement-token");
    expect(form.initialValues).toMatchObject({
      startDateTime: "2099-07-30T00:00",
      duration: "day:1",
      name: "Ada Lovelace",
      email: adaEmail,
      phone: "+420777777777",
    });
    expect(preloads.advertisedPriceRequests[0]).toHaveLength(
      meetingRoomReservationDurations.length
    );
    expect(preloads.availabilityPreloads).toHaveLength(1);
    expect(preloads.availabilityPreloads[0]).toEqual({
      queries: [
        {
          kind: "meeting-room",
          from: "2099-07-30",
          to: "2099-07-30",
          startsAt: "2099-07-29T22:00:00Z",
          endsAt: "2099-07-30T22:00:00Z",
        },
      ],
      replacementToken: "signed-replacement-token",
    });
    expect(form.initialAvailability).toHaveLength(1);
    expect(preloads.advertisedPriceRequests[0]).toContainEqual({
      locale: "en-US",
      reservation: {
        kind: "meeting-room",
        details: {
          kind: "meeting-room",
          duration: { unit: "day", amount: 1 },
          reservationDate: "2099-07-30",
          lastServiceDate: "2099-07-30",
        },
      },
    });
  } finally {
    Temporal.Now.instant = originalNow;
  }
});

test("preloads every duration's price and the selected interval's availability", async () => {
  const originalNow = Temporal.Now.instant;
  Temporal.Now.instant = () => Temporal.Instant.from("2099-07-30T13:01:00Z");

  try {
    const form = await renderMeetingRoomReservationForm({
      locale: "en-US",
      searchParams: {},
    });
    const { startDateTime } = form.initialValues ?? {};

    expect(startDateTime).toBe("2099-07-30T15:00");
    expect(preloads.advertisedPriceRequests[0]).toEqual(
      getMeetingRoomDurationAdvertisedPriceRequests({
        locale: "en-US",
        startDateTime: "2099-07-30T15:00",
      })
    );
    expect(preloads.advertisedPriceRequests[0]).toHaveLength(
      meetingRoomReservationDurations.length
    );
    expect(form.initialAdvertisedPrices).toHaveLength(
      meetingRoomReservationDurations.length
    );
    expect(preloads.availabilityPreloads[0]).toEqual({
      queries: [
        {
          kind: "meeting-room",
          from: "2099-07-30",
          to: "2099-07-30",
          startsAt: "2099-07-30T13:00:00Z",
          endsAt: "2099-07-30T14:00:00Z",
        },
      ],
      replacementToken: undefined,
    });
    expect(form.initialAvailability?.map(({ query }) => query)).toEqual(
      preloads.availabilityPreloads[0].queries
    );
  } finally {
    Temporal.Now.instant = originalNow;
  }
});

test("prefills the fresh form from checkout query defaults", async () => {
  const originalNow = Temporal.Now.instant;
  Temporal.Now.instant = () => Temporal.Instant.from("2099-07-30T13:01:00Z");

  try {
    const form = await renderMeetingRoomReservationForm({
      locale: "en-US",
      searchParams: {
        duration: "hour:1",
        email: adaEmail,
        name: "Ada Lovelace",
        phone: "+420777777777",
        startDateTime: "2099-08-12T09:00",
      },
    });

    expect(form.initialValues).toEqual({
      startDateTime: "2099-08-12T09:00",
      duration: "hour:1",
      earlySetup: false,
      name: "Ada Lovelace",
      email: adaEmail,
      phone: "+420777777777",
      billing: { purpose: "personal", invoice: "none" },
      marketingConsent: false,
    });
  } finally {
    Temporal.Now.instant = originalNow;
  }
});

const restoredFourHourReservation =
  normalizedMeetingRoomReservationOrderSchema.make({
    kind: "meeting-room",
    duration: { unit: "hour", amount: 4 },
    reservationDate: "2099-07-30",
    startsAt: "2099-07-30T15:00:00Z",
    endsAt: "2099-07-30T19:00:00Z",
    name: "Ada Lovelace",
    email: adaEmail,
    phone: "+420777777777",
  });

test("keeps restored reservation values over checkout query contact details", async () => {
  const originalNow = Temporal.Now.instant;
  Temporal.Now.instant = () => Temporal.Instant.from("2099-07-30T13:01:00Z");

  try {
    const form = await renderMeetingRoomReservationForm({
      initialReservation: restoredFourHourReservation,
      locale: "en-US",
      searchParams: { name: "Query Override", email: overrideEmail },
    });

    expect(form.initialValues).toMatchObject({
      startDateTime: "2099-07-30T17:00",
      duration: "hour:4",
      name: "Ada Lovelace",
      email: adaEmail,
    });
  } finally {
    Temporal.Now.instant = originalNow;
  }
});

test("reopens the selection edited after returning from Pay with the restored checkout", async () => {
  const originalNow = Temporal.Now.instant;
  Temporal.Now.instant = () => Temporal.Instant.from("2099-07-30T13:01:00Z");

  try {
    const form = await renderMeetingRoomReservationForm({
      checkoutSessionId: restoredCheckoutSessionId,
      initialReservation: restoredFourHourReservation,
      locale: "en-US",
      replacementToken: "restored-pay-state",
      searchParams: {
        duration: "hour:1",
        name: "Query Override",
        payState: "restored-pay-state",
        startDateTime: "2099-08-12T09:00",
      },
    });

    expect(form.initialValues).toMatchObject({
      startDateTime: "2099-08-12T09:00",
      duration: "hour:1",
      name: "Ada Lovelace",
      email: adaEmail,
    });
    expect(form.checkoutSessionId).toBe(restoredCheckoutSessionId);
    expect(form.replacementToken).toBe("restored-pay-state");
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
    email: adaEmail,
    phone: "+420777777777",
  });

  const restoredForm = await renderMeetingRoomReservationForm({
    initialReservation: endedReservation,
    locale: "en-US",
    searchParams: {
      duration: "hour:1",
      email: overrideEmail,
      name: "Query Override",
      startDateTime: "2099-08-12T09:00",
    },
  });

  const freshForm = await renderMeetingRoomReservationForm({
    locale: "en-US",
    searchParams: {},
  });

  expect(restoredForm.initialValues).toEqual(freshForm.initialValues);
  expect(restoredForm.initialValues).toMatchObject({
    name: "",
    email: "",
    duration: "hour:1",
  });
  // The ended reservation still continues its checkout.
  expect(restoredForm.replacementToken).toBe("signed-replacement-token");
});

describe("remembered meeting-room duration", () => {
  const existingCustomer = {
    contact: {
      name: "Ada Lovelace",
      email: adaEmail,
      phone: "+420777777777",
    },
    hasMarketingConsent: false,
    lastReservation: { kind: "meeting-room", duration: "hour:4" },
  } as const;

  const renderInitialValues = async (
    searchParams: Record<string, string> = {}
  ) => {
    const originalNow = Temporal.Now.instant;
    Temporal.Now.instant = () => Temporal.Instant.from("2099-07-30T07:01:00Z");

    try {
      const form = await renderMeetingRoomReservationForm({
        checkoutAccount: { status: "linked", customer: existingCustomer },
        locale: "en-US",
        searchParams,
      });
      return form.initialValues;
    } finally {
      Temporal.Now.instant = originalNow;
    }
  };

  test("opens on the remembered duration while the room is free for it", async () => {
    const initialValues = await renderInitialValues();

    expect(isRememberedMeetingRoomReservationAvailable).toHaveBeenCalledWith(
      expect.objectContaining({ duration: "hour:4" })
    );
    expect(initialValues.duration).toBe("hour:4");
  });

  test("falls back to the default duration when the room is taken for the remembered one", async () => {
    isRememberedDurationAvailable = false;

    const initialValues = await renderInitialValues();

    expect(initialValues.duration).toBe("hour:1");
  });

  test("keeps an explicit query duration without checking the remembered one", async () => {
    const initialValues = await renderInitialValues({ duration: "day:1" });

    expect(isRememberedMeetingRoomReservationAvailable).not.toHaveBeenCalled();
    expect(initialValues.duration).toBe("day:1");
  });
});
