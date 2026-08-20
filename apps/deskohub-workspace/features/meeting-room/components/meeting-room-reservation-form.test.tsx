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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
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
  meetingRoomReservationDefaultValues,
  normalizedMeetingRoomReservationOrderSchema,
} from "@/features/reservation/meeting-room-reservation";
import {
  getMeetingRoomReservationDurationKey,
  type MeetingRoomReservationDuration,
} from "@/features/reservation/meeting-room-reservation-duration";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import {
  workspaceRouterPush as push,
  workspaceUseAction,
  workspaceUseSearchParams,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const execute = mock(() => undefined);
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
  email: "ada@example.com",
  phone: "+420777777777",
  message: "Workshop",
});

const meetingRoomQuote = {
  fingerprint: "meeting-room-quote",
  items: [
    {
      type: "meeting-room" as const,
      duration: { unit: "hour" as const, amount: 1 as const },
      amount: money(47_500),
    },
  ] as const,
  payment: {
    expectedPrice: money(47_500),
    undiscountedPrice: money(47_500),
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

const renderForm = (
  props: Partial<ComponentProps<typeof MeetingRoomReservationForm>> = {}
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const renderElement = () => (
    <QueryClientProvider client={queryClient}>
      <MeetingRoomReservationForm
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
      execute,
      isExecuting: false,
      result: {},
    });
    getAdvertisedPrices.mockImplementation((requests) =>
      Promise.resolve(advertisedPricesResult(requests))
    );
  });

  afterEach(() => {
    cleanup();
    execute.mockClear();
    getAdvertisedPrices.mockClear();
    push.mockClear();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
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
    expect(
      view.container.querySelector('[data-reservation-sale="active"]')
        ?.className
    ).toContain("glow-border-purple-300");
    expect(getAdvertisedPrices).not.toHaveBeenCalled();
  });

  test("loads cancellable availability and submits the current advertised reservation", async () => {
    let availabilityRequest: {
      readonly url: string;
      readonly signal?: AbortSignal | null;
    } | null = null;
    globalThis.fetch = mock(
      (request: RequestInfo | URL, init?: RequestInit) => {
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
    expect(
      Array.from(
        view.container.querySelectorAll("[data-reservation-type-option]")
      ).every((option) => option.className.includes("lg:grid-rows-subgrid"))
    ).toBe(true);
    expect(availabilityRequest?.url).toContain(
      "kind=meeting-room&from=2099-07-30&to=2099-07-30"
    );
    expect(availabilityRequest?.url).toContain(
      "startsAt=2099-07-30T08%3A00%3A00Z"
    );
    expect(availabilityRequest?.url).toContain(
      "endsAt=2099-07-30T09%3A00%3A00Z"
    );
    expect(availabilityRequest?.signal).toBeInstanceOf(AbortSignal);
    expect(getAdvertisedPrices).toHaveBeenCalledWith(
      expect.arrayContaining([
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
      ])
    );

    const marketingConsent = view.container.querySelector(
      "#reservation-marketing-consent"
    );
    expect(view.queryByText("Privacy Policy")).toBeDefined();
    expect(
      view.container.querySelector("#reservation-privacy-consent")
    ).toBeNull();
    expect(marketingConsent?.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(continueButton);

    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    const firstSubmission = execute.mock.calls[0]?.[0];
    expect(firstSubmission).toMatchObject({
      locale: "en-US",
      checkoutSessionId: "restored-checkout-session",
      advertisedPriceToken: "sealed-advertised-price",
      marketingConsent: false,
      reservation: initialReservation,
    });
    expect(firstSubmission.checkoutAttemptId).toBeString();

    fireEvent.click(marketingConsent as Element);
    fireEvent.click(continueButton);
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls[1]?.[0].marketingConsent).toBe(true);
    expect(execute.mock.calls[1]?.[0].checkoutAttemptId).toBe(
      firstSubmission.checkoutAttemptId
    );

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
                },
              },
            },
          ])
        );
      },
      { timeout: 5000 }
    );
    fireEvent.click(continueButton);
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
    expect(execute.mock.calls[2]?.[0].checkoutAttemptId).not.toBe(
      firstSubmission.checkoutAttemptId
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
        email: "ada@example.com",
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

    fireEvent.click(view.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
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
          email: "ada@example.com",
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
          view.getByRole("button", { name: /^Meeting room start date/ })
            .textContent
        ).toContain("July 30, 2099");
      });

      const continueButton = view.getByRole("button", { name: "Continue" });
      await waitFor(() => {
        expect(continueButton.hasAttribute("disabled")).toBe(false);
      });
      fireEvent.click(continueButton);

      await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
      expect(execute.mock.calls[0]?.[0].reservation).toMatchObject({
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
        view.getByRole("button", { name: /^Meeting room start date/ })
          .textContent
      ).toContain("July 31, 2099");

      now = Temporal.Instant.from("2099-07-30T22:37:00Z");
      view.rerenderForm();

      await waitFor(() => {
        expect(
          view.getByRole("button", { name: /^Meeting room start date/ })
            .textContent
        ).toContain("July 31, 2099");
      });
    } finally {
      Temporal.Now.instant = originalNow;
    }
  });

  test("quotes the selectable whole day when restoring an hourly reservation", async () => {
    const originalNow = Temporal.Now.instant;
    Temporal.Now.instant = () => Temporal.Instant.from("2099-07-30T12:37:00Z");
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonResponse(availabilityResponse))
    ) as typeof fetch;
    const restoredHourlyReservation =
      normalizedMeetingRoomReservationOrderSchema.make({
        ...initialReservation,
        duration: { unit: "hour", amount: 1 },
        startsAt: "2099-07-30T14:00:00Z",
        endsAt: "2099-07-30T15:00:00Z",
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
                duration: { unit: "day", amount: 1 },
                reservationDate: "2099-07-30",
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
              },
            },
          },
        ])
      );
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
              },
            },
          },
        ])
      );
    } finally {
      Temporal.Now.instant = originalNow;
    }
  });

  test("preserves a restored hourly slot across a whole-day preview", async () => {
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
      const view = renderForm({
        initialReservation: restoredHourlyReservation,
      });

      await waitFor(() => {
        expect(
          view.getByLabelText(/^Meeting room start time/).getAttribute("value")
        ).toBe("15:00");
      });

      fireEvent.click(
        view.container.querySelector(
          'input[type="radio"][value="day:1"]'
        ) as HTMLInputElement
      );
      await waitFor(() => {
        expect(view.queryByLabelText(/^Meeting room start time/)).toBeNull();
      });

      fireEvent.click(
        view.container.querySelector(
          'input[type="radio"][value="hour:4"]'
        ) as HTMLInputElement
      );
      await waitFor(() => {
        expect(
          view.getByLabelText(/^Meeting room start time/).getAttribute("value")
        ).toBe("15:00");
      });
    } finally {
      Temporal.Now.instant = originalNow;
    }
  });

  test("collapses rapid interval edits into one availability request", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonResponse(availabilityResponse))
    ) as typeof fetch;

    const view = renderForm();

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));

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

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2), {
      timeout: 5000,
    });
    expect(String(globalThis.fetch.mock.calls[1]?.[0])).toContain(
      "startsAt=2099-07-30T09%3A00%3A00Z&endsAt=2099-07-30T13%3A00%3A00Z"
    );
  });

  test("renders the selected advertised discount without adding a price card", async () => {
    const discountedQuote = {
      ...advertisedPriceResponse.quote,
      payment: {
        expectedPrice: money(23_750),
        undiscountedPrice: money(47_500),
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
            subtotalBefore: money(47_500),
            amount: money(23_750),
            subtotalAfter: money(23_750),
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
      await view.findByText(/original price.*475/i, {}, { timeout: 3000 })
    ).toBeDefined();
    expect(view.getByText(/discounted price.*237[.,]5/i)).toBeDefined();
    expect(
      view.getByRole("button", { name: /discount.*meeting room.*1 hour/i })
    ).toBeDefined();
    const discountedOption = view.container.querySelector(
      '[data-reservation-type-option="hour:1"]'
    );
    expect(discountedOption?.className).not.toContain("glow-border");
    expect(
      view.container.querySelector(
        '[data-reservation-sale-discount="meeting-room-sale"]'
      )?.textContent
    ).toBe("Meeting room sale");
    expect(
      view.container.querySelector('[data-reservation-sale="active"]')
        ?.className
    ).toContain("glow-border");
    expect(view.queryByText(/selected price/i)).toBeNull();
  });

  test("presents one family sale while keeping duration cards neutral", async () => {
    getAdvertisedPrices.mockImplementation((requests) =>
      Promise.resolve(
        advertisedPricesResult(requests, (request) =>
          getDiscountedAdvertisedPriceResponse(
            request.reservation.details.duration
          )
        )
      )
    );
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonResponse(availabilityResponse))
    ) as typeof fetch;

    const view = renderForm();

    await waitFor(() => {
      expect(getAdvertisedPrices).toHaveBeenCalledTimes(1);
    });
    expect(getAdvertisedPrices.mock.calls[0]?.[0]).toHaveLength(3);
    expect(
      view.container.querySelectorAll(
        '[data-reservation-sale-discount="meeting-room-sale"]'
      )
    ).toHaveLength(1);
    for (const { duration } of workspaceMeetingRoomCatalog) {
      const durationKey = getMeetingRoomReservationDurationKey(duration);
      const option = view.container.querySelector(
        `[data-reservation-type-option="${durationKey}"]`
      );
      expect(option?.className).not.toContain("glow-border");
      expect(
        option?.querySelector("[data-reservation-type-discount-banner]")
      ).toBeNull();
    }
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

  test("keeps checkout disabled until advertised pricing can be retried", async () => {
    let pricingAvailable = false;
    getAdvertisedPrices.mockImplementation((requests) =>
      Promise.resolve(
        pricingAvailable
          ? advertisedPricesResult(requests)
          : { serverError: "unavailable" }
      )
    );
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonResponse(availabilityResponse))
    ) as typeof fetch;

    const view = renderForm();
    expect(
      (await view.findByRole("alert", {}, { timeout: 3000 })).textContent
    ).toMatch(/current price could not be loaded/i);
    expect(getAdvertisedPrices).toHaveBeenCalledTimes(4);
    expect(
      view.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
    ).toBe(true);

    pricingAvailable = true;
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(
        view.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
      ).toBe(false);
    });
    expect(getAdvertisedPrices).toHaveBeenCalledTimes(5);
  });

  test("accepts a pricing-changed redirect and reports transport failures", async () => {
    let actionOptions: {
      onSuccess: (result: {
        data: {
          status: "pricing_changed";
          redirectUrl: string;
        };
      }) => void;
      onTransportError: () => void;
    } | null = null;
    workspaceUseAction.mockImplementation((_action, options) => {
      actionOptions = options as typeof actionOptions;
      return {
        execute,
        isExecuting: false,
        result: {},
      };
    });
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonResponse(availabilityResponse))
    ) as typeof fetch;
    const view = renderForm();
    await waitFor(() =>
      expect(
        view.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
      ).toBe(false)
    );

    act(() => {
      actionOptions?.onSuccess({
        data: {
          status: "pricing_changed",
          redirectUrl: "/en-US/checkout/pay?payState=fresh",
        },
      });
    });
    expect(push).toHaveBeenCalledWith("/en-US/checkout/pay?payState=fresh");

    act(() => {
      actionOptions?.onTransportError();
    });
    expect(view.getByText(/checkout could not be started/i)).toBeDefined();
  });
});
