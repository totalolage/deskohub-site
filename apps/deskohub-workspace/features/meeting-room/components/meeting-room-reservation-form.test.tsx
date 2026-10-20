import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { Schema } from "effect";
import type { ComponentProps } from "react";
import type {
  AdvertisedPrice,
  AdvertisedPriceRequest,
} from "@/features/checkout/advertised-price";
import { getMeetingRoomCheckoutSummary } from "@/features/checkout/checkout-summary-meeting-room";
import {
  getWorkspaceMeetingRoomPriceForDuration,
  workspaceMeetingRoomCatalog,
} from "@/features/checkout/product-catalog";
import { discountIdSchema } from "@/features/discounts/contracts";
import {
  continueAndSubmitReservation,
  mockReservationCheckoutStep,
} from "@/features/reservation/components/reservation-checkout-step.test-utils";
import {
  meetingRoomReservationDefaultValues,
  normalizedMeetingRoomReservationOrderSchema,
} from "@/features/reservation/meeting-room-reservation";
import {
  getMeetingRoomReservationDurationKey,
  type MeetingRoomReservationDuration,
} from "@/features/reservation/meeting-room-reservation-duration";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import { getMeetingRoomSelectionAvailabilityQuery } from "@/features/reservation/workspace-availability";
import {
  workspaceUseAction,
  workspaceUseSearchParams,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const testEmailAddressForAda = testEmailAddress("ada");

const executeAsync = mock(() => Promise.resolve({}));
const getAdvertisedPrices = mock(
  (requests: ReadonlyArray<AdvertisedPriceRequest>) =>
    Promise.resolve(advertisedPricesResult(requests))
);

mock.module("@/features/cookie-consent", () => ({
  useCookieConsent: () => ({ isAccepted: () => false }),
}));

mock.module("@/features/reservation/actions/get-advertised-price", () => ({
  getAdvertisedPrices,
}));

mockReservationCheckoutStep();

const { MeetingRoomReservationForm } = await import(
  "./meeting-room-reservation-form"
);

const money = (value: number) => ({
  value,
  exponent: 2,
  currency: "CZK" as const,
});

const initialReservation = normalizedMeetingRoomReservationOrderSchema.make({
  kind: "meeting-room",
  duration: { unit: "hour", amount: 1 },
  reservationDate: "2099-07-30",
  startsAt: "2099-07-30T08:00:00Z",
  endsAt: "2099-07-30T09:00:00Z",
  name: "Ada Lovelace",
  email: testEmailAddressForAda,
  phone: "+420777777777",
  message: "Workshop",
});

const meetingRoomQuote = {
  fingerprint: "meeting-room-quote",
  items: [
    {
      type: "meeting-room" as const,
      duration: { unit: "hour" as const, amount: 1 as const },
      amount: money(35_000),
    },
  ] as const,
  payment: {
    expectedPrice: money(35_000),
    undiscountedPrice: money(35_000),
    discounts: [],
  },
};

const advertisedPriceResponse = {
  kind: "meeting-room" as const,
  quote: meetingRoomQuote,
  summary: getMeetingRoomCheckoutSummary(meetingRoomQuote),
  advertisedPriceToken: "sealed-advertised-price",
};

function advertisedPricesResult(
  requests: ReadonlyArray<AdvertisedPriceRequest>,
  getPrice: (request: AdvertisedPriceRequest) => AdvertisedPrice = () =>
    advertisedPriceResponse
) {
  return {
    data: requests.map((request) => ({
      request,
      advertisedPrice: getPrice(request),
    })),
  };
}

const getDiscountedAdvertisedPriceResponse = (
  duration: MeetingRoomReservationDuration
) => {
  const interval = getMeetingRoomReservationInterval(
    "2099-07-30T10:00",
    duration
  );
  if (!interval) {
    throw new Error("Expected a valid meeting-room interval");
  }
  const originalPrice = getWorkspaceMeetingRoomPriceForDuration(duration);
  const durationKey = getMeetingRoomReservationDurationKey(duration);
  const discountedPrice = money(originalPrice.value / 2);
  const quote = {
    fingerprint: `meeting-room-${durationKey}-sale`,
    items: [
      {
        type: "meeting-room" as const,
        duration,
        amount: originalPrice,
      },
    ] as const,
    payment: {
      expectedPrice: discountedPrice,
      undiscountedPrice: originalPrice,
      discounts: [
        {
          discount: {
            id: Schema.decodeUnknownSync(discountIdSchema)("meeting-room-sale"),
            label: "Meeting room sale",
            adjustment: {
              kind: "percentage" as const,
              basisPoints: 5000,
            },
          },
          subtotalBefore: originalPrice,
          amount: discountedPrice,
          subtotalAfter: discountedPrice,
        },
      ],
    },
  };

  return {
    kind: "meeting-room" as const,
    quote,
    summary: getMeetingRoomCheckoutSummary(quote),
    advertisedPriceToken: `sealed-advertised-price-${durationKey}`,
  };
};

const availabilityResponse = {
  from: "2099-07-30",
  to: "2099-07-30",
  unavailableDates: [],
  reservedDeskWorkstationRequiredDates: [],
  unavailableCoworkTiers: [],
  meetingRoomUnavailable: false,
  officeUnavailable: false,
  unavailableMonitorOptions: [],
  notices: [],
};

const jsonResponse = <T,>(body: T) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const startTimesResponse = {
  date: "2099-07-30",
  duration: "hour:1",
  startTimes: ["10:00", "14:00", "15:00"].map((time) => {
    const startsAt = Temporal.PlainDateTime.from(`2099-07-30T${time}`)
      .toZonedDateTime("Europe/Prague")
      .toInstant();
    return {
      startDateTime: `2099-07-30T${time}`,
      startsAt: startsAt.toString(),
      endsAt: startsAt.add({ hours: 1 }).toString(),
    };
  }),
};

const isStartTimesRequest = (request: RequestInfo | URL) =>
  String(request).includes("mode=start-times");

/** Answers start-times requests with the given list and others with `body`. */
const availabilityFetch = <T,>(
  body: T,
  startTimes: typeof startTimesResponse = startTimesResponse
) =>
  mock((request: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(
      jsonResponse(isStartTimesRequest(request) ? startTimes : body)
    )
  );

const getIntervalAvailabilityCalls = (
  fetchMock: ReturnType<typeof availabilityFetch>
) => fetchMock.mock.calls.filter(([request]) => !isStartTimesRequest(request));

const renderForm = (
  props: Partial<ComponentProps<typeof MeetingRoomReservationForm>> = {},
  queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  })
) => {
  const renderElement = () => (
    <QueryClientProvider client={queryClient}>
      <MeetingRoomReservationForm
        checkoutCustomer={{
          status: "profile-missing",
          email: testEmailAddressForAda,
          continuesCheckout: false,
        }}
        checkoutSessionId="restored-checkout-session"
        initialReservation={initialReservation}
        locale="en-US"
        {...props}
      />
    </QueryClientProvider>
  );
  const view = render(renderElement());

  return Object.assign(view, {
    rerenderForm: () => view.rerender(renderElement()),
  });
};

