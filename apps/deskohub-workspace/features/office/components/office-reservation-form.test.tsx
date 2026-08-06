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

  test("offers additional-seat cards up to the office table capacity", () => {
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
      "0",
      "1",
      "2",
    ]);
    expect(view.getByText("No additional seats")).toBeDefined();
    expect(view.getByText("1 additional seat")).toBeDefined();
    expect(view.getByText("2 additional seats")).toBeDefined();
  });

  test("shows the combined access and attendee price in every card", () => {
    const startsOn = decodePlainDate("2099-06-10");
    const endsOn = decodePlainDate("2099-06-10");
    const initialAdvertisedPrices = [0, 1, 2].map((additionalGuests) => {
      const request = getOfficeAdvertisedPriceRequest({
        additionalGuests,
        endsOn,
        locale: "en-US",
        startsOn,
      });
      const quote = Effect.runSync(
        buildOfficeReservationQuote(request.reservation.details)
      );

      return {
        request,
        advertisedPrice: {
          advertisedPriceToken: `office-${additionalGuests}`,
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

    const optionText = (additionalGuests: number) =>
      view.container
        .querySelector(`[data-reservation-type-option="${additionalGuests}"]`)
        ?.textContent?.replaceAll("\u00a0", " ");

    expect(optionText(0)).toContain("CZK 845");
    expect(optionText(1)).toContain("CZK 1,160");
    expect(optionText(2)).toContain("CZK 1,475");
  });
});
