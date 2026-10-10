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
import { Effect, Schema } from "effect";
import type { ComponentProps } from "react";
import { getOfficeCheckoutSummary } from "@/features/checkout/checkout-summary-office";
import { buildOfficeReservationQuote } from "@/features/checkout/reservation-quote-office";
import { workspaceMoneyWithValue } from "@/features/checkout/workspace-money";
import { discountIdSchema } from "@/features/discounts";
import { m } from "@/features/i18n";
import { getOfficeAdvertisedPriceRequest } from "@/features/reservation/office-advertised-price";
import { officeReservationDefaultValues } from "@/features/reservation/office-reservation";
import {
  workspaceUseAction,
  workspaceUseSearchParams,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { plainDateStringSchema } from "@/shared/utils/temporal";

const execute = mock(() => undefined);
const decodePlainDate = Schema.decodeUnknownSync(plainDateStringSchema);
const originalFetch = globalThis.fetch;

mock.module("@/features/cookie-consent", () => ({
  useCookieConsent: () => ({ isAccepted: () => false }),
}));

mock.module("@/features/reservation/actions/get-advertised-price", () => ({
  getAdvertisedPrices: () => Promise.resolve({ data: [] }),
}));

const { OfficeReservationForm } = await import("./office-reservation-form");

const officeAvailabilityResponse = ({
  from,
  to,
}: {
  readonly from: string;
  readonly to: string;
}) =>
  new Response(
    JSON.stringify({
      from,
      to,
      unavailableDates: [],
      reservedDeskWorkstationRequiredDates: [],
      unavailableCoworkTiers: [],
      meetingRoomUnavailable: false,
      officeUnavailable: false,
      unavailableMonitorOptions: [],
      notices: [],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );

// React DOM picks its change-event strategy when it loads. When it loads before
// happy-dom registers, it falls back to the legacy IE input polyfill, which
// watches the focused element through attachEvent and compares values on keyup.
// Dispatching both paths reaches the controlled input's onChange either way.
const typeIntoInput = (input: HTMLInputElement, value: string) => {
  Object.assign(input, {
    attachEvent: () => undefined,
    detachEvent: () => undefined,
  });
  fireEvent.focusIn(input);
  Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input),
    "value"
  )?.set?.call(input, value);
  fireEvent.input(input);
  fireEvent.keyUp(input);
};

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
      execute,
      isExecuting: false,
      result: {},
    });
  });

  afterEach(async () => {
    cleanup();
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    execute.mockClear();
    globalThis.fetch = originalFetch;
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("renders one start date and a day-count input", () => {
    const queryClient = new QueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <OfficeReservationForm
          seatCapacity={3}
          initialValues={officeReservationDefaultValues}
          locale="en-US"
          today={decodePlainDate("2026-08-10")}
        />
      </QueryClientProvider>
    );

    expect(
      view.getByRole("group", { name: "Reservation dates" })
    ).toBeDefined();
    expect(
      view.getByRole("button", { name: /^Office reservation start date/ })
    ).toBeDefined();
    expect(
      view.queryByRole("button", { name: "Office reservation end date" })
    ).toBeNull();
    expect(
      view.getByRole<HTMLInputElement>("spinbutton", {
        name: "Number of days",
      }).value
    ).toBe("1");
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

  test("describes office unavailability without suggesting a seat change", () => {
    expect(m.reservationOfficeUnavailable({}, { locale: "en-US" })).toBe(
      "The office is not available for all the selected days. Try another start date or a shorter stay."
    );
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

  test("keeps every card on self-contained rows when the seat options wrap", () => {
    const queryClient = new QueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <OfficeReservationForm
          seatCapacity={6}
          initialValues={officeReservationDefaultValues}
          locale="en-US"
          today={decodePlainDate("2026-08-10")}
        />
      </QueryClientProvider>
    );

    const options = Array.from(
      view.container.querySelectorAll("[data-reservation-type-option]")
    );
    const optionsContainer = options[0]?.parentElement;

    expect(options).toHaveLength(6);
    expect(optionsContainer?.classList.contains("flex")).toBeTrue();
    expect(optionsContainer?.classList.contains("flex-wrap")).toBeTrue();
    expect(
      options.every((option) => option.classList.contains("lg:grid-rows-none"))
    ).toBeTrue();
    expect(
      options.some((option) =>
        option.classList.contains("lg:grid-rows-subgrid")
      )
    ).toBeFalse();
  });

  test("lets flexbox balance any number of seat options", () => {
    const queryClient = new QueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <OfficeReservationForm
          seatCapacity={5}
          initialValues={officeReservationDefaultValues}
          locale="en-US"
          today={decodePlainDate("2026-08-10")}
        />
      </QueryClientProvider>
    );

    const options = Array.from(
      view.container.querySelectorAll("[data-reservation-type-option]")
    );

    expect(options).toHaveLength(5);
    expect(
      options.every((option) => option.classList.contains("flex-[1_1_13rem]"))
    ).toBeTrue();
    expect(
      options.some((option) => option.className.includes("basis-[calc("))
    ).toBeFalse();
  });

  test("lets the day-count input fill its date-range column", () => {
    const queryClient = new QueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <OfficeReservationForm
          seatCapacity={3}
          initialValues={officeReservationDefaultValues}
          locale="en-US"
          today={decodePlainDate("2026-08-10")}
        />
      </QueryClientProvider>
    );

    const dayCount = view.getByRole("spinbutton", {
      name: "Number of days",
    });

    expect(dayCount.classList.contains("w-full")).toBeTrue();
    expect(dayCount.classList.contains("w-28")).toBeFalse();
  });

  test("marks every card with its seat surcharge", () => {
    const startsOn = decodePlainDate("2026-08-10");
    const endsOn = startsOn;
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
    expect(
      view.container
        .querySelector('[data-reservation-type-price="1"] span')
        ?.classList.contains("before:content-['+']")
    ).toBeTrue();
  });

  test("presents a quoted office sale around the form, not the seat cards", () => {
    const startsOn = decodePlainDate("2026-08-10");
    const endsOn = startsOn;
    const initialAdvertisedPrices = [1, 2, 3].map((seats) => {
      const request = getOfficeAdvertisedPriceRequest({
        endsOn,
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

    expect(
      view.container.querySelector('[data-reservation-sale="active"]')
        ?.className
    ).toContain("glow-border-purple-300");
    expect(
      view.container.querySelectorAll(
        '[data-reservation-sale-discount="office-sale"]'
      )
    ).toHaveLength(1);
    expect(
      view.getByRole("button", { name: /discount.*private office/i })
    ).toBeDefined();
    for (const option of view.container.querySelectorAll(
      "[data-reservation-type-option]"
    )) {
      expect(option.className).not.toContain("glow-border");
    }
  });

  test("lets the day count be cleared and retyped before normalizing it on blur", async () => {
    const today = decodePlainDate("2026-08-10");
    globalThis.fetch = mock(() =>
      Promise.resolve(
        officeAvailabilityResponse({ from: "2026-08-10", to: "2026-09-10" })
      )
    ) as typeof fetch;
    const view = renderOfficeForm({
      initialValues: {
        ...officeReservationDefaultValues,
        startsOn: today,
        dayCount: 2,
      },
      today,
    });
    const dayCount = view.getByRole<HTMLInputElement>("spinbutton", {
      name: "Number of days",
    });
    await waitFor(() => {
      expect(Number(dayCount.max)).toBeGreaterThan(5);
    });

    act(() => {
      typeIntoInput(dayCount, "");
    });
    expect(dayCount.value).toBe("");

    act(() => {
      typeIntoInput(dayCount, "5");
    });
    expect(dayCount.value).toBe("5");

    act(() => {
      typeIntoInput(dayCount, "");
    });
    act(() => {
      fireEvent.blur(dayCount);
    });
    expect(dayCount.value).toBe("5");

    act(() => {
      typeIntoInput(dayCount, "500");
    });
    act(() => {
      fireEvent.blur(dayCount);
    });
    expect(dayCount.value).toBe(dayCount.max);
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

  test("blocks checkout with an availability error when the calendar cannot be loaded", async () => {
    const today = decodePlainDate("2026-08-10");
    let availabilityRequestCount = 0;
    globalThis.fetch = mock(() => {
      availabilityRequestCount += 1;
      return Promise.reject(new Error("Availability failed"));
    }) as typeof fetch;
    const view = renderOfficeForm({
      initialValues: { ...officeReservationDefaultValues, startsOn: today },
      today,
    });

    expect(
      await view.findByText(
        "We couldn't confirm availability. Please try again."
      )
    ).toBeDefined();
    expect(availabilityRequestCount).toBe(4);
    expect(
      view.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
    ).toBe(true);
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
    const startDate = view.getByRole("button", {
      name: /^Office reservation start date/,
    });
    expect(startDate.getAttribute("aria-invalid")).toBe("false");

    await act(async () => fireEvent.click(startDate));
    await act(async () => fireEvent.click(startDate));
    await act(async () => {});

    expect(startDate.getAttribute("aria-invalid")).toBe("true");
    expect(execute).not.toHaveBeenCalled();
  });
});
