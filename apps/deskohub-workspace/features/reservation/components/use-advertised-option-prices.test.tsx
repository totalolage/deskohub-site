import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  test,
} from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type {
  AdvertisedPriceRequest,
  MeetingRoomAdvertisedPriceRequest,
  PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import { workspaceMeetingRoomProductsByDurationKey } from "@/features/checkout/meeting-room-product-catalog";
import { advertiseMeetingRoom } from "@/features/reservation/advertised-price.test-utils";
import {
  getMeetingRoomDurationAdvertisedPriceRequests,
  meetingRoomDurationOptions,
} from "@/features/reservation/meeting-room-advertised-price";
import { currencyCZK } from "@/shared/money/currencies";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

type AdvertisedPriceActionResult = {
  readonly data?: readonly PreloadedAdvertisedPrice[];
  readonly serverError?: string;
};

const getAdvertisedPrices = mock(
  (
    _requests: ReadonlyArray<AdvertisedPriceRequest>
  ): Promise<AdvertisedPriceActionResult> => new Promise(() => undefined)
);

mock.module("@/features/reservation/actions/get-advertised-price", () => ({
  getAdvertisedPrices,
}));

const { useAdvertisedOptionPrices } = await import(
  "./use-advertised-option-prices"
);

const requests = getMeetingRoomDurationAdvertisedPriceRequests({
  locale: "en-US",
  startDateTime: "2099-07-30T10:00",
});
const [oneHour, fourHours] = requests;
if (!(oneHour && fourHours)) {
  throw new Error("Expected one-hour and four-hour requests");
}

const Harness = ({
  initialAdvertisedPrices,
  selected,
}: {
  readonly initialAdvertisedPrices: ReadonlyArray<PreloadedAdvertisedPrice>;
  readonly selected: MeetingRoomAdvertisedPriceRequest | undefined;
}) => {
  const prices = useAdvertisedOptionPrices({
    family: meetingRoomDurationOptions,
    initialAdvertisedPrices,
    productLabel: "Four hours",
    requests,
    selected,
  });
  const { retry, ...checkout } = prices.checkout;

  return (
    <>
      <output data-testid="checkout">{JSON.stringify(checkout)}</output>
      <button onClick={retry} type="button">
        Retry
      </button>
      <output data-testid="one-hour">
        {JSON.stringify(prices.of(oneHour)?.amount ?? null)}
      </output>
    </>
  );
};

const renderHarness = (
  props: Parameters<typeof Harness>[0],
  queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  })
) =>
  render(
    <QueryClientProvider client={queryClient}>
      <Harness {...props} />
    </QueryClientProvider>
  );

const readCheckout = (view: ReturnType<typeof render>) =>
  JSON.parse(view.getByTestId("checkout").textContent ?? "{}");

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

beforeEach(() => {
  getAdvertisedPrices.mockImplementation(() => new Promise(() => undefined));
});

afterEach(() => {
  cleanup();
  getAdvertisedPrices.mockClear();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

test("hands checkout the selected option's own price", () => {
  const sale = advertiseMeetingRoom(fourHours, {
    saleExpiresAt: "2099-08-01T22:00:00.000Z",
    token: "four-hours",
  });
  const view = renderHarness({
    initialAdvertisedPrices: [
      advertiseMeetingRoom(oneHour, { token: "one-hour" }),
      sale,
    ],
    selected: fourHours,
  });

  expect(readCheckout(view)).toEqual({
    token: "four-hours",
    isFetching: false,
    isError: false,
    sale: {
      discounts: JSON.parse(
        JSON.stringify(sale.advertisedPrice.quote.payment.discounts)
      ),
      productLabel: "Four hours",
    },
    total: {
      amount: currencyCZK(49_000),
      originalAmount: workspaceMeetingRoomProductsByDurationKey["hour:4"].price,
    },
  });
  expect(JSON.parse(view.getByTestId("one-hour").textContent ?? "")).toEqual(
    workspaceMeetingRoomProductsByDurationKey["hour:1"].price
  );
});

test("drops the selected option's price once reloading it fails, and retries it", async () => {
  getAdvertisedPrices.mockImplementation(() =>
    Promise.resolve({ serverError: "advertised price failed" })
  );
  const view = renderHarness({
    initialAdvertisedPrices: [
      advertiseMeetingRoom(fourHours, { token: "four-hours" }),
    ],
    selected: fourHours,
  });
  expect(readCheckout(view).token).toBe("four-hours");

  // The failed reload keeps the old price in the cache but not for checkout.
  fireEvent.click(view.getByRole("button", { name: "Retry" }));
  await waitFor(
    () =>
      expect(readCheckout(view)).toEqual({ isFetching: false, isError: true }),
    { timeout: 5000 }
  );
  const failedLoads = getAdvertisedPrices.mock.calls.length;

  getAdvertisedPrices.mockImplementation((batch) =>
    Promise.resolve({
      data: batch.map((request) =>
        advertiseMeetingRoom(request as MeetingRoomAdvertisedPriceRequest, {
          token: "retried",
        })
      ),
    })
  );
  fireEvent.click(view.getByRole("button", { name: "Retry" }));

  await waitFor(() => expect(readCheckout(view).token).toBe("retried"));
  expect(getAdvertisedPrices.mock.calls.length).toBeGreaterThan(failedLoads);
});

test("hands checkout nothing to submit when no option is selected", () => {
  const view = renderHarness({
    initialAdvertisedPrices: [advertiseMeetingRoom(fourHours)],
    selected: undefined,
  });

  expect(readCheckout(view)).toEqual({ isFetching: false, isError: false });
});

test("selects by the whole request, not the same object or its duration", () => {
  const initialAdvertisedPrices = [
    advertiseMeetingRoom(fourHours, { token: "four-hours" }),
  ];
  const sameRequest = renderHarness({
    initialAdvertisedPrices,
    selected: structuredClone(fourHours),
  });
  expect(readCheckout(sameRequest).token).toBe("four-hours");
  cleanup();

  const [nextDayFourHours] = getMeetingRoomDurationAdvertisedPriceRequests({
    locale: "en-US",
    startDateTime: "2099-07-31T10:00",
  }).slice(1);
  if (!nextDayFourHours) throw new Error("Expected a four-hour request");
  const otherDate = renderHarness({
    initialAdvertisedPrices: [
      ...initialAdvertisedPrices,
      advertiseMeetingRoom(nextDayFourHours, { token: "next-day" }),
    ],
    selected: nextDayFourHours,
  });

  // A request outside the form's options has no price, status or retry.
  expect(readCheckout(otherDate)).toEqual({
    isFetching: false,
    isError: false,
  });
  fireEvent.click(otherDate.getByRole("button", { name: "Retry" }));
  expect(getAdvertisedPrices).not.toHaveBeenCalled();
});