describe("MeetingRoomReservationForm", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    workspaceUseSearchParams.mockReturnValue(
      new URLSearchParams("utm_source=meeting-room-test")
    );
    workspaceUseAction.mockReturnValue({
      executeAsync,
      isExecuting: false,
      result: {},
    });
    getAdvertisedPrices.mockImplementation((requests) =>
      Promise.resolve(advertisedPricesResult(requests))
    );
  });

  afterEach(() => {
    cleanup();
    executeAsync.mockClear();
    getAdvertisedPrices.mockClear();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("renders every server-loaded duration quote on the first paint without refetching", () => {
    getAdvertisedPrices.mockImplementation(() => new Promise(() => undefined));
    const initialAdvertisedPrices = workspaceMeetingRoomCatalog.map(
      ({ duration }) => {
        return {
          request: {
            locale: "en-US" as const,
            reservation: {
              kind: "meeting-room" as const,
              details: {
                kind: "meeting-room" as const,
                duration,
                reservationDate: "2099-07-30",
                lastServiceDate: "2099-07-30",
              },
            },
          },
          advertisedPrice: getDiscountedAdvertisedPriceResponse(duration),
        };
      }
    );

    const view = renderForm({
      initialAdvertisedPrices,
      initialReservation: undefined,
      initialValues: {
        ...meetingRoomReservationDefaultValues,
        startDateTime: "2099-07-30T10:00",
      },
    });

    expect(
      view.container.querySelectorAll(
        '[data-reservation-sale-discount="meeting-room-sale"]'
      )
    ).toHaveLength(1);
    expect(getAdvertisedPrices).not.toHaveBeenCalled();
  });

  test("renders page-loaded availability on the first paint without an availability request", () => {
    const fetchCalls = availabilityFetch(availabilityResponse);
    globalThis.fetch = fetchCalls as typeof fetch;
    const query = getMeetingRoomSelectionAvailabilityQuery({
      duration: "hour:1",
      startDateTime: "2099-07-30T10:00",
    });
    if (!query) throw new Error("Expected a meeting-room availability query");

    const view = renderForm({
      initialAvailability: [
        {
          query,
          availability: {
            ...availabilityResponse,
            meetingRoomUnavailable: true,
          },
          loadedAt: Date.now(),
        },
      ],
      initialReservation: undefined,
      initialValues: {
        ...meetingRoomReservationDefaultValues,
        startDateTime: "2099-07-30T10:00",
      },
    });

    expect(view.getByText(/meeting room is not available/i)).toBeDefined();
    expect(getIntervalAvailabilityCalls(fetchCalls)).toEqual([]);
  });

  test("loads cancellable availability and submits the current advertised reservation", async () => {
    let availabilityRequest: {
      readonly url: string;
      readonly signal?: AbortSignal | null;
    } | null = null;
    globalThis.fetch = mock(
      (request: RequestInfo | URL, init?: RequestInit) => {
        if (isStartTimesRequest(request)) {
          return Promise.resolve(jsonResponse(startTimesResponse));
        }
        availabilityRequest = {
          url: String(request),
          signal: init?.signal,
        };
        return Promise.resolve(jsonResponse(availabilityResponse));
      }
    ) as typeof fetch;

    const view = renderForm();
    const continueButton = view.getByRole("button", { name: "Continue" });
    const durationInputs = ["hour:1", "hour:4", "day:1"].map(
      (durationKey) =>
        view.container.querySelector(
          `[id="meeting-room-duration-${durationKey}"]`
        ) as HTMLInputElement
    );

    await waitFor(
      () => {
        expect(continueButton.hasAttribute("disabled")).toBe(false);
      },
      { timeout: 5000 }
    );
    expect(durationInputs.map(({ checked }) => checked)).toEqual([
      true,
      false,
      false,
    ]);
    expect(
      view.container.querySelectorAll("[data-reservation-type-option]").length
    ).toBe(3);
    expect(
      Array.from(
        view.container.querySelectorAll("[data-reservation-type-title]")
      ).map((title) => title.textContent)
    ).toEqual(["1 hour", "4 hours", "whole day"]);
    expect(availabilityRequest?.signal).toBeInstanceOf(AbortSignal);

    await continueAndSubmitReservation(continueButton);

    await waitFor(() => expect(executeAsync).toHaveBeenCalledTimes(1));
    expect(executeAsync.mock.calls[0]?.[0]).toMatchObject({
      locale: "en-US",
      checkoutSessionId: "restored-checkout-session",
      advertisedPriceToken: "sealed-advertised-price",
      marketingConsent: false,
      reservation: initialReservation,
    });

    // Every duration is quoted up front, so switching it needs no new quote.
    fireEvent.click(
      view.container.querySelector(
        'input[type="radio"][value="hour:4"]'
      ) as HTMLInputElement
    );
    await waitFor(
      () => {
        expect(getAdvertisedPrices).toHaveBeenCalledTimes(1);
        expect(continueButton.hasAttribute("disabled")).toBe(false);
        expect(durationInputs[1]?.checked).toBe(true);
      },
      { timeout: 5000 }
    );
  });

  test("hides time and submits whole-day reservations midnight to midnight", async () => {
    const interval = getMeetingRoomReservationInterval("2099-07-30T10:00", {
      unit: "day",
      amount: 1,
    });
    if (!interval) {
      throw new Error("Expected a valid whole-day meeting-room interval");
    }
    let availabilityUrl = "";
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      availabilityUrl = String(request);
      return Promise.resolve(jsonResponse(availabilityResponse));
    }) as typeof fetch;
    getAdvertisedPrices.mockImplementation(() => new Promise(() => undefined));
    const advertisedPrice = getDiscountedAdvertisedPriceResponse({
      unit: "day",
      amount: 1,
    });
    const view = renderForm({
      initialAdvertisedPrices: [
        {
          request: {
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
          },
          advertisedPrice,
        },
      ],
      initialReservation: undefined,
      initialValues: {
        ...meetingRoomReservationDefaultValues,
        startDateTime: "2099-07-30T10:00",
        duration: "day:1",
        name: "Ada Lovelace",
        email: testEmailAddressForAda,
        phone: "+420777777777",
      },
    });

    expect(view.queryByLabelText(/^Meeting room start time/)).toBeNull();
    expect(view.getByText("Reservation date")).toBeDefined();
    expect(view.getByText("whole day")).toBeDefined();
    await waitFor(() => {
      expect(availabilityUrl).toContain("startsAt=2099-07-29T22%3A00%3A00Z");
      expect(availabilityUrl).toContain("endsAt=2099-07-30T22%3A00%3A00Z");
      expect(
        view.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
      ).toBe(false);
    });

    await continueAndSubmitReservation(
      view.getByRole("button", { name: "Continue" }) as HTMLButtonElement
    );

    await waitFor(() => expect(executeAsync).toHaveBeenCalledTimes(1));
    expect(executeAsync.mock.calls[0]?.[0]).toMatchObject({
      advertisedPriceToken: advertisedPrice.advertisedPriceToken,
      marketingConsent: false,
      reservation: {
        kind: "meeting-room",
        duration: { unit: "day", amount: 1 },
        reservationDate: "2099-07-30",
        ...interval,
      },
    });
  });

  test("preserves the selected date and time across whole-day toggles", async () => {
    const originalNow = Temporal.Now.instant;
    Temporal.Now.instant = () => Temporal.Instant.from("2099-07-30T12:37:00Z");
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonResponse(availabilityResponse))
    ) as typeof fetch;

    try {
      const view = renderForm({
        initialReservation: undefined,
        initialValues: {
          ...meetingRoomReservationDefaultValues,
          email: testEmailAddressForAda,
          name: "Ada Lovelace",
          phone: "+420777777777",
          startDateTime: "2099-07-30T16:00",
        },
      });

      expect(
        (view.getByLabelText(/^Meeting room start time/) as HTMLInputElement)
          .value
      ).toBe("16:00");

      fireEvent.click(
        view.container.querySelector(
          'input[type="radio"][value="day:1"]'
        ) as HTMLInputElement
      );
      await waitFor(() => {
        expect(view.queryByLabelText(/^Meeting room start time/)).toBeNull();
        expect(getAdvertisedPrices).toHaveBeenCalledWith(
          expect.arrayContaining([
            {
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
            },
          ])
        );
      });
      fireEvent.click(
        view.container.querySelector(
          'input[type="radio"][value="hour:1"]'
        ) as HTMLInputElement
      );
      await waitFor(() => {
        expect(
          (view.getByLabelText(/^Meeting room start time/) as HTMLInputElement)
            .value
        ).toBe("16:00");
        expect(
          view.getByRole<HTMLInputElement>("combobox", {
            name: "Start date and time",
          }).value
        ).toBe("7/30/2099");
      });

      const continueButton = view.getByRole("button", { name: "Continue" });
      await waitFor(() => {
        expect(continueButton.hasAttribute("disabled")).toBe(false);
      });
      await continueAndSubmitReservation(continueButton as HTMLButtonElement);

      await waitFor(() => expect(executeAsync).toHaveBeenCalledTimes(1));
      expect(executeAsync.mock.calls[0]?.[0].reservation).toMatchObject({
        kind: "meeting-room",
        duration: { unit: "hour", amount: 1 },
        reservationDate: "2099-07-30",
        startsAt: "2099-07-30T14:00:00Z",
        endsAt: "2099-07-30T15:00:00Z",
      });
    } finally {
      Temporal.Now.instant = originalNow;
    }
  });

  test("preserves a restored whole day after its start and before its end", async () => {
    const originalNow = Temporal.Now.instant;
    let now = Temporal.Instant.from("2099-07-30T12:37:00Z");
    Temporal.Now.instant = () => now;
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonResponse(availabilityResponse))
    ) as typeof fetch;
    const restoredWholeDayReservation =
      normalizedMeetingRoomReservationOrderSchema.make({
        ...initialReservation,
        duration: { unit: "day", amount: 1 },
        reservationDate: "2099-07-31",
        startsAt: "2099-07-30T22:00:00Z",
        endsAt: "2099-07-31T22:00:00Z",
      });

    try {
      const view = renderForm({
        initialReservation: restoredWholeDayReservation,
      });
      expect(
        view.getByRole<HTMLInputElement>("combobox", {
          name: "Reservation date",
        }).value
      ).toBe("7/31/2099");

      now = Temporal.Instant.from("2099-07-30T22:37:00Z");
      view.rerenderForm();

      await waitFor(() => {
        expect(
          view.getByRole<HTMLInputElement>("combobox", {
            name: "Reservation date",
          }).value
        ).toBe("7/31/2099");
      });
    } finally {
      Temporal.Now.instant = originalNow;
    }
  });

  test("keeps the selected quote on a restored hourly slot that has started", async () => {
    const originalNow = Temporal.Now.instant;
    Temporal.Now.instant = () => Temporal.Instant.from("2099-07-30T13:01:00Z");
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonResponse(availabilityResponse))
    ) as typeof fetch;
    const restoredHourlyReservation =
      normalizedMeetingRoomReservationOrderSchema.make({
        ...initialReservation,
        duration: { unit: "hour", amount: 4 },
        startsAt: "2099-07-30T13:00:00Z",
        endsAt: "2099-07-30T17:00:00Z",
      });

    try {
      renderForm({ initialReservation: restoredHourlyReservation });

      await waitFor(() => {
        expect(getAdvertisedPrices).toHaveBeenCalledTimes(1);
      });
      expect(getAdvertisedPrices).toHaveBeenCalledWith(
        expect.arrayContaining([
          {
            locale: "en-US",
            reservation: {
              kind: "meeting-room",
              details: {
                kind: "meeting-room",
                duration: { unit: "hour", amount: 4 },
                reservationDate: "2099-07-30",
                lastServiceDate: "2099-07-30",
              },
            },
          },
          {
            locale: "en-US",
            reservation: {
              kind: "meeting-room",
              details: {
                kind: "meeting-room",
                duration: { unit: "hour", amount: 1 },
                reservationDate: "2099-07-30",
                lastServiceDate: "2099-07-30",
              },
            },
          },
        ])
      );
    } finally {
      Temporal.Now.instant = originalNow;
    }
  });

  test("collapses rapid interval edits into one availability request", async () => {
    const fetchCalls = availabilityFetch(availabilityResponse);
    globalThis.fetch = fetchCalls as typeof fetch;

    const view = renderForm();

    await waitFor(() =>
      expect(getIntervalAvailabilityCalls(fetchCalls)).toHaveLength(1)
    );

    fireEvent.input(
      view.container.querySelector(
        'input[aria-label^="Meeting room start time"]'
      ) as HTMLInputElement,
      { target: { value: "11:00" } }
    );
    fireEvent.click(
      view.container.querySelector(
        'input[type="radio"][value="hour:4"]'
      ) as HTMLInputElement
    );

    await waitFor(
      () => expect(getIntervalAvailabilityCalls(fetchCalls)).toHaveLength(2),
      { timeout: 5000 }
    );
    expect(String(getIntervalAvailabilityCalls(fetchCalls)[1]?.[0])).toContain(
      "startsAt=2099-07-30T09%3A00%3A00Z&endsAt=2099-07-30T13%3A00%3A00Z"
    );
  });

  test("renders the selected advertised discount without adding a price card", async () => {
    const discountedQuote = {
      ...advertisedPriceResponse.quote,
      payment: {
        expectedPrice: money(17_500),
        undiscountedPrice: money(35_000),
        discounts: [
          {
            discount: {
              id: Schema.decodeUnknownSync(discountIdSchema)(
                "meeting-room-sale"
              ),
              label: "Meeting room sale",
              adjustment: {
                kind: "percentage" as const,
                basisPoints: 5000,
              },
            },
            subtotalBefore: money(35_000),
            amount: money(17_500),
            subtotalAfter: money(17_500),
          },
        ],
      },
    };
    getAdvertisedPrices.mockImplementation((requests) =>
      Promise.resolve(
        advertisedPricesResult(requests, () => ({
          ...advertisedPriceResponse,
          quote: discountedQuote,
          summary: getMeetingRoomCheckoutSummary(discountedQuote),
        }))
      )
    );
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonResponse(availabilityResponse))
    ) as typeof fetch;

    const view = renderForm();

    expect(
      await view.findByText(/original price.*350/i, {}, { timeout: 3000 })
    ).toBeDefined();
    expect(view.getByText(/discounted price.*175/i)).toBeDefined();
    expect(
      view.getByRole("button", { name: /discount.*meeting room.*1 hour/i })
    ).toBeDefined();
    expect(
      view.container.querySelector(
        '[data-reservation-sale-discount="meeting-room-sale"]'
      )?.textContent
    ).toBe("Meeting room sale -50%");
    expect(view.queryByText(/selected price/i)).toBeNull();
  });

  test("disables checkout when Dotypos reports the interval unavailable", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        jsonResponse({
          ...availabilityResponse,
          meetingRoomUnavailable: true,
        })
      )
    ) as typeof fetch;

    const view = renderForm();

    expect(
      await view.findByText(/meeting room is not available/i)
    ).toBeDefined();
    expect(
      view.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
    ).toBe(true);
  });

  describe("free start times", () => {
    test("lists the day's free starts as a labelled group that sets the start time", async () => {
      const fetchCalls = availabilityFetch(availabilityResponse);
      globalThis.fetch = fetchCalls as typeof fetch;

      const view = renderForm();
      const group = await view.findByRole("radiogroup", {
        name: "Free start times",
      });
      const options = within(group).getAllByRole("radio") as HTMLInputElement[];

      expect(options.map(({ value }) => value)).toEqual([
        "2099-07-30T10:00",
        "2099-07-30T14:00",
        "2099-07-30T15:00",
      ]);
      expect(options.map(({ checked }) => checked)).toEqual([
        true,
        false,
        false,
      ]);
      expect(
        fetchCalls.mock.calls.some(([request]) =>
          String(request).endsWith(
            "?kind=meeting-room&mode=start-times&date=2099-07-30&duration=hour%3A1"
          )
        )
      ).toBe(true);

      fireEvent.click(options[1] as HTMLInputElement);

      const timeInput = view.container.querySelector(
        'input[aria-label^="Meeting room start time"]'
      ) as HTMLInputElement;
      await waitFor(() => expect(timeInput.value).toBe("14:00"));
      expect((options[1] as HTMLInputElement).checked).toBe(true);
      await waitFor(() =>
        expect(
          getIntervalAvailabilityCalls(fetchCalls).some(([request]) =>
            String(request).includes(
              "startsAt=2099-07-30T12%3A00%3A00Z&endsAt=2099-07-30T13%3A00%3A00Z"
            )
          )
        ).toBe(true)
      );
    });

    test("says when the day has no free start", async () => {
      globalThis.fetch = availabilityFetch(availabilityResponse, {
        ...startTimesResponse,
        startTimes: [],
      }) as typeof fetch;

      const view = renderForm();

      expect(
        await view.findByText(
          "No free start times on this day for this duration. Try another date or a shorter duration."
        )
      ).toBeDefined();
      expect(view.queryByRole("radiogroup", { name: "Free start times" })).toBe(
        null
      );
    });

    test("lists no start times for a whole-day booking", async () => {
      globalThis.fetch = availabilityFetch(
        availabilityResponse
      ) as typeof fetch;

      const view = renderForm();
      await view.findByRole("radiogroup", { name: "Free start times" });

      fireEvent.click(
        view.container.querySelector(
          'input[type="radio"][value="day:1"]'
        ) as HTMLInputElement
      );

      await waitFor(() =>
        expect(view.queryByText("Free start times")).toBe(null)
      );
    });
  });
});
