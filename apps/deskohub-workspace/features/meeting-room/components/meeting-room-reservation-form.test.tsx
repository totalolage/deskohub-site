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
import { getMeetingRoomCheckoutSummary } from "@/features/checkout/checkout-summary-meeting-room";
import {
  getWorkspaceMeetingRoomDurationMinutes,
  getWorkspaceMeetingRoomPriceForDuration,
  getWorkspaceMeetingRoomReservationDuration,
  type WorkspaceMeetingRoomDurationMinutes,
  workspaceMeetingRoomCatalog,
} from "@/features/checkout/product-catalog";
import { discountIdSchema } from "@/features/discounts/contracts";
import {
  meetingRoomReservationDefaultValues,
  normalizedMeetingRoomReservationOrderSchema,
} from "@/features/reservation/meeting-room-reservation";
import { getMeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
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
const getAdvertisedPrice = mock(() =>
  Promise.resolve({ data: advertisedPriceResponse })
);

mock.module("@/features/cookie-consent", () => ({
  useCookieConsent: () => ({ isAccepted: () => false }),
}));

mock.module("@/features/reservation/actions/get-advertised-price", () => ({
  getAdvertisedPrice,
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
      durationMinutes: 60 as const,
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

const getDiscountedAdvertisedPriceResponse = (
  durationMinutes: WorkspaceMeetingRoomDurationMinutes
) => {
  const duration = getWorkspaceMeetingRoomReservationDuration(durationMinutes);
  const interval = getMeetingRoomReservationInterval(
    "2099-07-30T10:00",
    duration
  );
  if (!interval) {
    throw new Error("Expected a valid meeting-room interval");
  }
  const originalPrice =
    getWorkspaceMeetingRoomPriceForDuration(durationMinutes);
  const discountedPrice = money(originalPrice.value / 2);
  const quote = {
    fingerprint: `meeting-room-${durationMinutes}-sale`,
    items: [
      {
        type: "meeting-room" as const,
        durationMinutes,
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
    advertisedPriceToken: `sealed-advertised-price-${durationMinutes}`,
  };
};

const availabilityResponse = {
  from: "2099-07-30",
  to: "2099-07-30",
  unavailableDates: [],
  unavailableCoworkTiers: [],
  meetingRoomUnavailable: false,
  unavailableMonitorOptions: [],
  notices: [],
};

const jsonResponse = (body: unknown) =>
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
    getAdvertisedPrice.mockImplementation(() =>
      Promise.resolve({ data: advertisedPriceResponse })
    );
  });

  afterEach(() => {
    cleanup();
    execute.mockClear();
    getAdvertisedPrice.mockClear();
    push.mockClear();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("renders every server-loaded duration quote on the first paint without refetching", () => {
    getAdvertisedPrice.mockImplementation(() => new Promise(() => undefined));
    const initialAdvertisedPrices = workspaceMeetingRoomCatalog.map(
      ({ duration, durationMinutes }) => {
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
          advertisedPrice:
            getDiscountedAdvertisedPriceResponse(durationMinutes),
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

    for (const { duration } of workspaceMeetingRoomCatalog) {
      const durationKey = getMeetingRoomReservationDurationKey(duration);
      expect(
        view.container.querySelector(
          `[data-reservation-type-option="${durationKey}"] [data-reservation-type-discount="meeting-room-sale"]`
        )
      ).not.toBeNull();
    }
    expect(getAdvertisedPrice).not.toHaveBeenCalled();
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

    await waitFor(() => {
      expect(continueButton.hasAttribute("disabled")).toBe(false);
    });
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
    expect(getAdvertisedPrice).toHaveBeenCalledWith({
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

    fireEvent.click(view.getByRole("checkbox"));
    fireEvent.click(continueButton);

    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    const firstSubmission = execute.mock.calls[0]?.[0];
    expect(firstSubmission).toMatchObject({
      locale: "en-US",
      checkoutSessionId: "restored-checkout-session",
      advertisedPriceToken: "sealed-advertised-price",
      legalConsent: true,
      reservation: initialReservation,
    });
    expect(firstSubmission.checkoutAttemptId).toBeString();

    fireEvent.click(continueButton);
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls[1]?.[0].checkoutAttemptId).toBe(
      firstSubmission.checkoutAttemptId
    );

    fireEvent.click(
      view.container.querySelector(
        'input[type="radio"][value="hour:4"]'
      ) as HTMLInputElement
    );
    await waitFor(() => {
      expect(getAdvertisedPrice).toHaveBeenCalledTimes(3);
      expect(continueButton.hasAttribute("disabled")).toBe(false);
      expect(durationInputs[1]?.checked).toBe(true);
      expect(getAdvertisedPrice).toHaveBeenCalledWith({
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
    });
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
    getAdvertisedPrice.mockImplementation(() => new Promise(() => undefined));
    const advertisedPrice = getDiscountedAdvertisedPriceResponse(1440);
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

    expect(view.queryByLabelText("Meeting room start time")).toBeNull();
    expect(view.getByText("Reservation date")).toBeDefined();
    expect(view.getByText("whole day")).toBeDefined();
    await waitFor(() => {
      expect(availabilityUrl).toContain("startsAt=2099-07-29T22%3A00%3A00Z");
      expect(availabilityUrl).toContain("endsAt=2099-07-30T22%3A00%3A00Z");
      expect(
        view.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
      ).toBe(false);
    });

    fireEvent.click(view.getByRole("checkbox"));
    fireEvent.click(view.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      advertisedPriceToken: advertisedPrice.advertisedPriceToken,
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
        (view.getByLabelText("Meeting room start time") as HTMLInputElement)
          .value
      ).toBe("16:00");

      fireEvent.click(
        view.container.querySelector(
          'input[type="radio"][value="day:1"]'
        ) as HTMLInputElement
      );
      await waitFor(() => {
        expect(view.queryByLabelText("Meeting room start time")).toBeNull();
        expect(getAdvertisedPrice).toHaveBeenCalledWith({
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
      });
      fireEvent.click(
        view.container.querySelector(
          'input[type="radio"][value="hour:1"]'
        ) as HTMLInputElement
      );
      await waitFor(() => {
        expect(
          (view.getByLabelText("Meeting room start time") as HTMLInputElement)
            .value
        ).toBe("16:00");
        expect(
          view.getByRole("button", { name: "Meeting room start date" })
            .textContent
        ).toContain("July 30, 2099");
      });

      const continueButton = view.getByRole("button", { name: "Continue" });
      await waitFor(() => {
        expect(continueButton.hasAttribute("disabled")).toBe(false);
      });
      fireEvent.click(view.getByRole("checkbox"));
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
        view.getByRole("button", { name: "Meeting room start date" })
          .textContent
      ).toContain("July 31, 2099");

      now = Temporal.Instant.from("2099-07-30T22:37:00Z");
      view.rerenderForm();

      await waitFor(() => {
        expect(
          view.getByRole("button", { name: "Meeting room start date" })
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
        expect(getAdvertisedPrice).toHaveBeenCalledTimes(3);
      });
      expect(getAdvertisedPrice).toHaveBeenCalledWith({
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
      expect(getAdvertisedPrice).toHaveBeenCalledWith({
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
        expect(getAdvertisedPrice).toHaveBeenCalledTimes(3);
      });
      expect(getAdvertisedPrice).toHaveBeenCalledWith({
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
      expect(getAdvertisedPrice).toHaveBeenCalledWith({
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
          view.getByLabelText("Meeting room start time").getAttribute("value")
        ).toBe("15:00");
      });

      fireEvent.click(
        view.container.querySelector(
          'input[type="radio"][value="day:1"]'
        ) as HTMLInputElement
      );
      await waitFor(() => {
        expect(view.queryByLabelText("Meeting room start time")).toBeNull();
      });

      fireEvent.click(
        view.container.querySelector(
          'input[type="radio"][value="hour:4"]'
        ) as HTMLInputElement
      );
      await waitFor(() => {
        expect(
          view.getByLabelText("Meeting room start time").getAttribute("value")
        ).toBe("15:00");
      });
    } finally {
      Temporal.Now.instant = originalNow;
    }
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
    getAdvertisedPrice.mockImplementation(() =>
      Promise.resolve({
        data: {
          ...advertisedPriceResponse,
          quote: discountedQuote,
          summary: getMeetingRoomCheckoutSummary(discountedQuote),
        },
      })
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
    expect(discountedOption?.className).toContain("outline-purple-500");
    expect(
      discountedOption?.querySelector(
        '[data-reservation-type-discount="meeting-room-sale"]'
      )?.textContent
    ).toBe("Meeting room sale");
    expect(
      discountedOption?.querySelector("[data-reservation-type-sale-glimmer]")
    ).not.toBeNull();
    expect(view.queryByText(/selected price/i)).toBeNull();
  });

  test("advertises a sale on every duration before it is selected", async () => {
    getAdvertisedPrice.mockImplementation((input) => {
      const duration = input.reservation.details.duration;
      const durationMinutes = getWorkspaceMeetingRoomDurationMinutes(duration);

      return Promise.resolve({
        data: getDiscountedAdvertisedPriceResponse(durationMinutes),
      });
    });
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonResponse(availabilityResponse))
    ) as typeof fetch;

    const view = renderForm();

    await waitFor(() => {
      expect(getAdvertisedPrice).toHaveBeenCalledTimes(3);
    });
    for (const { duration } of workspaceMeetingRoomCatalog) {
      const durationKey = getMeetingRoomReservationDurationKey(duration);
      expect(
        view.container.querySelector(
          `[data-reservation-type-option="${durationKey}"] [data-reservation-type-discount="meeting-room-sale"]`
        )
      ).not.toBeNull();
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
    getAdvertisedPrice.mockImplementation(() =>
      Promise.resolve(
        pricingAvailable
          ? { data: advertisedPriceResponse }
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
