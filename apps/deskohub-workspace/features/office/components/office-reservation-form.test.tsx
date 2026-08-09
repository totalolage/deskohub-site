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
import { cleanup, render } from "@testing-library/react";
import { Effect, Schema } from "effect";
import { getOfficeCheckoutSummary } from "@/features/checkout/checkout-summary-office";
import { buildOfficeReservationQuote } from "@/features/checkout/reservation-quote-office";
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

mock.module("@/features/cookie-consent", () => ({
  useCookieConsent: () => ({ isAccepted: () => false }),
}));

mock.module("@/features/reservation/actions/get-advertised-price", () => ({
  getAdvertisedPrices: () => Promise.resolve({ data: [] }),
}));

const { OfficeReservationForm } = await import("./office-reservation-form");

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

  afterEach(() => {
    cleanup();
    execute.mockClear();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("renders the date range as an accessible field group", () => {
    const queryClient = new QueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <OfficeReservationForm
          seatCapacity={3}
          initialValues={officeReservationDefaultValues}
          locale="en-US"
        />
      </QueryClientProvider>
    );

    expect(
      view.getByRole("group", { name: "Reservation dates" })
    ).toBeDefined();
  });

  test("shows the catalog-quoted base amount between dates and seats", () => {
    const startsOn = decodePlainDate("2099-06-10");
    const endsOn = decodePlainDate("2099-06-12");
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
            endsOn,
          }}
          locale="en-US"
        />
      </QueryClientProvider>
    );

    const dateRange = view.getByRole("group", { name: "Reservation dates" });
    const basePrice = view.container.querySelector("[data-office-base-price]");
    const seatLabel = view.getByText("How many office seats do you need?");

    expect(basePrice).not.toBeNull();
    if (!basePrice) throw new Error("Expected the office base price");
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
    const queryClient = new QueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <OfficeReservationForm
          seatCapacity={3}
          initialValues={officeReservationDefaultValues}
          locale="en-US"
        />
      </QueryClientProvider>
    );

    expect(view.queryByText(/CZK/)).toBeNull();
    expect(
      view.container.querySelector("[data-office-base-price]")?.textContent
    ).toBe("Private office");
  });

  test("offers total-seat cards up to the office table capacity", () => {
    const queryClient = new QueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <OfficeReservationForm
          seatCapacity={3}
          initialValues={officeReservationDefaultValues}
          locale="en-US"
        />
      </QueryClientProvider>
    );

    expect(view.queryByRole("spinbutton")).toBeNull();
    expect(view.getAllByRole("radio").map(({ value }) => value)).toEqual([
      "1",
      "2",
      "3",
    ]);
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
        />
      </QueryClientProvider>
    );

    const options = Array.from(
      view.container.querySelectorAll("[data-reservation-type-option]")
    );

    expect(options).toHaveLength(6);
    expect(
      options.every((option) => option.classList.contains("lg:grid-rows-none"))
    ).toBeTrue();
    expect(
      options.some((option) =>
        option.classList.contains("lg:grid-rows-subgrid")
      )
    ).toBeFalse();
  });

  test("marks every card with its seat surcharge", () => {
    const startsOn = decodePlainDate("2099-06-10");
    const endsOn = decodePlainDate("2099-06-10");
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
            endsOn,
          }}
          locale="en-US"
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
});
