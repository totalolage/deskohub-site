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
import {
  buildCoworkCheckoutSummary,
  buildCoworkReservationQuote,
} from "@/features/checkout/checkout-quote.test-utils";
import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import { discountIdSchema } from "@/features/discounts/contracts";
import { getCoworkTierAdvertisedPriceRequests } from "@/features/reservation/cowork-advertised-price";
import { coworkReservationDefaultValues } from "@/features/reservation/cowork-reservation";
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

const { CoworkReservationForm } = await import("./cowork-reservation-form");

const money = (value: number) => ({
  value,
  exponent: 2,
  currency: "CZK",
});

const basicDiscountedQuote = buildCoworkReservationQuote(
  {
    entryTier: "open-space",
    coffee: true,
    date: "2099-07-30",
  },
  {
    discountQuote: {
      product: { kind: "cowork", tier: "open-space" },
      discountableSubtotal: money(29_000),
      discounts: [
        {
          discount: {
            id: Schema.decodeUnknownSync(discountIdSchema)("summer-sale"),
            label: "Summer sale",
            adjustment: { kind: "percentage", basisPoints: 5000 },
          },
          subtotalBefore: money(29_000),
          amount: money(14_500),
          subtotalAfter: money(14_500),
        },
      ],
      totalDiscount: money(14_500),
      discountedSubtotal: money(14_500),
    },
  }
);

const availabilityResponse = {
  date: "2099-07-30",
  from: "2099-07-30",
  to: "2100-01-30",
  unavailableDates: [],
  unavailableCoworkTiers: [],
  meetingRoomUnavailable: false,
  officeUnavailable: false,
  unavailableMonitorOptions: [],
  notices: [],
};

const advertisedPriceResponse = {
  kind: "cowork" as const,
  quote: basicDiscountedQuote,
  summary: buildCoworkCheckoutSummary(
    {
      entryTier: "open-space",
      coffee: true,
      date: "2099-07-30",
    },
    {
      discountQuote: {
        product: { kind: "cowork", tier: "open-space" },
        discountableSubtotal: money(29_000),
        discounts: basicDiscountedQuote.payment.discounts,
        totalDiscount: money(14_500),
        discountedSubtotal: money(14_500),
      },
    }
  ),
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

const reservedDeskPrice = getWorkspaceProductByTier("reserved-desk").price;
const reservedDeskDiscountAmount = money(
  Math.round(reservedDeskPrice.value * 0.2)
);
const reservedDeskDiscountedSubtotal = money(
  reservedDeskPrice.value - reservedDeskDiscountAmount.value
);
const reservedDeskDiscountQuote = {
  product: { kind: "cowork" as const, tier: "reserved-desk" as const },
  discountableSubtotal: reservedDeskPrice,
  discounts: [
    {
      discount: {
        id: Schema.decodeUnknownSync(discountIdSchema)("launch-sale"),
        label: "Launch sale",
        adjustment: { kind: "percentage" as const, basisPoints: 2000 },
      },
      subtotalBefore: reservedDeskPrice,
      amount: reservedDeskDiscountAmount,
      subtotalAfter: reservedDeskDiscountedSubtotal,
    },
  ],
  totalDiscount: reservedDeskDiscountAmount,
  discountedSubtotal: reservedDeskDiscountedSubtotal,
};
const reservedDeskAdvertisedPriceResponse = {
  kind: "cowork" as const,
  quote: buildCoworkReservationQuote(
    {
      entryTier: "reserved-desk",
      coffee: true,
      date: "2099-07-30",
    },
    { discountQuote: reservedDeskDiscountQuote }
  ),
  summary: buildCoworkCheckoutSummary(
    {
      entryTier: "reserved-desk",
      coffee: true,
      date: "2099-07-30",
    },
    { discountQuote: reservedDeskDiscountQuote }
  ),
  advertisedPriceToken: "sealed-reserved-desk-advertised-price",
};
const _reservedDeskNoAddonAdvertisedPriceResponse = {
  kind: "cowork" as const,
  quote: buildCoworkReservationQuote({
    entryTier: "reserved-desk",
    coffee: true,
    date: "2099-07-30",
    monitorOption: "2x27-qhd",
  }),
  summary: buildCoworkCheckoutSummary({
    entryTier: "reserved-desk",
    coffee: true,
    date: "2099-07-30",
    monitorOption: "2x27-qhd",
  }),
  advertisedPriceToken: "sealed-reserved-desk-workstation-advertised-price",
};

const jsonResponse = <T,>(body: T, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const renderForm = (
  props: Partial<ComponentProps<typeof CoworkReservationForm>> = {}
) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retryDelay: 0 },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <CoworkReservationForm locale="en-US" {...props} />
    </QueryClientProvider>
  );
};

