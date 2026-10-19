import { beforeEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect } from "effect";
import { Children, type ReactElement, type ReactNode } from "react";
import { checkoutSessionIdSchema } from "@/features/checkout/checkout-identifiers";
import { getMeetingRoomDurationAdvertisedPriceRequests } from "@/features/reservation/meeting-room-advertised-price";
import { normalizedMeetingRoomReservationOrderSchema } from "@/features/reservation/meeting-room-reservation";
import { meetingRoomReservationDurations } from "@/features/reservation/meeting-room-reservation-duration";
import type { WorkspaceAvailabilityQuery } from "@/features/reservation/workspace-availability";
import type { MeetingRoomReservationForm } from "./meeting-room-reservation-form";

const adaEmail = testEmailAddress("ada");
const overrideEmail = testEmailAddress("override");
const restoredCheckoutSessionId = checkoutSessionIdSchema.make(
  "restored-checkout-session"
);

mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));

// Each request preloads, without a price the structured data could use.
const loadAdvertisedPrices = mock((requests: ReadonlyArray<unknown>) =>
  Effect.succeed(requests.map((request) => ({ request })))
);

mock.module("@/features/reservation/backend/advertised-prices.server", () => ({
  loadAdvertisedPrices,
  preloadPageAdvertisedPrices: loadAdvertisedPrices,
}));
let isRememberedDurationAvailable = true;
const isRememberedMeetingRoomReservationAvailable = mock(() =>
  Promise.resolve(isRememberedDurationAvailable)
);
mock.module(
  "@/features/reservation/backend/reservation-existing-customer.server",
  () => ({
    isRememberedCoworkOfferAvailable: () => Promise.resolve(false),
    isRememberedMeetingRoomReservationAvailable,
    loadReservationCheckoutAccount: () =>
      Promise.resolve({ status: "signed-out" }),
  })
);
const preloadAvailability = mock(
  ({
    queries,
  }: {
    readonly queries: ReadonlyArray<WorkspaceAvailabilityQuery>;
    readonly replacementToken?: string;
  }) =>
    Effect.succeed(
      queries.map((query) => ({
        query,
        availability: {
          from: query.from,
          to: query.to,
          unavailableDates: [],
          reservedDeskWorkstationRequiredDates: [],
          unavailableCoworkTiers: [],
          meetingRoomUnavailable: false,
          officeUnavailable: false,
          unavailableMonitorOptions: [],
          notices: [],
        },
        loadedAt: 1,
      }))
    )
);
mock.module(
  "@/features/reservation/backend/workspace-availability-loader",
  () => ({
    preloadPageAvailability: preloadAvailability,
  })
);
const { renderMeetingRoomReservationContent } = await import(
  "./meeting-room-reservation-page"
);

/** The form the page renders beside its structured data. */
const renderMeetingRoomReservationForm = async (
  input: Omit<
    Parameters<typeof renderMeetingRoomReservationContent>[0],
    "checkoutAccount"
  > &
    Partial<
      Pick<
        Parameters<typeof renderMeetingRoomReservationContent>[0],
        "checkoutAccount"
      >
    >
) => {
  const page = (await renderMeetingRoomReservationContent({
    checkoutAccount: { status: "signed-out" },
    ...input,
  })) as ReactElement<{
    readonly children: ReactNode;
  }>;
  return Children.toArray(page.props.children)[1];
};

beforeEach(() => {
  mock.clearAllMocks();
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
    const form = (await renderMeetingRoomReservationForm({
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
      email: adaEmail,
      phone: "+420777777777",
    });
    expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toHaveLength(
      meetingRoomReservationDurations.length
    );
    expect(preloadAvailability).toHaveBeenCalledTimes(1);
    expect(preloadAvailability.mock.calls[0]?.[0]).toEqual({
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
    expect(form.props.initialAvailability).toHaveLength(1);
    expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toContainEqual({
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
    const form = (await renderMeetingRoomReservationForm({
      locale: "en-US",
      searchParams: {},
    })) as ReactElement<Parameters<typeof MeetingRoomReservationForm>[0]>;
    const { startDateTime } = form.props.initialValues ?? {};

    expect(startDateTime).toBe("2099-07-30T15:00");
    expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toEqual(
      getMeetingRoomDurationAdvertisedPriceRequests({
        locale: "en-US",
        startDateTime: "2099-07-30T15:00",
      })
    );
    expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toHaveLength(
      meetingRoomReservationDurations.length
    );
    expect(form.props.initialAdvertisedPrices).toHaveLength(
      meetingRoomReservationDurations.length
    );
    expect(preloadAvailability.mock.calls[0]?.[0]).toEqual({
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
    expect(form.props.initialAvailability?.map(({ query }) => query)).toEqual(
      preloadAvailability.mock.calls[0]?.[0].queries
    );
  } finally {
    Temporal.Now.instant = originalNow;
  }
});

test("prefills the fresh form from checkout query defaults", async () => {
  const originalNow = Temporal.Now.instant;
  Temporal.Now.instant = () => Temporal.Instant.from("2099-07-30T13:01:00Z");

  try {
    const form = (await renderMeetingRoomReservationForm({
      locale: "en-US",
      searchParams: {
        duration: "hour:1",
        email: adaEmail,
        name: "Ada Lovelace",
        phone: "+420777777777",
        startDateTime: "2099-08-12T09:00",
      },
    })) as ReactElement<Parameters<typeof MeetingRoomReservationForm>[0]>;

    expect(form.props.initialValues).toEqual({
      startDateTime: "2099-08-12T09:00",
      duration: "hour:1",
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
    const form = (await renderMeetingRoomReservationForm({
      initialReservation: restoredFourHourReservation,
      locale: "en-US",
      searchParams: { name: "Query Override", email: overrideEmail },
    })) as ReactElement<Parameters<typeof MeetingRoomReservationForm>[0]>;

    expect(form.props.initialValues).toMatchObject({
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
    const form = (await renderMeetingRoomReservationForm({
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
    })) as ReactElement<Parameters<typeof MeetingRoomReservationForm>[0]>;

    expect(form.props.initialValues).toMatchObject({
      startDateTime: "2099-08-12T09:00",
      duration: "hour:1",
      name: "Ada Lovelace",
      email: adaEmail,
    });
    expect(form.props.checkoutSessionId).toBe(restoredCheckoutSessionId);
    expect(form.props.replacementToken).toBe("restored-pay-state");
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

  const restoredForm = (await renderMeetingRoomReservationForm({
    initialReservation: endedReservation,
    locale: "en-US",
    searchParams: {
      duration: "hour:1",
      email: overrideEmail,
      name: "Query Override",
      startDateTime: "2099-08-12T09:00",
    },
  })) as ReactElement<Parameters<typeof MeetingRoomReservationForm>[0]>;

  const freshForm = (await renderMeetingRoomReservationForm({
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
      const form = (await renderMeetingRoomReservationForm({
        checkoutAccount: { status: "linked", customer: existingCustomer },
        locale: "en-US",
        searchParams,
      })) as ReactElement<Parameters<typeof MeetingRoomReservationForm>[0]>;
      return form.props.initialValues;
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
