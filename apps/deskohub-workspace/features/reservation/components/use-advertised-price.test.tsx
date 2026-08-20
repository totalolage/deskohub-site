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
import { cleanup, render, waitFor } from "@testing-library/react";
import {
  type AdvertisedPrice,
  type AdvertisedPriceRequest,
  advertisedPriceRequestBatchSize,
  type PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
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

const { useAdvertisedPrices } = await import("./use-advertised-price");

const requests = Array.from({ length: 17 }, (_, index) => ({
  locale: "en-US",
  reservation: {
    kind: "meeting-room",
    details: {
      kind: "meeting-room",
      duration: { amount: 1, unit: "hour" },
      reservationDate: `2099-07-${String(index + 1).padStart(2, "0")}`,
    },
  },
})) satisfies ReadonlyArray<AdvertisedPriceRequest>;

const BatchHarness = () => {
  const results = useAdvertisedPrices(requests);
  return requests.map((request, index) => (
    <output
      data-testid={`advertised-price-${index}`}
      key={request.reservation.details.reservationDate}
    >
      {results[index]?.status}
    </output>
  ));
};

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

afterAll(() => {
  unregisterWorkspaceComponentTestEnv();
});

test("splits coalesced advertised prices into server-sized batches", async () => {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <BatchHarness />
    </QueryClientProvider>
  );

  await waitFor(() => expect(getAdvertisedPrices).toHaveBeenCalledTimes(2));
  expect(
    getAdvertisedPrices.mock.calls.map(([batch]) => batch.length).toSorted()
  ).toEqual([1, advertisedPriceRequestBatchSize]);
});

test("keeps a successful advertised-price batch independent from a failed sibling", async () => {
  getAdvertisedPrices.mockImplementation((batch) =>
    batch.length > 1
      ? Promise.resolve({ serverError: "advertised price batch failed" })
      : Promise.resolve({
          data: batch.map((request) => ({
            request,
            advertisedPrice: {} as AdvertisedPrice,
          })),
        })
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <BatchHarness />
    </QueryClientProvider>
  );

  await waitFor(
    () => {
      expect(view.getByTestId("advertised-price-0").textContent).toBe("error");
      expect(view.getByTestId("advertised-price-16").textContent).toBe(
        "success"
      );
    },
    { timeout: 5000 }
  );
});
