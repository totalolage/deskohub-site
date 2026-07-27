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
import {
  buildCoworkCheckoutSummary,
  buildCoworkReservationQuote,
} from "@/features/checkout/checkout-quote.test-utils";
import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import { discountIdSchema } from "@/features/discounts/contracts";
import { getCoworkTierAdvertisedPriceRequests } from "@/features/reservation/cowork-advertised-price";
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

const { ReservationForm } = await import("./reservation-form");

const money = (value: number) => ({
  value,
  exponent: 2,
  currency: "CZK",
});

const basicDiscountedQuote = buildCoworkReservationQuote(
  {
    entryTier: "basic",
    coffee: true,
    date: "2099-07-30",
  },
  {
    discountQuote: {
      product: { kind: "cowork", tier: "basic" },
      discountableSubtotal: money(35_000),
      discounts: [
        {
          discount: {
            id: Schema.decodeUnknownSync(discountIdSchema)("summer-sale"),
            label: "Summer sale",
            adjustment: { kind: "percentage", basisPoints: 5000 },
          },
          subtotalBefore: money(35_000),
          amount: money(17_500),
          subtotalAfter: money(17_500),
        },
      ],
      totalDiscount: money(17_500),
      discountedSubtotal: money(17_500),
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
  unavailableMonitorOptions: [],
  notices: [],
};

const advertisedPriceResponse = {
  kind: "cowork" as const,
  quote: basicDiscountedQuote,
  summary: buildCoworkCheckoutSummary(
    {
      entryTier: "basic",
      coffee: true,
      date: "2099-07-30",
    },
    {
      discountQuote: {
        product: { kind: "cowork", tier: "basic" },
        discountableSubtotal: money(35_000),
        discounts: basicDiscountedQuote.payment.discounts,
        totalDiscount: money(17_500),
        discountedSubtotal: money(17_500),
      },
    }
  ),
  advertisedPriceToken: "sealed-advertised-price",
};

const plusPrice = getWorkspaceProductByTier("plus").price;
const plusDiscountAmount = money(Math.round(plusPrice.value * 0.2));
const plusDiscountedSubtotal = money(
  plusPrice.value - plusDiscountAmount.value
);
const plusDiscountQuote = {
  product: { kind: "cowork" as const, tier: "plus" as const },
  discountableSubtotal: plusPrice,
  discounts: [
    {
      discount: {
        id: Schema.decodeUnknownSync(discountIdSchema)("launch-sale"),
        label: "Launch sale",
        adjustment: { kind: "percentage" as const, basisPoints: 2000 },
      },
      subtotalBefore: plusPrice,
      amount: plusDiscountAmount,
      subtotalAfter: plusDiscountedSubtotal,
    },
  ],
  totalDiscount: plusDiscountAmount,
  discountedSubtotal: plusDiscountedSubtotal,
};
const plusAdvertisedPriceResponse = {
  kind: "cowork" as const,
  quote: buildCoworkReservationQuote(
    {
      entryTier: "plus",
      coffee: true,
      date: "2099-07-30",
    },
    { discountQuote: plusDiscountQuote }
  ),
  summary: buildCoworkCheckoutSummary(
    {
      entryTier: "plus",
      coffee: true,
      date: "2099-07-30",
    },
    { discountQuote: plusDiscountQuote }
  ),
  advertisedPriceToken: "sealed-plus-advertised-price",
};
const profiAdvertisedPriceResponse = {
  kind: "cowork" as const,
  quote: buildCoworkReservationQuote({
    entryTier: "profi",
    coffee: true,
    date: "2099-07-30",
    monitorOption: "2x27-qhd",
  }),
  summary: buildCoworkCheckoutSummary({
    entryTier: "profi",
    coffee: true,
    date: "2099-07-30",
    monitorOption: "2x27-qhd",
  }),
  advertisedPriceToken: "sealed-profi-advertised-price",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const renderForm = (
  props: Partial<ComponentProps<typeof ReservationForm>> = {}
) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retryDelay: 0 },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ReservationForm locale="en-US" {...props} />
    </QueryClientProvider>
  );
};

