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
import { Effect, Schema } from "effect";
import type { ComponentProps } from "react";
import { getOfficeCheckoutSummary } from "@/features/checkout/checkout-summary-office";
import { buildOfficeReservationQuote } from "@/features/checkout/reservation-quote-office";
import { workspaceMoneyWithValue } from "@/features/checkout/workspace-money";
import { discountIdSchema } from "@/features/discounts";
import { mockReservationCheckoutStep } from "@/features/reservation/components/reservation-checkout-step.test-utils";
import { mockCheckoutEmailVerification } from "@/features/reservation/components/use-checkout-email-verification.test-utils";
import { getOfficeAdvertisedPriceRequest } from "@/features/reservation/office-advertised-price";
import { officeReservationDefaultValues } from "@/features/reservation/office-reservation";
import { getOfficeAvailabilityQuery } from "@/features/reservation/workspace-availability";
import {
  workspaceUseAction,
  workspaceUseSearchParams,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { plainDateStringSchema } from "@/shared/utils/temporal";

// React DOM detects input events when it loads, so the DOM must exist before
// it is imported for typed text to reach the form.
registerWorkspaceComponentTestEnv();

const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);

const executeAsync = mock(() => Promise.resolve({}));
const decodePlainDate = Schema.decodeUnknownSync(plainDateStringSchema);
const originalFetch = globalThis.fetch;

mock.module("@/features/cookie-consent", () => ({
  useCookieConsent: () => ({ isAccepted: () => false }),
}));

mock.module("@/features/reservation/actions/get-advertised-price", () => ({
  getAdvertisedPrices: () => Promise.resolve({ data: [] }),
}));

mockCheckoutEmailVerification();
mockReservationCheckoutStep();

const {
  OfficeReservationForm,
  OfficeReservationFormFallback,
  officeSeatOptionsFallbackCount,
} = await import("./office-reservation-form");

const officeAvailabilityResponse = ({
  from,
  to,
  unavailableDates = [],
}: {
  readonly from: string;
  readonly to: string;
  readonly unavailableDates?: readonly string[];
}) =>
  new Response(
    JSON.stringify({
      from,
      to,
      unavailableDates,
      reservedDeskWorkstationRequiredDates: [],
      unavailableCoworkTiers: [],
      meetingRoomUnavailable: false,
      officeUnavailable: false,
      unavailableMonitorOptions: [],
      notices: [],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );

const renderOfficeForm = (
  props: Partial<ComponentProps<typeof OfficeReservationForm>> &
    Pick<ComponentProps<typeof OfficeReservationForm>, "today">,
  queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  })
) =>
  render(
    <QueryClientProvider client={queryClient}>
      <OfficeReservationForm
        checkoutCustomer={{ status: "signed-out" }}
        seatCapacity={3}
        initialValues={officeReservationDefaultValues}
        locale="en-US"
        {...props}
      />
    </QueryClientProvider>
  );

