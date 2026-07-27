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
import { getMeetingRoomCheckoutSummary } from "@/features/checkout/checkout-summary-meeting-room";
import { discountIdSchema } from "@/features/discounts/contracts";
import { normalizedMeetingRoomReservationOrderSchema } from "@/features/reservation/meeting-room-reservation";
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
      amount: money(30_000),
    },
  ] as const,
  payment: {
    expectedPrice: money(30_000),
    undiscountedPrice: money(30_000),
    discounts: [],
  },
};

const advertisedPriceResponse = {
  kind: "meeting-room" as const,
  quote: meetingRoomQuote,
  summary: getMeetingRoomCheckoutSummary(meetingRoomQuote),
  advertisedPriceToken: "sealed-advertised-price",
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

const renderForm = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MeetingRoomReservationForm
        checkoutSessionId="restored-checkout-session"
        initialReservation={initialReservation}
        locale="en-US"
      />
    </QueryClientProvider>
  );
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
    const durationInputs = [60, 240, 1440].map(
      (duration) =>
        view.container.querySelector(
          `#meeting-room-duration-${duration}`
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
          startsAt: "2099-07-30T08:00:00Z",
          endsAt: "2099-07-30T09:00:00Z",
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
        'input[type="radio"][value="240"]'
      ) as HTMLInputElement
    );
    await waitFor(() => {
      expect(getAdvertisedPrice).toHaveBeenCalledTimes(2);
      expect(continueButton.hasAttribute("disabled")).toBe(false);
      expect(durationInputs[1]?.checked).toBe(true);
      expect(getAdvertisedPrice).toHaveBeenLastCalledWith({
        locale: "en-US",
        reservation: {
          kind: "meeting-room",
          details: {
            kind: "meeting-room",
            startsAt: "2099-07-30T08:00:00Z",
            endsAt: "2099-07-30T12:00:00Z",
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

  test("renders the selected advertised discount without adding a price card", async () => {
    const discountedQuote = {
      ...advertisedPriceResponse.quote,
      payment: {
        expectedPrice: money(15_000),
        undiscountedPrice: money(30_000),
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
            subtotalBefore: money(30_000),
            amount: money(15_000),
            subtotalAfter: money(15_000),
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
      await view.findByText(/original price.*300/i, {}, { timeout: 3000 })
    ).toBeDefined();
    expect(view.getByText(/discounted price.*150/i)).toBeDefined();
    expect(
      view.getByRole("button", { name: /discount.*meeting room.*1 hour/i })
    ).toBeDefined();
    const discountedOption = view.container.querySelector(
      '[data-reservation-type-option="60"]'
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