describe("CoworkReservationForm advertised pricing", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    workspaceUseSearchParams.mockReturnValue(
      new URLSearchParams(
        "entryTier=open-space&date=2099-07-30&coffee=true&name=Ada%20Lovelace&email=ada%40example.test&phone=%2B420777777777"
      )
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
    getAdvertisedPrices.mockClear();
    push.mockClear();
    execute.mockClear();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("renders server-loaded discounts on the first paint without refetching", () => {
    workspaceUseSearchParams.mockReturnValue(new URLSearchParams());
    getAdvertisedPrices.mockImplementation(() => new Promise(() => undefined));
    const advertisedPrices = {
      "open-space": advertisedPriceResponse,
      "reserved-desk": reservedDeskAdvertisedPriceResponse,
    } as const;
    const requests = getCoworkTierAdvertisedPriceRequests({
      date: "2099-07-30",
      locale: "en-US",
      offers: [
        { entryTier: "open-space", coffee: true },
        { entryTier: "reserved-desk", coffee: true },
      ],
    });

    expect(requests.every((request) => !("submittedCode" in request))).toBe(
      true
    );

    const view = renderForm({
      initialValues: {
        ...coworkReservationDefaultValues,
        coffee: true,
        date: "2099-07-30",
      },
      initialAdvertisedPrices: requests.map((request) => ({
        request,
        advertisedPrice:
          advertisedPrices[request.reservation.details.entryTier],
      })),
    });

    expect(view.getByText(/discounted price.*145/i)).toBeDefined();
    const coffeePrice = view.container.querySelector(
      "[data-reservation-coffee-price]"
    );
    expect(coffeePrice?.textContent).toContain("50");
    expect(coffeePrice?.querySelector("[data-slot='skeleton']")).toBeNull();
    expect(getAdvertisedPrices).not.toHaveBeenCalled();
    view.unmount();
  });

  test("shows validation messages when required customer fields are empty", async () => {
    workspaceUseSearchParams.mockReturnValue(
      new URLSearchParams("entryTier=open-space&date=2099-07-30&coffee=true")
    );
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (url.startsWith("/api/workspace/availability")) {
        return Promise.resolve(jsonResponse(availabilityResponse));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as typeof fetch;

    const view = renderForm();
    const continueButton = view.getByRole("button", { name: "Continue" });
    await waitFor(
      () => {
        expect(continueButton.hasAttribute("disabled")).toBe(false);
      },
      { timeout: 5000 }
    );

    fireEvent.click(continueButton);

    expect(await view.findByText("Email is required.")).toBeDefined();
    expect(view.getByText("Phone is required.")).toBeDefined();
    expect(view.getByText("Name must be at least 2 characters.")).toBeDefined();
    expect(execute).not.toHaveBeenCalled();
  });

  test("shows billing validation without errors for empty optional fields", async () => {
    workspaceUseSearchParams.mockReturnValue(
      new URLSearchParams("entryTier=open-space&date=2099-07-30&coffee=true")
    );
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (url.startsWith("/api/workspace/availability")) {
        return Promise.resolve(jsonResponse(availabilityResponse));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as typeof fetch;

    const view = renderForm();
    const continueButton = view.getByRole("button", { name: "Continue" });
    await waitFor(
      () => {
        expect(continueButton.hasAttribute("disabled")).toBe(false);
      },
      { timeout: 5000 }
    );

    fireEvent.click(view.getByRole("checkbox", { name: "Create invoice" }));
    fireEvent.click(continueButton);

    expect(await view.findAllByText("This field is required.")).toHaveLength(3);
    expect(view.queryByText("undefined")).toBeNull();
    expect(view.queryByText("Expected string, got undefined")).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  test("does not render catalog prices before a backend quote is available", () => {
    workspaceUseSearchParams.mockReturnValue(
      new URLSearchParams("entryTier=open-space")
    );
    getAdvertisedPrices.mockImplementation(() => new Promise(() => undefined));

    const view = renderForm();
    const priceRows = Array.from(
      view.container.querySelectorAll("[data-reservation-type-price]")
    );

    expect(priceRows).toHaveLength(2);
    expect(
      priceRows.every(
        (price) =>
          price.getAttribute("data-reservation-type-price-ready") === "false" &&
          price.querySelector("[data-slot='skeleton']")
      )
    ).toBe(true);
    expect(
      view.container.querySelector(
        "[data-reservation-coffee-price] [data-slot='skeleton']"
      )
    ).not.toBeNull();
    expect(view.getByRole("textbox", { name: /email/i })).toBeDefined();
    expect(
      view.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
    ).toBe(true);
    expect(getAdvertisedPrices).not.toHaveBeenCalled();
    view.unmount();
  });

  test("renders discounts accessibly and blocks checkout while the selected tier price loads", async () => {
    const advertisedRequests: AdvertisedPriceRequest[] = [];
    let reservedDeskBatchCount = 0;
    let resolveReservedDeskRequest:
      | ((response: ReturnType<typeof advertisedPricesResult>) => void)
      | undefined;
    getAdvertisedPrices.mockImplementation((requests) => {
      advertisedRequests.push(...requests);
      const includesReservedDesk = requests.some(
        ({ reservation }) =>
          reservation.kind === "cowork" &&
          reservation.details.entryTier === "reserved-desk"
      );
      if (includesReservedDesk && reservedDeskBatchCount++ > 0) {
        return new Promise((resolve) => {
          resolveReservedDeskRequest = resolve;
        });
      }
      return Promise.resolve(
        advertisedPricesResult(
          requests.filter(
            ({ reservation }) =>
              reservation.kind !== "cowork" ||
              reservation.details.entryTier !== "reserved-desk"
          )
        )
      );
    });
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (url.startsWith("/api/workspace/availability")) {
        return Promise.resolve(jsonResponse(availabilityResponse));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as typeof fetch;

    const view = renderForm();

    expect(
      await view.findByText(/original price.*290/i, {}, { timeout: 5000 })
    ).toBeDefined();
    expect(view.getByText(/discounted price.*145/i)).toBeDefined();
    expect(
      view.getByRole("button", { name: /discount.*Open Space/i })
    ).toBeDefined();
    const openSpacePrice = view.container.querySelector(
      '[data-reservation-type-price="open-space"]'
    );
    expect(openSpacePrice?.className).toContain("flex-col");
    expect(openSpacePrice?.querySelector("del")?.className).toContain(
      "text-navy-blue/45"
    );
    expect(
      Array.from(openSpacePrice?.querySelectorAll("span") ?? []).some(
        (element) => element.className.includes("text-aquamarine-ink")
      )
    ).toBe(true);

    await act(async () => {
      fireEvent.click(
        view.container.querySelector(
          "#reservation-entry-tier-reserved-desk"
        ) as HTMLElement
      );
    });

    await waitFor(() => {
      expect(
        (
          view.container.querySelector(
            "#reservation-entry-tier-reserved-desk"
          ) as HTMLInputElement
        ).checked
      ).toBe(true);
      expect(advertisedRequests).toContainEqual(
        expect.objectContaining({
          reservation: expect.objectContaining({
            details: expect.objectContaining({ entryTier: "reserved-desk" }),
          }),
        })
      );
    });
    expect(
      view.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
    ).toBe(true);
    expect(view.getByText(/discounted price.*145/i)).toBeDefined();

    await act(async () => {
      const reservedDeskRequest = advertisedRequests.find(
        ({ reservation }) =>
          reservation.kind === "cowork" &&
          reservation.details.entryTier === "reserved-desk"
      );
      if (!reservedDeskRequest) {
        throw new Error("Expected the Reserved Desk advertised-price request");
      }
      resolveReservedDeskRequest?.(
        advertisedPricesResult(
          [reservedDeskRequest],
          () => reservedDeskAdvertisedPriceResponse
        )
      );
    });
    await waitFor(() => {
      expect(
        view.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
      ).toBe(false);
    });
    expect(view.getByText(/discounted price.*328/i)).toBeDefined();
  });

  test("presents the selected advertised sale around the whole form", async () => {
    getAdvertisedPrices.mockImplementation((requests) =>
      Promise.resolve(
        advertisedPricesResult(requests, ({ reservation }) =>
          reservation.kind === "cowork" &&
          reservation.details.entryTier === "reserved-desk"
            ? reservedDeskAdvertisedPriceResponse
            : advertisedPriceResponse
        )
      )
    );
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (url.startsWith("/api/workspace/availability")) {
        return Promise.resolve(jsonResponse(availabilityResponse));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as typeof fetch;

    const view = renderForm();

    await waitFor(() => {
      expect(getAdvertisedPrices).toHaveBeenCalledTimes(1);
    });
    const saleCard = view.container.querySelector(
      '[data-reservation-sale="active"]'
    );
    expect(saleCard?.className).toContain("glow-border-purple-300");
    expect(
      saleCard?.querySelector('[data-reservation-sale-discount="summer-sale"]')
        ?.textContent
    ).toContain("Summer sale");
    expect(
      view.getByRole("button", { name: /discount.*applied to.*Open Space/i })
    ).toBeDefined();

    for (const tier of ["open-space", "reserved-desk"]) {
      const option = view.container.querySelector(
        `[data-reservation-type-option="${tier}"]`
      );
      expect(option?.className).toContain("lg:row-span-4");
      expect(option?.className).not.toContain("glow-border");
      expect(
        option?.querySelector("[data-reservation-type-discount-banner]")
      ).toBeNull();
    }

    expect(
      view.container
        .querySelector('[data-reservation-type-price="reserved-desk"]')
        ?.querySelector("del")
    ).not.toBeNull();
    fireEvent.click(
      view.container.querySelector("#reservation-entry-tier-reserved-desk")!
    );
    await waitFor(() => {
      expect(
        view.container.querySelector(
          '[data-reservation-sale-discount="launch-sale"]'
        )?.textContent
      ).toContain("Launch sale");
    });
    expect(
      view.getByRole("button", { name: /discount.*applied to.*Reserved Desk/i })
    ).toBeDefined();
  });

  test("shows a retryable error instead of enabling checkout with failed price data", async () => {
    let failAdvertisedPrice = true;
    getAdvertisedPrices.mockImplementation((requests) =>
      Promise.resolve(
        failAdvertisedPrice
          ? { serverError: "unavailable" }
          : advertisedPricesResult(requests)
      )
    );
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (url.startsWith("/api/workspace/availability")) {
        return Promise.resolve(jsonResponse(availabilityResponse));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as typeof fetch;

    const view = renderForm();
    expect(
      (await view.findByRole("alert", {}, { timeout: 10_000 })).textContent
    ).toMatch(/current price could not be loaded/i);
    expect(
      view.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
    ).toBe(true);

    failAdvertisedPrice = false;
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Try again" }));
    });

    await waitFor(() => {
      expect(
        view.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
      ).toBe(false);
    });
  });

  test("prices the workstation addon when the Reserved Desk toggle selects a configuration", async () => {
    const advertisedRequests: AdvertisedPriceRequest[] = [];
    const availabilityRequests: string[] = [];
    getAdvertisedPrices.mockImplementation((requests) => {
      advertisedRequests.push(...requests);
      return Promise.resolve(advertisedPricesResult(requests));
    });
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (url.startsWith("/api/workspace/availability")) {
        availabilityRequests.push(url);
        return Promise.resolve(jsonResponse(availabilityResponse));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as typeof fetch;

    const view = renderForm();
    await view.findByText(/original price.*290/i, {}, { timeout: 3000 });

    await act(async () => {
      fireEvent.click(
        view.container.querySelector(
          "#reservation-entry-tier-reserved-desk"
        ) as HTMLElement
      );
    });
    await waitFor(() => {
      expect(advertisedRequests.at(-1)).toMatchObject({
        reservation: {
          details: {
            entryTier: "reserved-desk",
            workstation: false,
          },
        },
      });
    });
    const baseRequestCount = advertisedRequests.length;

    // Selecting a monitor configuration changes the priced workstation
    // presence, so the advertised quote is refreshed for the new price.
    await act(async () => {
      fireEvent.click(
        view.getByRole("switch", { name: /Monitor workstation/i })
      );
    });
    await waitFor(() => {
      expect(
        view.container.querySelector('input[value="2x27-qhd"]')
      ).not.toBeNull();
    });
    await act(async () => {
      fireEvent.click(
        view.container.querySelector('input[value="2x27-qhd"]') as HTMLElement
      );
    });
    await waitFor(() => {
      expect(advertisedRequests.length).toBeGreaterThan(baseRequestCount);
      expect(advertisedRequests.at(-1)).toMatchObject({
        reservation: {
          details: {
            entryTier: "reserved-desk",
            workstation: true,
          },
        },
      });
    });
    expect(advertisedRequests.at(-1)).not.toHaveProperty(
      "reservation.details.monitorOption"
    );
    await waitFor(() => {
      expect(availabilityRequests.at(-1)).toContain("monitorOption=2x27-qhd");
    });
  });
});