describe("ReservationForm advertised pricing", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    workspaceUseSearchParams.mockReturnValue(
      new URLSearchParams(
        "entryTier=basic&date=2099-07-30&coffee=true&name=Ada%20Lovelace&email=ada%40example.test&phone=%2B420777777777"
      )
    );
    workspaceUseAction.mockReturnValue({
      execute,
      isExecuting: false,
      result: {},
    });
  });

  afterEach(() => {
    cleanup();
    getAdvertisedPrice.mockClear();
    push.mockClear();
    execute.mockClear();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("renders server-loaded discounts on the first paint without refetching", () => {
    getAdvertisedPrice.mockImplementation(() => new Promise(() => undefined));
    const advertisedPrices = {
      basic: advertisedPriceResponse,
      plus: plusAdvertisedPriceResponse,
      profi: profiAdvertisedPriceResponse,
    } as const;

    const view = renderForm({
      initialAdvertisedPrices: getCoworkTierAdvertisedPriceRequests({
        coffee: true,
        date: "2099-07-30",
        locale: "en-US",
      }).map(({ request, tier }) => ({
        request,
        advertisedPrice: advertisedPrices[tier],
      })),
    });

    expect(view.getByText(/discounted price.*175/i)).toBeDefined();
    expect(getAdvertisedPrice).not.toHaveBeenCalled();
    view.unmount();
  });

  test("renders discounts accessibly and blocks checkout while the selected tier price loads", async () => {
    const advertisedRequests: unknown[] = [];
    let resolvePlusRequest:
      | ((response: { data: typeof advertisedPriceResponse }) => void)
      | undefined;
    getAdvertisedPrice.mockImplementation((input) => {
      advertisedRequests.push(input);
      if (input.reservation.details.entryTier === "plus") {
        return new Promise((resolve) => {
          resolvePlusRequest = resolve;
        });
      }
      return Promise.resolve({ data: advertisedPriceResponse });
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
      await view.findByText(/original price.*350/i, {}, { timeout: 3000 })
    ).toBeDefined();
    expect(view.getByText(/discounted price.*175/i)).toBeDefined();
    expect(
      view.getByRole("button", { name: /discount.*basic/i })
    ).toBeDefined();
    const basicPrice = view.container.querySelector(
      '[data-reservation-tier-price="basic"]'
    );
    expect(basicPrice?.className).toContain("flex-col");
    expect(basicPrice?.querySelector("del")?.className).toContain(
      "text-navy-blue/45"
    );
    expect(
      Array.from(basicPrice?.querySelectorAll("span") ?? []).some((element) =>
        element.className.includes("text-aquamarine-ink")
      )
    ).toBe(true);

    await act(async () => {
      fireEvent.click(
        view.container.querySelector(
          '[data-reservation-tier-price="plus"]'
        ) as HTMLElement
      );
    });

    await waitFor(() => {
      expect(
        (
          view.container.querySelector(
            "#reservation-entry-tier-plus"
          ) as HTMLInputElement
        ).checked
      ).toBe(true);
      expect(advertisedRequests).toContainEqual(
        expect.objectContaining({
          reservation: expect.objectContaining({
            details: expect.objectContaining({ entryTier: "plus" }),
          }),
        })
      );
    });
    expect(
      view.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
    ).toBe(true);
    expect(view.getByText(/discounted price.*175/i)).toBeDefined();

    await act(async () => {
      resolvePlusRequest?.({ data: plusAdvertisedPriceResponse });
    });
    await waitFor(() => {
      expect(
        view.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
      ).toBe(false);
    });
    expect(view.getByText(/discounted price.*392/i)).toBeDefined();
  });

  test("advertises discounts on every applicable tier and top-aligns price rows", async () => {
    getAdvertisedPrice.mockImplementation((input) =>
      Promise.resolve({
        data:
          input.reservation.details.entryTier === "plus"
            ? plusAdvertisedPriceResponse
            : advertisedPriceResponse,
      })
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
      expect(getAdvertisedPrice).toHaveBeenCalledTimes(3);
    });
    expect(
      view.container.querySelector(
        '[data-reservation-tier-option="basic"] [data-reservation-tier-discount="summer-sale"]'
      )?.textContent
    ).toContain("Summer sale");
    const basicCard = view.container.querySelector(
      '[data-reservation-tier-option="basic"]'
    );
    const basicBanner = basicCard?.querySelector(
      '[data-reservation-tier-discount-banner="basic"]'
    );
    const basicGlimmer = basicCard?.querySelector(
      '[data-reservation-tier-sale-glimmer="basic"]'
    );
    expect(basicGlimmer).not.toBeNull();
    expect(basicGlimmer?.getAttribute("aria-hidden")).toBe("true");
    expect(basicGlimmer?.querySelectorAll("rect")).toHaveLength(3);
    expect(
      basicGlimmer
        ?.querySelector('[data-reservation-tier-sale-glimmer-layer="core"]')
        ?.getAttribute("stroke")
    ).toBe("oklch(98% 0.035 124)");
    expect(
      Array.from(basicCard?.children ?? []).find(
        (element) => !element.getAttribute("class")?.includes("absolute")
      )
    ).toBe(basicBanner ?? null);
    expect(basicBanner?.className).toContain("bg-purple-100");
    expect(basicBanner?.querySelector("svg")?.getAttribute("class")).toContain(
      "lucide-percent"
    );
    expect(basicCard?.className).toContain("lg:row-start-1");
    expect(basicCard?.className).toContain("lg:row-span-5");
    expect(basicCard?.className).toContain("lg:grid-rows-subgrid");
    expect(basicCard?.className.split(" ")).toContain("grid");
    expect(basicCard?.className.split(" ")).not.toContain("flex");
    expect(basicCard?.className.split(" ")).not.toContain("gap-3");
    expect(basicCard?.className.split(" ")).not.toContain("border");
    expect(basicCard?.className.split(" ")).toContain("outline-1");
    expect(basicCard?.parentElement?.className).toContain(
      "lg:grid-rows-[repeat(5,auto)]"
    );
    expect(basicCard?.parentElement?.className.split(" ")).toContain(
      "space-y-3"
    );
    expect(basicCard?.parentElement?.className.split(" ")).not.toContain(
      "gap-3"
    );
    expect(basicCard?.parentElement?.className.split(" ")).not.toContain(
      "lg:gap-y-3"
    );
    expect(
      basicCard
        ?.querySelector('[data-reservation-tier-title="basic"]')
        ?.className.split(" ")
    ).not.toContain("pt-4");
    expect(
      basicCard
        ?.querySelector('[data-reservation-tier-title="basic"]')
        ?.className.split(" ")
    ).toContain("mt-4");
    expect(
      Array.from(basicCard?.children ?? [])
        .filter(
          (element) => !element.getAttribute("class")?.includes("absolute")
        )
        .map((element) =>
          [
            "discount-banner",
            "title",
            "price-row",
            "description",
            "perks",
          ].find((row) => element.hasAttribute(`data-reservation-tier-${row}`))
        )
    ).toEqual([
      "discount-banner",
      "title",
      "price-row",
      "description",
      "perks",
    ]);
    const basicDescription = basicCard?.querySelector(
      '[data-reservation-tier-description="basic"]'
    );
    expect(basicDescription?.textContent).toContain("Open-space desk");
    expect(basicDescription?.querySelector("li")).toBeNull();
    const profiCard = view.container.querySelector(
      '[data-reservation-tier-option="profi"]'
    );
    expect(profiCard?.className).toContain("lg:row-start-2");
    expect(profiCard?.className).toContain("lg:row-span-4");
    expect(
      profiCard?.querySelector("[data-reservation-tier-discount-banner]")
    ).toBeNull();
    expect(
      profiCard?.querySelector("[data-reservation-tier-sale-glimmer]")
    ).toBeNull();
    expect(
      profiCard
        ?.querySelector('[data-reservation-tier-title="profi"]')
        ?.className.split(" ")
    ).toContain("mt-4");
    expect(
      view.container.querySelector(
        '[data-reservation-tier-option="plus"] [data-reservation-tier-discount="launch-sale"]'
      )?.textContent
    ).toContain("Launch sale");
    expect(
      view.container.querySelector('[data-reservation-tier-option="plus"]')
        ?.className
    ).toContain("hover:outline-purple-500/60");
    expect(profiCard?.className).toContain("hover:outline-burned-orange/45");
    expect(
      view.container
        .querySelector('[data-reservation-tier-price="plus"]')
        ?.querySelector("del")
    ).not.toBeNull();
    expect(
      Array.from(
        view.container.querySelectorAll("[data-reservation-tier-price-row]")
      ).every((element) => element.className.includes("items-start"))
    ).toBe(true);
    expect(
      view.container
        .querySelector('[data-reservation-tier-price-row="profi"]')
        ?.className.includes("text-navy-blue")
    ).toBe(true);
  });

  test("shows a retryable error instead of enabling checkout with failed price data", async () => {
    let failAdvertisedPrice = true;
    getAdvertisedPrice.mockImplementation(() =>
      Promise.resolve(
        failAdvertisedPrice
          ? { serverError: "unavailable" }
          : { data: advertisedPriceResponse }
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
      (await view.findByRole("alert", {}, { timeout: 3000 })).textContent
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

  test("does not refetch the advertised price when the monitor changes", async () => {
    const advertisedRequests: unknown[] = [];
    const availabilityRequests: string[] = [];
    getAdvertisedPrice.mockImplementation((input) => {
      advertisedRequests.push(input);
      return Promise.resolve({ data: advertisedPriceResponse });
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
    await view.findByText(/original price.*350/i, {}, { timeout: 3000 });

    await act(async () => {
      fireEvent.click(
        view.container.querySelector(
          '[data-reservation-tier-price="profi"]'
        ) as HTMLElement
      );
    });
    await waitFor(() => {
      expect(advertisedRequests.at(-1)).toMatchObject({
        reservation: {
          details: {
            entryTier: "profi",
          },
        },
      });
    });
    expect(advertisedRequests.at(-1)).not.toHaveProperty(
      "reservation.details.monitorOption"
    );
    const requestCount = advertisedRequests.length;

    await act(async () => {
      fireEvent.click(
        view.container.querySelector('input[value="2x27-qhd"]') as HTMLElement
      );
    });
    await waitFor(() => {
      expect(
        (
          view.container.querySelector(
            'input[value="2x27-qhd"]'
          ) as HTMLInputElement
        ).checked
      ).toBe(true);
    });

    expect(advertisedRequests).toHaveLength(requestCount);
    await waitFor(() => {
      expect(availabilityRequests.at(-1)).toContain("monitorOption=2x27-qhd");
    });
  });
});