describe("OfficeReservationForm", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    workspaceUseSearchParams.mockReturnValue(new URLSearchParams());
    workspaceUseAction.mockReturnValue({
      executeAsync,
      isExecuting: false,
      result: {},
    });
  });

  afterEach(async () => {
    cleanup();
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    executeAsync.mockClear();
    globalThis.fetch = originalFetch;
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("loads the month calendar without seat or interval filters and bounds the stay before an unavailable date", async () => {
    const today = decodePlainDate("2026-08-10");
    const requests: URL[] = [];
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = new URL(String(request), "https://workspace.example.test");
      requests.push(url);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            date: undefined,
            from: "2026-08-10",
            to: "2026-09-10",
            unavailableDates: ["2026-08-12"],
            reservedDeskWorkstationRequiredDates: [],
            unavailableCoworkTiers: [],
            meetingRoomUnavailable: false,
            officeUnavailable: false,
            unavailableMonitorOptions: [],
            notices: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    }) as typeof fetch;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <OfficeReservationForm
          checkoutCustomer={{ status: "signed-out" }}
          seatCapacity={3}
          initialValues={{
            ...officeReservationDefaultValues,
            startsOn: today,
            dayCount: 2,
          }}
          locale="en-US"
          today={today}
        />
      </QueryClientProvider>
    );

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toEqual({
      kind: "office",
      from: "2026-08-10",
      to: "2026-09-10",
    });

    await waitFor(() => {
      expect(
        view.getByRole<HTMLInputElement>("spinbutton", {
          name: "Number of days",
        }).max
      ).toBe("2");
    });
    expect(view.queryByText(/days from this start date/i)).toBeNull();
  });

  test("bounds the stay from page-loaded availability without a client request", () => {
    const today = decodePlainDate("2026-08-10");
    const fetchCalls = mock((_request: RequestInfo | URL) =>
      Promise.resolve(
        officeAvailabilityResponse({ from: today, to: "2026-09-10" })
      )
    );
    globalThis.fetch = fetchCalls as typeof fetch;
    const query = getOfficeAvailabilityQuery(today);

    const view = renderOfficeForm({
      initialAvailability: [
        {
          query,
          availability: {
            from: query.from,
            to: query.to,
            unavailableDates: ["2026-08-12"],
            reservedDeskWorkstationRequiredDates: [],
            unavailableCoworkTiers: [],
            meetingRoomUnavailable: false,
            officeUnavailable: false,
            unavailableMonitorOptions: [],
            notices: [],
          },
          loadedAt: Date.now(),
        },
      ],
      initialValues: {
        ...officeReservationDefaultValues,
        startsOn: today,
        dayCount: 2,
      },
      today,
    });

    expect(
      view.getByRole<HTMLInputElement>("spinbutton", {
        name: "Number of days",
      }).max
    ).toBe("2");
    expect(fetchCalls).not.toHaveBeenCalled();
  });

  test("shows the catalog-quoted base amount between dates and seats", () => {
    const startsOn = decodePlainDate("2026-08-10");
    const endsOn = decodePlainDate("2026-08-12");
    const initialAdvertisedPrices = [1, 2, 3].map((seats) => {
      const request = getOfficeAdvertisedPriceRequest({
        endsOn,
        locale: "en-US",
        seats,
        startsOn,
      });
      const quote = Effect.runSync(
        buildOfficeReservationQuote(request.reservation.details)
      );

      return {
        request,
        advertisedPrice: {
          advertisedPriceToken: `office-${seats}`,
          kind: "office" as const,
          quote,
          summary: getOfficeCheckoutSummary(quote),
        },
      };
    });
    const queryClient = new QueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <OfficeReservationForm
          checkoutCustomer={{ status: "signed-out" }}
          seatCapacity={3}
          initialAdvertisedPrices={initialAdvertisedPrices}
          initialValues={{
            ...officeReservationDefaultValues,
            startsOn,
            dayCount: 3,
          }}
          locale="en-US"
          today={startsOn}
        />
      </QueryClientProvider>
    );

    const dateRange = view.getByRole("group", { name: "Reservation dates" });
    const basePrice = view.container.querySelector("[data-office-base-price]");
    const seatLabel = view.getByText("How many office seats do you need?");

    expect(basePrice).not.toBeNull();
    if (!basePrice) throw new Error("Expected the office base price");
    expect(basePrice.textContent).toContain("Private office - 3 days");
    expect(basePrice.textContent?.replaceAll("\u00a0", " ")).toContain(
      "CZK 1,590"
    );
    expect(
      dateRange.compareDocumentPosition(basePrice) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0);
    expect(
      basePrice.compareDocumentPosition(seatLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0);
  });

  test("does not render office prices before an advertised quote is available", () => {
    const date = decodePlainDate("2026-08-10");
    const queryClient = new QueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <OfficeReservationForm
          checkoutCustomer={{ status: "signed-out" }}
          seatCapacity={3}
          initialValues={{
            ...officeReservationDefaultValues,
            startsOn: date,
          }}
          locale="en-US"
          today={date}
        />
      </QueryClientProvider>
    );

    expect(view.queryByText(/CZK/)).toBeNull();
    expect(
      view.container.querySelector("[data-office-base-price]")?.textContent
    ).toBe("Private office - 1 day");
  });

  test("offers total-seat cards up to the office table capacity", () => {
    const queryClient = new QueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <OfficeReservationForm
          checkoutCustomer={{ status: "signed-out" }}
          seatCapacity={3}
          initialValues={officeReservationDefaultValues}
          locale="en-US"
          today={decodePlainDate("2026-08-10")}
        />
      </QueryClientProvider>
    );

    expect(
      view.getByRole("spinbutton", { name: "Number of days" })
    ).toBeDefined();
    expect(
      view.container.querySelector('input[name="seats"][type="number"]')
    ).toBeNull();
    expect(
      Array.from(
        view.container.querySelectorAll<HTMLInputElement>(
          'input[name="seats"][type="radio"]'
        ),
        ({ value }) => value
      )
    ).toEqual(["1", "2", "3"]);
    expect(view.getByText("How many office seats do you need?")).toBeDefined();
    expect(view.getByText("1 seat")).toBeDefined();
    expect(view.getByText("2 seats")).toBeDefined();
    expect(view.getByText("3 seats")).toBeDefined();
    expect(view.queryByText(/additional seat/i)).toBeNull();
    expect(view.queryByText(/already included/i)).toBeNull();
  });

  test("mirrors the wrapping seat cards in the loading fallback", () => {
    const queryClient = new QueryClient();
    const form = render(
      <QueryClientProvider client={queryClient}>
        <OfficeReservationForm
          checkoutCustomer={{ status: "signed-out" }}
          seatCapacity={officeSeatOptionsFallbackCount}
          initialValues={officeReservationDefaultValues}
          locale="en-US"
          today={decodePlainDate("2026-08-10")}
        />
      </QueryClientProvider>
    );
    const formOptions = Array.from(
      form.container.querySelectorAll("[data-reservation-type-option]")
    );
    const fallback = render(<OfficeReservationFormFallback locale="en-US" />);
    const fallbackOptions = Array.from(
      fallback.container.querySelectorAll("[data-office-seat-option-fallback]")
    );
    const layoutClasses = (element: Element | null | undefined) =>
      Array.from(element?.classList ?? []).filter((name) =>
        /^(lg:)?(flex|grid|gap|space|px|pb|rounded|row|basis)/.test(name)
      );

    expect(fallbackOptions).toHaveLength(officeSeatOptionsFallbackCount);
    expect(layoutClasses(fallbackOptions[0]?.parentElement)).toEqual(
      layoutClasses(formOptions[0]?.parentElement)
    );
    for (const option of fallbackOptions) {
      expect(layoutClasses(option)).toEqual(layoutClasses(formOptions[0]));
    }
  });

  test("marks every card with its seat surcharge", () => {
    const startsOn = decodePlainDate("2026-08-10");
    const initialAdvertisedPrices = [1, 2, 3].map((seats) => {
      const request = getOfficeAdvertisedPriceRequest({
        endsOn: startsOn,
        locale: "en-US",
        seats,
        startsOn,
      });
      const quote = Effect.runSync(
        buildOfficeReservationQuote(request.reservation.details)
      );

      return {
        request,
        advertisedPrice: {
          advertisedPriceToken: `office-${seats}`,
          kind: "office" as const,
          quote,
          summary: getOfficeCheckoutSummary(quote),
        },
      };
    });
    const queryClient = new QueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <OfficeReservationForm
          checkoutCustomer={{ status: "signed-out" }}
          seatCapacity={3}
          initialAdvertisedPrices={initialAdvertisedPrices}
          initialValues={{
            ...officeReservationDefaultValues,
            startsOn,
          }}
          locale="en-US"
          today={startsOn}
        />
      </QueryClientProvider>
    );

    const optionText = (seats: number) =>
      view.container
        .querySelector(`[data-reservation-type-option="${seats}"]`)
        ?.textContent?.replaceAll("\u00a0", " ");

    expect(optionText(1)).toContain("CZK 315");
    expect(optionText(2)).toContain("CZK 630");
    expect(optionText(3)).toContain("CZK 945");
    expect(optionText(1)).not.toContain("CZK 845");
  });

  test("presents a quoted office sale around the form, not the seat cards", () => {
    const startsOn = decodePlainDate("2026-08-10");
    const initialAdvertisedPrices = [1, 2, 3].map((seats) => {
      const request = getOfficeAdvertisedPriceRequest({
        endsOn: startsOn,
        locale: "en-US",
        seats,
        startsOn,
      });
      const undiscountedQuote = Effect.runSync(
        buildOfficeReservationQuote(request.reservation.details)
      );
      const amount = undiscountedQuote.payment.expectedPrice;
      const discountedAmount = workspaceMoneyWithValue(
        amount.value / 2,
        amount
      );
      const quote = Effect.runSync(
        buildOfficeReservationQuote(request.reservation.details, {
          discountQuote: {
            product: { kind: "office", seats, dayCount: 1 },
            discountableSubtotal: amount,
            discounts: [
              {
                discount: {
                  id: Schema.decodeUnknownSync(discountIdSchema)("office-sale"),
                  label: "Office sale",
                  adjustment: { kind: "percentage", basisPoints: 5000 },
                },
                subtotalBefore: amount,
                amount: discountedAmount,
                subtotalAfter: discountedAmount,
              },
            ],
            totalDiscount: discountedAmount,
            discountedSubtotal: discountedAmount,
          },
        })
      );

      return {
        request,
        advertisedPrice: {
          advertisedPriceToken: `office-sale-${seats}`,
          kind: "office" as const,
          quote,
          summary: getOfficeCheckoutSummary(quote),
        },
      };
    });
    const queryClient = new QueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <OfficeReservationForm
          checkoutCustomer={{ status: "signed-out" }}
          seatCapacity={3}
          initialAdvertisedPrices={initialAdvertisedPrices}
          initialValues={{
            ...officeReservationDefaultValues,
            startsOn,
          }}
          locale="en-US"
          today={startsOn}
        />
      </QueryClientProvider>
    );

    const saleCard = view.container.querySelector(
      '[data-reservation-sale="active"]'
    );
    expect(
      saleCard?.querySelectorAll(
        '[data-reservation-sale-discount="office-sale"]'
      )
    ).toHaveLength(1);
    expect(
      view.container.querySelectorAll("[data-reservation-sale-banner]")
    ).toHaveLength(1);
    expect(
      view.getByRole("button", { name: /discount.*private office/i })
    ).toBeDefined();
    for (const option of view.container.querySelectorAll(
      "[data-reservation-type-option]"
    )) {
      expect(option.querySelector("[data-reservation-sale-banner]")).toBeNull();
    }
  });

  test("hides a stale office quote once its background refresh fails", async () => {
    const startsOn = decodePlainDate("2026-08-10");
    const initialAdvertisedPrices = [1, 2, 3].map((seats) => {
      const request = getOfficeAdvertisedPriceRequest({
        endsOn: startsOn,
        locale: "en-US",
        seats,
        startsOn,
      });
      const quote = Effect.runSync(
        buildOfficeReservationQuote(request.reservation.details)
      );

      return {
        request,
        advertisedPrice: {
          advertisedPriceToken: `office-${seats}`,
          kind: "office" as const,
          quote,
          summary: getOfficeCheckoutSummary(quote),
        },
      };
    });
    globalThis.fetch = mock(() =>
      Promise.resolve(
        officeAvailabilityResponse({ from: "2026-08-10", to: "2026-09-10" })
      )
    ) as typeof fetch;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    });
    const view = renderOfficeForm(
      {
        initialAdvertisedPrices,
        initialValues: { ...officeReservationDefaultValues, startsOn },
        today: startsOn,
      },
      queryClient
    );
    const seatOptionText = () =>
      view.container
        .querySelector('[data-reservation-type-option="1"]')
        ?.textContent?.replaceAll(" ", " ");
    expect(seatOptionText()).toContain("CZK 315");

    await act(async () => {
      await queryClient.refetchQueries({
        predicate: (query) => query.state.data !== undefined,
      });
    });

    await view.findByText(/current price could not be loaded/i);
    expect(seatOptionText()).not.toContain("CZK 315");
    expect(
      view.container.querySelector("[data-office-base-price]")?.textContent
    ).not.toContain("CZK");
  });

  test("validates an empty start date when its calendar closes", async () => {
    const today = decodePlainDate("2026-08-10");
    globalThis.fetch = mock(() =>
      Promise.resolve(
        officeAvailabilityResponse({ from: "2026-08-10", to: "2026-09-10" })
      )
    ) as typeof fetch;
    const view = renderOfficeForm({
      initialValues: officeReservationDefaultValues,
      today,
    });
    const startDate = view.getByRole("combobox", {
      name: /^Office reservation start date/,
    });
    const calendarButton = view.getByRole("button", {
      name: /^Office reservation start date/,
    });
    expect(startDate.getAttribute("aria-invalid")).toBe("false");

    await act(async () => fireEvent.click(calendarButton));
    await act(async () => fireEvent.click(calendarButton));
    await act(async () => {});

    expect(startDate.getAttribute("aria-invalid")).toBe("true");
    expect(executeAsync).not.toHaveBeenCalled();
  });

  test("keeps a typed unavailable start date out of the form", async () => {
    const today = decodePlainDate("2026-08-10");
    globalThis.fetch = mock(() =>
      Promise.resolve(
        officeAvailabilityResponse({
          from: "2026-08-10",
          to: "2026-09-10",
          unavailableDates: ["2026-08-12"],
        })
      )
    );

    const view = renderOfficeForm({
      initialValues: { ...officeReservationDefaultValues, startsOn: today },
      today,
    });
    const startDate = view.getByRole<HTMLInputElement>("combobox", {
      name: /^Office reservation start date/,
    });
    const startsOn = () =>
      view.container.querySelector<HTMLInputElement>('input[name="startsOn"]')
        ?.value;
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await act(async () => {});
    expect(startDate.value).toBe("8/10/2026");

    await act(async () => {
      fireEvent.change(startDate, { target: { value: "8/12/2026" } });
      fireEvent.focusOut(startDate);
    });

    expect(startsOn()).toBe("");
    expect(startDate.value).toBe("8/12/2026");
    expect(startDate.getAttribute("aria-invalid")).toBe("true");
    expect(
      view.getByText("August 12, 2026 isn't available. Choose another date.")
    ).not.toBeNull();

    const form = startDate.closest("form");
    if (!form) throw new Error("the start date is outside the form");
    await act(async () => fireEvent.submit(form));
    await act(async () => {});

    expect(executeAsync).not.toHaveBeenCalled();
    expect(startsOn()).toBe("");

    await act(async () => {
      fireEvent.change(startDate, { target: { value: "2026-08-11" } });
      fireEvent.focusOut(startDate);
    });
    expect(startsOn()).toBe("2026-08-11");
    expect(startDate.value).toBe("8/11/2026");
  });
});
