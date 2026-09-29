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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { Schema } from "effect";
import type { ComponentProps } from "react";
import {
  type AdvertisedPrice,
  type AdvertisedPriceRequest,
  advertisedPriceKeys,
} from "@/features/checkout/advertised-price";
import {
  buildCoworkCheckoutSummary,
  buildCoworkReservationQuote,
} from "@/features/checkout/checkout-quote.test-utils";
import {
  getWorkspaceProductByTier,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
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
const reservedDeskWorkstationAdvertisedPriceResponse = {
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

const coworkAdvertisedPriceResponses = {
  "open-space": advertisedPriceResponse,
  "reserved-desk": reservedDeskAdvertisedPriceResponse,
  workstation: reservedDeskWorkstationAdvertisedPriceResponse,
} as const;

const getCoworkAdvertisedPriceResponse = (request: AdvertisedPriceRequest) => {
  if (request.reservation.kind !== "cowork") {
    return coworkAdvertisedPriceResponses["open-space"];
  }
  const { details } = request.reservation;
  if (details.entryTier === "reserved-desk") {
    return details.workstation === true
      ? coworkAdvertisedPriceResponses.workstation
      : coworkAdvertisedPriceResponses["reserved-desk"];
  }
  return coworkAdvertisedPriceResponses["open-space"];
};

const jsonResponse = <T,>(body: T, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const renderForm = (
  props: Partial<ComponentProps<typeof CoworkReservationForm>> = {},
  queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      queries: { retryDelay: 0 },
    },
  })
) => {
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
    const requests = getCoworkTierAdvertisedPriceRequests({
      date: "2099-07-30",
      locale: "en-US",
      offers: [
        { entryTier: "open-space", coffee: true },
        { entryTier: "reserved-desk", coffee: true },
        {
          entryTier: "reserved-desk",
          coffee: true,
          monitorOption: "2x27-qhd",
        },
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
        advertisedPrice: getCoworkAdvertisedPriceResponse(request),
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

  test("prices the workstation addon from both advertised variants without re-pricing on monitor choice", async () => {
    const advertisedRequests: AdvertisedPriceRequest[] = [];
    const availabilityRequests: string[] = [];
    getAdvertisedPrices.mockImplementation((requests) => {
      advertisedRequests.push(...requests);
      return Promise.resolve(
        advertisedPricesResult(requests, getCoworkAdvertisedPriceResponse)
      );
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

    // Both Reserved Desk advertised variants are requested up front so the
    // paid workstation addon price is known before the toggle is flipped.
    const workstationRequest = advertisedRequests.find(
      ({ reservation }) =>
        reservation.kind === "cowork" &&
        reservation.details.entryTier === "reserved-desk" &&
        reservation.details.workstation === true
    );
    expect(workstationRequest).toBeDefined();
    for (const request of advertisedRequests) {
      expect(request.reservation.details).not.toHaveProperty("monitorOption");
    }
    expect(
      workstationRequest &&
        workstationRequest.reservation.details.workstation === true
    ).toBe(true);

    await act(async () => {
      fireEvent.click(
        view.container.querySelector(
          "#reservation-entry-tier-reserved-desk"
        ) as HTMLElement
      );
    });
    const requestsAfterTierChange = advertisedRequests.length;

    // The advertised workstation price renders before the toggle is flipped.
    const workstationPrice = await waitFor(() => {
      const price = view.container.querySelector(
        "[data-reservation-workstation-price]"
      );
      expect(price?.textContent).toContain("120");
      expect(price?.querySelector("[data-slot='skeleton']")).toBeNull();
      return price;
    });
    expect(workstationPrice).toBeDefined();

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

    // Flipping the toggle and choosing every monitor configuration reuses
    // the already-advertised variants: no new priced request and no
    // fingerprint change, only availability tracks the monitor option.
    for (const monitorOption of workspaceProductMonitorOptions) {
      await act(async () => {
        fireEvent.click(
          view.container.querySelector(
            `input[value="${monitorOption}"]`
          ) as HTMLElement
        );
      });
      await waitFor(() => {
        expect(availabilityRequests.at(-1)).toContain(
          `monitorOption=${monitorOption}`
        );
      });
      expect(advertisedRequests.length).toBe(requestsAfterTierChange);
    }
    for (const request of advertisedRequests) {
      expect(request.reservation.details).not.toHaveProperty("monitorOption");
    }
    const workstationPriceAfterToggle = view.container.querySelector(
      "[data-reservation-workstation-price]"
    );
    expect(workstationPriceAfterToggle?.textContent).toContain("120");

    // Submission with the workstation on carries the workstation advertised
    // token plus the exact selected monitor option.
    await act(async () => {
      fireEvent.click(
        view.container.querySelector('input[value="2x32-4k"]') as HTMLElement
      );
    });
    execute.mockClear();
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Continue" }));
    });
    await waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    const workstationSubmission = execute.mock.calls[0]?.[0] as {
      advertisedPriceToken?: string;
      reservation?: { monitorOption?: string };
    };
    expect(workstationSubmission.advertisedPriceToken).toBe(
      "sealed-reserved-desk-workstation-advertised-price"
    );
    expect(workstationSubmission.reservation?.monitorOption).toBe("2x32-4k");

    // Toggling the workstation off submits the bare variant: no monitor
    // option and the no-workstation advertised token.
    await act(async () => {
      fireEvent.click(
        view.getByRole("switch", { name: /Monitor workstation/i })
      );
    });
    await waitFor(() => {
      expect(
        view.container.querySelector('input[value="2x27-qhd"]')
      ).toBeNull();
    });
    execute.mockClear();
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Continue" }));
    });
    await waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    const bareSubmission = execute.mock.calls[0]?.[0] as {
      advertisedPriceToken?: string;
      reservation?: { monitorOption?: string };
    };
    expect(bareSubmission.advertisedPriceToken).toBe(
      "sealed-reserved-desk-advertised-price"
    );
    expect(bareSubmission.reservation?.monitorOption).toBeUndefined();
  });

  test("shows the workstation addon price localized for cs-CZ", async () => {
    getAdvertisedPrices.mockImplementation((requests) =>
      Promise.resolve(
        advertisedPricesResult(requests, getCoworkAdvertisedPriceResponse)
      )
    );
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (url.startsWith("/api/workspace/availability")) {
        return Promise.resolve(jsonResponse(availabilityResponse));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as typeof fetch;

    const view = renderForm({ locale: "cs-CZ" });
    await act(async () => {
      fireEvent.click(
        view.container.querySelector(
          "#reservation-entry-tier-reserved-desk"
        ) as HTMLElement
      );
    });
    await waitFor(
      () => {
        const price = view.container.querySelector(
          "[data-reservation-workstation-price]"
        );
        expect(price?.textContent).toContain("120");
        expect(price?.textContent).toContain("Kč");
        expect(price?.querySelector("[data-slot='skeleton']")).toBeNull();
      },
      { timeout: 3000 }
    );
  });

  test("hides a previously shown workstation amount when the same query refresh fails", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retryDelay: 0 },
      },
    });
    getAdvertisedPrices.mockImplementation((requests) =>
      Promise.resolve(
        advertisedPricesResult(requests, getCoworkAdvertisedPriceResponse)
      )
    );
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (url.startsWith("/api/workspace/availability")) {
        return Promise.resolve(jsonResponse(availabilityResponse));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as typeof fetch;

    const view = renderForm({}, queryClient);
    await view.findByText(/original price.*290/i, {}, { timeout: 3000 });
    await act(async () => {
      fireEvent.click(
        view.container.querySelector(
          "#reservation-entry-tier-reserved-desk"
        ) as HTMLElement
      );
    });
    await waitFor(() => {
      expect(
        view.container.querySelector("[data-reservation-workstation-price]")
          ?.textContent
      ).toContain("120");
    });

    // Force a refresh of the same advertised-price queries while the batch
    // omits the workstation variant, so its refresh terminates in error.
    getAdvertisedPrices.mockImplementation((requests) =>
      Promise.resolve({
        data: requests
          .filter(
            ({ reservation }) =>
              !(
                reservation.kind === "cowork" &&
                reservation.details.entryTier === "reserved-desk" &&
                reservation.details.workstation === true
              )
          )
          .map((request) => ({
            request,
            advertisedPrice: getCoworkAdvertisedPriceResponse(request),
          })),
      })
    );
    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: advertisedPriceKeys.all,
      });
    });

    // The previously displayed amount is gone; only the skeleton remains.
    await waitFor(() => {
      const workstationPrice = view.container.querySelector(
        "[data-reservation-workstation-price]"
      );
      expect(workstationPrice?.textContent).not.toContain("120");
      expect(
        workstationPrice?.querySelector("[data-slot='skeleton']")
      ).not.toBeNull();
    });
    await act(async () => {});
  });

  test("keeps the workstation price hidden while its variant is pending or failed, then shows the advertised amount", async () => {
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (url.startsWith("/api/workspace/availability")) {
        return Promise.resolve(jsonResponse(availabilityResponse));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as typeof fetch;
    const isWorkstationVariant = (request: AdvertisedPriceRequest) =>
      request.reservation.kind === "cowork" &&
      request.reservation.details.entryTier === "reserved-desk" &&
      request.reservation.details.workstation === true;
    const selectReservedDeskTier = async (
      view: ReturnType<typeof renderForm>,
      { waitForBasePrice = true }: { readonly waitForBasePrice?: boolean } = {}
    ) => {
      if (waitForBasePrice) {
        await view.findByText(/original price.*290/i, {}, { timeout: 3000 });
      }
      await act(async () => {
        fireEvent.click(
          view.container.querySelector(
            "#reservation-entry-tier-reserved-desk"
          ) as HTMLElement
        );
      });
    };

    // Failed workstation variant: skeleton only, never a catalog amount.
    // The workstation request is omitted from the batch result, so only that
    // price promise rejects while the other advertised prices still load.
    getAdvertisedPrices.mockImplementation((requests) =>
      Promise.resolve(
        advertisedPricesResult(
          requests.filter((request) => !isWorkstationVariant(request)),
          getCoworkAdvertisedPriceResponse
        )
      )
    );
    const failingView = renderForm();
    await selectReservedDeskTier(failingView);
    expect(
      failingView.container
        .querySelector("[data-reservation-workstation-price]")
        ?.querySelector("[data-slot='skeleton']")
    ).not.toBeNull();
    expect(
      failingView.container.querySelector(
        "[data-reservation-workstation-price]"
      )?.textContent
    ).not.toContain("120");
    await act(async () => {
      failingView.unmount();
    });

    // Pending workstation variant: still no stale amount. The whole batch
    // stays unresolved, so the tier radio is switched without waiting for
    // the base price.
    getAdvertisedPrices.mockImplementation(() => new Promise(() => undefined));
    const pendingView = renderForm();
    await selectReservedDeskTier(pendingView, { waitForBasePrice: false });
    expect(
      pendingView.container
        .querySelector("[data-reservation-workstation-price]")
        ?.querySelector("[data-slot='skeleton']")
    ).not.toBeNull();
    expect(
      pendingView.container.querySelector(
        "[data-reservation-workstation-price]"
      )?.textContent
    ).not.toContain("120");
    await act(async () => {
      pendingView.unmount();
    });

    // Resolved advertised variants: the +120 addon price is visible before
    // the toggle is flipped.
    getAdvertisedPrices.mockImplementation((requests) =>
      Promise.resolve(
        advertisedPricesResult(requests, getCoworkAdvertisedPriceResponse)
      )
    );
    const loadedView = renderForm();
    await selectReservedDeskTier(loadedView);
    await waitFor(() => {
      expect(
        loadedView.container.querySelector(
          "[data-reservation-workstation-price]"
        )?.textContent
      ).toContain("120");
    });
    expect(
      loadedView.container
        .querySelector("[data-reservation-workstation-price]")
        ?.querySelector("[data-slot='skeleton']")
    ).toBeNull();
    // Let any remaining scheduled render work flush while the test
    // environment globals are still registered.
    await act(async () => {});
  });

  const monitorUnavailableAvailability = {
    ...availabilityResponse,
    unavailableMonitorOptions: ["2x27-qhd"],
  } as const;

  const openSpaceUnavailableAvailability = {
    ...availabilityResponse,
    // Both tiers are marked unavailable so happy-dom keeps the selected
    // (disabled) Open Space radio checked instead of force-selecting the
    // other one, which would mask the unavailable-message rendering.
    unavailableCoworkTiers: ["open-space", "reserved-desk"],
  } as const;

  const getUnavailableMessage = async (view: ReturnType<typeof renderForm>) => {
    await waitFor(
      () => {
        expect(
          view.container.querySelector('[data-reservation-unavailable="true"]')
        ).not.toBeNull();
      },
      { timeout: 5000 }
    );
    const message = view.container.querySelector("p[aria-live='polite']");
    expect(message?.textContent).toBeDefined();
    return message!.textContent!;
  };

  const renderWithAvailability = async (
    locale: "en-US" | "cs-CZ",
    unavailableAvailability: typeof availabilityResponse
  ) => {
    getAdvertisedPrices.mockImplementation((requests) =>
      Promise.resolve(
        advertisedPricesResult(requests, getCoworkAdvertisedPriceResponse)
      )
    );
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (url.startsWith("/api/workspace/availability")) {
        const isMonitorRequest = decodeURIComponent(url).includes(
          "monitorOption=2x27-qhd"
        );
        return Promise.resolve(
          jsonResponse(
            isMonitorRequest
              ? monitorUnavailableAvailability
              : unavailableAvailability
          )
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as typeof fetch;

    const view = renderForm({ locale });
    await view.findByText(
      locale === "en-US" ? /original price.*290/i : /původní cena.*290/i,
      {},
      { timeout: 5000 }
    );
    await act(async () => {
      fireEvent.click(
        view.container.querySelector(
          "#reservation-entry-tier-reserved-desk"
        ) as HTMLElement
      );
    });
    if (unavailableAvailability === monitorUnavailableAvailability) {
      await act(async () => {
        fireEvent.click(view.getByRole("switch", { name: /monitor/i }));
      });
    }
    return view;
  };

  test("scopes the unavailable message to the selected monitor setup instead of the whole Reserved Desk offer", async () => {
    for (const locale of ["en-US", "cs-CZ"] as const) {
      const view = await renderWithAvailability(
        locale,
        monitorUnavailableAvailability
      );
      const message = await getUnavailableMessage(view);
      expect(message).not.toMatch(/all out of space|nemáme volné místo/);
      if (locale === "en-US") {
        expect(message).toMatch(/your selected reservation/i);
        expect(message).not.toMatch(/offer you selected/i);
        expect(message).toMatch(/another monitor setup/i);
      } else {
        expect(message).toMatch(/zvolené konfiguraci/i);
        expect(message).not.toMatch(/nabídka .* není na .* dostupná\./u);
        expect(message).toMatch(/jinou sestavu monitorů/);
      }
      await act(async () => {
        view.unmount();
      });
    }
  });

  test("keeps the monitor advice conditional when an Open Space tier is unavailable", async () => {
    for (const locale of ["en-US", "cs-CZ"] as const) {
      const view = await renderWithAvailability(
        locale,
        openSpaceUnavailableAvailability
      );
      const message = await getUnavailableMessage(view);
      if (locale === "en-US") {
        expect(message).toMatch(/Open Space/);
        expect(message).toMatch(/another offer/i);
        expect(message).toMatch(/date/i);
        expect(message).toMatch(/if you selected a workstation/i);
        expect(message).toMatch(/monitor setup/i);
      } else {
        expect(message).toMatch(/Sdílené místo/);
        expect(message).toMatch(/jinou nabídku/);
        expect(message).toMatch(/datum/);
        expect(message).toMatch(/pracovní stanici/);
        expect(message).toMatch(/sestavu monitorů/);
      }
      await act(async () => {
        view.unmount();
      });
    }
  });

  test("shows the coffee toggle only when coffee is an optional addon", async () => {
    // Open Space coffee is an optional paid addon: the toggle is visible.
    const openSpaceView = renderForm({
      initialValues: {
        ...coworkReservationDefaultValues,
        entryTier: "open-space",
        date: "2099-07-30",
      },
    });
    expect(
      openSpaceView.container.querySelector("[data-reservation-coffee-price]")
    ).not.toBeNull();
    await act(async () => {
      openSpaceView.unmount();
    });

    // Reserved Desk includes coffee: there is no paid coffee toggle.
    const reservedDeskView = renderForm({
      initialValues: {
        ...coworkReservationDefaultValues,
        entryTier: "reserved-desk",
        date: "2099-07-30",
      },
    });
    expect(
      reservedDeskView.container.querySelector(
        "[data-reservation-coffee-price]"
      )
    ).toBeNull();
    await act(async () => {
      reservedDeskView.unmount();
    });
  });

  test("does not render a paid workstation toggle for a restored historical Profi tier", async () => {
    // Reserved Desk workstation is an optional paid addon: the toggle is
    // visible before it is flipped.
    const reservedDeskView = renderForm({
      initialValues: {
        ...coworkReservationDefaultValues,
        entryTier: "reserved-desk",
        date: "2099-07-30",
      },
    });
    expect(
      reservedDeskView.container.querySelector(
        "[data-reservation-workstation-price]"
      )
    ).not.toBeNull();
    expect(
      reservedDeskView.getByRole("switch", { name: /Monitor workstation/i })
    ).toBeDefined();
    await act(async () => {
      reservedDeskView.unmount();
    });

    // Historical Profi carries a required workstation, which is not a paid
    // toggle and must not render one.
    const profiView = renderForm({
      initialValues: {
        ...coworkReservationDefaultValues,
        entryTier: "profi",
        date: "2099-07-30",
      },
    });
    await profiView.findByText(/original price.*290/i, {}, { timeout: 3000 });
    expect(
      profiView.container.querySelector("[data-reservation-workstation-price]")
    ).toBeNull();
    expect(
      profiView.queryByRole("switch", { name: /Monitor workstation/i })
    ).toBeNull();
    await act(async () => {
      profiView.unmount();
    });
  });

  test("does not issue an availability query for a historical tier", async () => {
    const availabilityRequests: string[] = [];
    getAdvertisedPrices.mockImplementation((requests) =>
      Promise.resolve(
        advertisedPricesResult(requests, getCoworkAdvertisedPriceResponse)
      )
    );
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (url.startsWith("/api/workspace/availability")) {
        availabilityRequests.push(url);
        return Promise.resolve(jsonResponse(availabilityResponse));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as typeof fetch;

    // A restored historical tier refuses the availability query while the
    // current tier-card prices still load.
    const profiView = renderForm({
      initialValues: {
        ...coworkReservationDefaultValues,
        entryTier: "profi",
        date: "2099-07-30",
      },
    });
    await profiView.findByText(/original price.*290/i, {}, { timeout: 3000 });
    await act(async () => {});
    expect(availabilityRequests).toHaveLength(0);
    await act(async () => {
      profiView.unmount();
    });

    // A current tier does issue the availability query.
    const currentView = renderForm();
    await currentView.findByText(/original price.*290/i, {}, { timeout: 3000 });
    await waitFor(() => {
      expect(availabilityRequests.length).toBeGreaterThan(0);
    });
    await act(async () => {
      currentView.unmount();
    });
  });

  test("correlates the workstation addon price from the workstation advertised variant", async () => {
    getAdvertisedPrices.mockImplementation((requests) =>
      Promise.resolve(
        advertisedPricesResult(requests, getCoworkAdvertisedPriceResponse)
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
    await view.findByText(/original price.*290/i, {}, { timeout: 3000 });
    await act(async () => {
      fireEvent.click(
        view.container.querySelector(
          "#reservation-entry-tier-reserved-desk"
        ) as HTMLElement
      );
    });

    // The bare Reserved Desk variant has no workstation quote item, so the
    // advertised +120 amount can only come from the workstation variant
    // correlated by nested shape matching.
    await waitFor(() => {
      const price = view.container.querySelector(
        "[data-reservation-workstation-price]"
      );
      expect(price?.textContent).toContain("120");
      expect(price?.querySelector("[data-slot='skeleton']")).toBeNull();
    });
    await act(async () => {});
  });

  test("renders the two cowork offers as equal half-width desktop columns with no empty third column", () => {
    workspaceUseSearchParams.mockReturnValue(
      new URLSearchParams("entryTier=open-space")
    );
    getAdvertisedPrices.mockImplementation(() => new Promise(() => undefined));

    const view = renderForm();
    const offers = Array.from(
      view.container.querySelectorAll("[data-reservation-type-option]")
    );
    expect(offers).toHaveLength(2);

    const offerGrid = offers[0]?.parentElement;
    expect(offerGrid).not.toBeNull();

    // Effective grid composition: the shared lg:grid-cols-3 default is
    // overridden by the cowork-only lg:grid-cols-2, so only two column
    // tracks exist and neither is an empty third one.
    expect(offerGrid?.classList.contains("lg:grid-cols-2")).toBe(true);
    expect(offerGrid?.classList.contains("lg:grid-cols-3")).toBe(false);
    expect(offerGrid?.classList.contains("grid-cols-3")).toBe(false);

    // Both cards span the full four-row subgrid, so the two cards sit in one
    // row with equal width class composition and no per-card width overrides.
    for (const offer of offers) {
      expect(offer.classList.contains("lg:row-span-4")).toBe(true);
      expect(offer.classList.contains("lg:grid-rows-subgrid")).toBe(true);
      const widthOverrides = String(offer.className)
        .split(/\s+/)
        .filter((className) =>
          /(?:^|:)(?:col-start|col-span|w-)/.test(className)
        );
      expect(widthOverrides).toEqual([]);
    }
    view.unmount();
  });

  test("stacks the two cowork offers into one column below the desktop breakpoint", () => {
    workspaceUseSearchParams.mockReturnValue(
      new URLSearchParams("entryTier=open-space")
    );
    getAdvertisedPrices.mockImplementation(() => new Promise(() => undefined));

    const view = renderForm();
    const offerGrid = view.container.querySelector(
      "[data-reservation-type-option='open-space']"
    )?.parentElement;
    expect(offerGrid).not.toBeNull();

    // 320px and 768px stay a single stacked column: only lg: (1024px and up)
    // may open a second track, so nothing forces a side-by-side at small
    // viewports.
    expect(offerGrid?.classList.contains("grid")).toBe(true);
    expect(offerGrid?.classList.contains("space-y-3")).toBe(true);
    expect(offerGrid?.classList.contains("grid-cols-2")).toBe(false);
    expect(offerGrid?.classList.contains("sm:grid-cols-2")).toBe(false);
    expect(offerGrid?.classList.contains("md:grid-cols-2")).toBe(false);
    expect(offerGrid?.classList.contains("lg:grid-cols-2")).toBe(true);
    view.unmount();
  });

  test("does not pin cowork offer cards to explicit grid columns", () => {
    workspaceUseSearchParams.mockReturnValue(
      new URLSearchParams("entryTier=open-space")
    );
    getAdvertisedPrices.mockImplementation(() => new Promise(() => undefined));

    const view = renderForm();
    for (const tier of ["open-space", "reserved-desk"]) {
      const offer = view.container.querySelector(
        `[data-reservation-type-option="${tier}"]`
      );
      expect(offer).not.toBeNull();
      expect(offer?.className).not.toContain("col-start");
      expect(offer?.className).not.toContain("lg:col-start-1");
      expect(offer?.className).not.toContain("lg:col-start-2");
    }
    view.unmount();
  });

  test("keeps selecting between the two cowork offers", async () => {
    workspaceUseSearchParams.mockReturnValue(
      new URLSearchParams("entryTier=open-space")
    );
    getAdvertisedPrices.mockImplementation(() => new Promise(() => undefined));
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (url.startsWith("/api/workspace/availability")) {
        return Promise.resolve(jsonResponse(availabilityResponse));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as typeof fetch;

    const view = renderForm();
    const openSpaceInput = view.container.querySelector(
      "#reservation-entry-tier-open-space"
    ) as HTMLInputElement;
    const reservedDeskInput = view.container.querySelector(
      "#reservation-entry-tier-reserved-desk"
    ) as HTMLInputElement;

    expect(openSpaceInput.checked).toBe(true);
    expect(reservedDeskInput.checked).toBe(false);

    await act(async () => {
      fireEvent.click(reservedDeskInput);
    });
    await waitFor(() => {
      expect(reservedDeskInput.checked).toBe(true);
      expect(openSpaceInput.checked).toBe(false);
    });

    await act(async () => {
      fireEvent.click(openSpaceInput);
    });
    await waitFor(() => {
      expect(openSpaceInput.checked).toBe(true);
      expect(reservedDeskInput.checked).toBe(false);
    });
    await act(async () => {
      view.unmount();
    });
  });

  test("drops the removed shell slot props from the cowork form", () => {
    const source = readFileSync(
      join(import.meta.dir, "cowork-reservation-form.tsx"),
      "utf8"
    );
    expect(source).not.toContain("afterCustomerFields");
    expect(source).not.toContain("messagePlaceholder");
  });

  test("shows one shared optional add-on toggle per tier", async () => {
    workspaceUseSearchParams.mockReturnValue(
      new URLSearchParams("entryTier=open-space&date=2099-07-30")
    );
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (url.startsWith("/api/workspace/availability")) {
        return Promise.resolve(jsonResponse(availabilityResponse));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as typeof fetch;

    const view = renderForm();

    // Both offers render; Open Space carries only the coffee add-on.
    expect(
      view.container.querySelectorAll("[data-reservation-type-option]")
    ).toHaveLength(2);
    const coffeeToggle = view.container.querySelector(
      "[data-cowork-optional-addon-toggle]"
    );
    expect(
      coffeeToggle?.getAttribute("data-cowork-optional-addon-toggle")
    ).toBe("coffee");
    expect(
      view.container.querySelectorAll("[data-cowork-optional-addon-toggle]")
    ).toHaveLength(1);
    expect(
      view.container.querySelector("[data-reservation-coffee-price]")
    ).not.toBeNull();
    expect(
      view.container.querySelector("[data-reservation-workstation-price]")
    ).toBeNull();

    await act(async () => {
      fireEvent.click(
        view.container.querySelector(
          "#reservation-entry-tier-reserved-desk"
        ) as HTMLElement
      );
    });

    // Reserved Desk carries only the workstation add-on.
    await waitFor(() => {
      expect(
        view.container
          .querySelector("[data-cowork-optional-addon-toggle]")
          ?.getAttribute("data-cowork-optional-addon-toggle")
      ).toBe("workstation");
    });
    expect(
      view.container.querySelectorAll("[data-cowork-optional-addon-toggle]")
    ).toHaveLength(1);
    expect(
      view.container.querySelector("[data-reservation-workstation-price]")
    ).not.toBeNull();
    expect(
      view.container.querySelector("[data-reservation-coffee-price]")
    ).toBeNull();

    // Both add-ons share one presentational toggle: same test id path and
    // identical card markup classes, never two divergent presentations.
    const workstationToggle = view.container.querySelector(
      "[data-cowork-optional-addon-toggle='workstation']"
    );
    expect(workstationToggle?.getAttribute("class")).toBe(
      coffeeToggle?.getAttribute("class")
    );
    expect(coffeeToggle?.childElementCount).toBe(
      workstationToggle?.childElementCount
    );

    await act(async () => {
      view.unmount();
    });
  });

  test("matches the spatial thesis in DOM order with monitors selected", async () => {
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (url.startsWith("/api/workspace/availability")) {
        return Promise.resolve(jsonResponse(availabilityResponse));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as typeof fetch;

    const view = renderForm({
      initialValues: {
        ...coworkReservationDefaultValues,
        entryTier: "reserved-desk",
        date: "2099-07-30",
        monitorOption: "2x27-qhd",
      },
    });

    const form = view.container.querySelector("form");
    expect(form).not.toBeNull();
    const ordered = Array.from(form!.querySelectorAll("*"));
    const at = (element: Element | null | undefined) => {
      expect(element).toBeTruthy();
      return ordered.indexOf(element as Element);
    };

    const offer = form!.querySelector(
      "[data-reservation-type-option='open-space']"
    );
    const dateField = form!.querySelector("input[name='date']");
    const addon = form!.querySelector(
      "[data-cowork-optional-addon-toggle='workstation']"
    );
    const monitors = form!
      .querySelector("input[value='2x27-qhd']")
      ?.closest("[role='radiogroup']");
    const email = form!.querySelector("input[name='email']");
    const invoice = view.getByRole("checkbox", { name: "Create invoice" });
    const privacy = form!.querySelector("a[href*='privacy-policy']");
    const marketing = form!.querySelector("#reservation-marketing-consent");
    const submit = view.getByRole("button", { name: "Continue" });

    // offer -> date/notices -> add-on -> monitors -> contact -> billing ->
    // privacy -> marketing -> submit. DOM order is focus order here: no
    // element reorders itself with tabindex.
    expect(at(offer)).toBeLessThan(at(dateField));
    expect(at(dateField)).toBeLessThan(at(addon));
    expect(at(addon)).toBeLessThan(at(monitors));
    expect(at(monitors)).toBeLessThan(at(email));
    expect(at(email)).toBeLessThan(at(invoice));
    expect(at(invoice)).toBeLessThan(at(privacy));
    expect(at(privacy)).toBeLessThan(at(marketing));
    expect(at(marketing)).toBeLessThan(at(submit));

    await act(async () => {
      view.unmount();
    });
  });

  test("gives each monitor group a unique ID separate from its workstation switch", async () => {
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (url.startsWith("/api/workspace/availability")) {
        return Promise.resolve(jsonResponse(availabilityResponse));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as typeof fetch;

    const initialValues = {
      ...coworkReservationDefaultValues,
      entryTier: "reserved-desk" as const,
      date: "2099-07-30",
      monitorOption: "2x27-qhd" as const,
    };
    const firstView = renderForm({ initialValues });
    const secondView = renderForm({ initialValues });
    const monitorGroupIds = [firstView, secondView].map((view) => {
      const workstationSwitch = within(view.container).getByRole("switch", {
        name: "Monitor workstation",
      });
      const monitorGroup = view.container
        .querySelector<HTMLInputElement>("input[value='2x27-qhd']")
        ?.closest<HTMLElement>("[role='radiogroup']");
      expect(monitorGroup).not.toBeNull();
      const monitorGroupId = monitorGroup?.getAttribute("id");

      expect(monitorGroupId).not.toBeNull();
      expect(monitorGroupId).not.toBe(workstationSwitch.getAttribute("id"));
      return monitorGroupId;
    });

    expect(monitorGroupIds[0]).not.toBe(monitorGroupIds[1]);
    await act(async () => {
      firstView.unmount();
      secondView.unmount();
    });
  });

  test("names the monitor group from the visible Monitor setup label", async () => {
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (url.startsWith("/api/workspace/availability")) {
        return Promise.resolve(jsonResponse(availabilityResponse));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as typeof fetch;

    const view = renderForm({
      initialValues: {
        ...coworkReservationDefaultValues,
        entryTier: "reserved-desk",
        date: "2099-07-30",
        monitorOption: "2x27-qhd",
      },
    });

    expect(
      view.getByRole("switch", { name: "Monitor workstation" })
    ).toBeDefined();
    const monitorGroup = view.getByRole("radiogroup", {
      name: "Monitor setup",
    });
    const labelId = monitorGroup.getAttribute("aria-labelledby");
    expect(labelId).not.toBeNull();
    expect(document.getElementById(labelId!)?.textContent).toBe(
      "Monitor setup"
    );

    await act(async () => {
      view.unmount();
    });
  });

  test("describes monitor validation errors from the monitor group", async () => {
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (url.startsWith("/api/workspace/availability")) {
        return Promise.resolve(jsonResponse(availabilityResponse));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as typeof fetch;

    const view = renderForm({
      initialValues: {
        ...coworkReservationDefaultValues,
        entryTier: "reserved-desk",
        date: "2099-07-30",
        monitorOption: "invalid-monitor-option" as never,
      },
    });
    const monitorGroup = view.container
      .querySelector<HTMLInputElement>("input[value='2x27-qhd']")
      ?.closest<HTMLElement>("[role='radiogroup']");
    expect(monitorGroup).not.toBeNull();
    const continueButton = view.getByRole("button", { name: "Continue" });
    await waitFor(() => {
      expect(continueButton.hasAttribute("disabled")).toBe(false);
    });

    fireEvent.click(continueButton);

    await waitFor(() => {
      expect(monitorGroup?.getAttribute("aria-invalid")).toBe("true");
    });
    const descriptionId = monitorGroup?.getAttribute("aria-describedby");
    expect(descriptionId).not.toBeNull();
    const description = document.getElementById(descriptionId!);
    expect(description).not.toBeNull();
    expect(description?.textContent).toBeTruthy();

    await act(async () => {
      view.unmount();
    });
  });

  test("shows monitor card focus treatment when its radio receives focus", async () => {
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (url.startsWith("/api/workspace/availability")) {
        return Promise.resolve(jsonResponse(availabilityResponse));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as typeof fetch;

    const view = renderForm({
      initialValues: {
        ...coworkReservationDefaultValues,
        entryTier: "reserved-desk",
        date: "2099-07-30",
        monitorOption: "2x27-qhd",
      },
    });
    await waitFor(() => {
      expect(
        view.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
      ).toBe(false);
    });
    const radio = view.container.querySelector<HTMLInputElement>(
      "input[type='radio'][value='2x27-qhd']"
    );
    expect(radio).not.toBeNull();
    const option = radio!.closest("label");
    expect(option).not.toBeNull();

    await act(async () => {
      radio!.focus();
    });

    expect(document.activeElement).toBe(radio);
    expect(option?.contains(radio!)).toBe(true);
    expect(option?.className).toContain("focus-within:outline");
    expect(option?.className).toContain("focus-within:outline-2");
    expect(option?.className).toContain("focus-within:outline-offset-2");
    expect(option?.className).toContain("focus-within:outline-navy-blue");

    await act(async () => {
      view.unmount();
    });
  });

  test("renders monitor choices below the workstation toggle only while selected", async () => {
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (url.startsWith("/api/workspace/availability")) {
        return Promise.resolve(jsonResponse(availabilityResponse));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as typeof fetch;

    const view = renderForm({
      initialValues: {
        ...coworkReservationDefaultValues,
        entryTier: "reserved-desk",
        date: "2099-07-30",
      },
    });

    // Workstation unselected: no monitor radiogroup anywhere in the form.
    expect(view.container.querySelector("input[value='2x27-qhd']")).toBeNull();

    await act(async () => {
      fireEvent.click(
        view.getByRole("switch", { name: /Monitor workstation/i })
      );
    });

    // Workstation selected: the monitor radiogroup is directly below the
    // toggle and above the contact fields.
    await waitFor(() => {
      expect(
        view.container.querySelector("input[value='2x27-qhd']")
      ).not.toBeNull();
    });
    const toggle = view.container.querySelector(
      "[data-cowork-optional-addon-toggle='workstation']"
    );
    expect(toggle).not.toBeNull();
    const monitors = view.container
      .querySelector("input[value='2x27-qhd']")
      ?.closest("[role='radiogroup']");
    expect(monitors).not.toBeNull();
    expect(toggle?.nextElementSibling?.contains(monitors as Node)).toBe(true);
    const form = view.container.querySelector("form")!;
    const ordered = Array.from(form.querySelectorAll("*"));
    expect(ordered.indexOf(monitors as Element)).toBeLessThan(
      ordered.indexOf(form.querySelector("input[name='email']") as Element)
    );

    // Turning the workstation off removes the monitor choices and clears the
    // monitorOption field (covered end-to-end by the submission test above).
    await act(async () => {
      fireEvent.click(
        view.getByRole("switch", { name: /Monitor workstation/i })
      );
    });
    await waitFor(() => {
      expect(
        view.container.querySelector("input[value='2x27-qhd']")
      ).toBeNull();
    });

    await act(async () => {
      view.unmount();
    });
  });

  test("renders add-on labels from the en-US and cs-CZ catalogs", async () => {
    const expectations = [
      { locale: "en-US", tier: "open-space", name: "Coffee" },
      { locale: "cs-CZ", tier: "open-space", name: "Káva" },
      { locale: "en-US", tier: "reserved-desk", name: "Monitor workstation" },
      {
        locale: "cs-CZ",
        tier: "reserved-desk",
        name: "Pracovní stanice s monitory",
      },
    ] as const;

    for (const { locale, name, tier } of expectations) {
      const view = renderForm({
        locale,
        initialValues: {
          ...coworkReservationDefaultValues,
          entryTier: tier,
          date: "2099-07-30",
        },
      });
      expect(view.getByRole("switch", { name })).toBeDefined();
      await act(async () => {
        view.unmount();
      });
    }
  });

  test("keeps add-on and monitor layouts free of grid-template-areas orphans", async () => {
    const source = readFileSync(
      join(import.meta.dir, "cowork-reservation-form.tsx"),
      "utf8"
    );
    // The coffee add-on left the date grid-template-areas spot entirely.
    expect(source).not.toContain("grid-area:coffee");
    expect(source).not.toMatch(/grid-template-areas:[^"']*\bcoffee\b/);

    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (url.startsWith("/api/workspace/availability")) {
        return Promise.resolve(jsonResponse(availabilityResponse));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as typeof fetch;

    const view = renderForm({
      initialValues: {
        ...coworkReservationDefaultValues,
        entryTier: "reserved-desk",
        date: "2099-07-30",
        monitorOption: "2x27-qhd",
      },
    });

    // Date/notices keep their own grouping without the retired coffee area
    // or its desktop column partner.
    const dateGroup = Array.from(view.container.querySelectorAll("div")).find(
      (div) => div.className.includes("grid-template-areas")
    );
    expect(dateGroup?.className).toContain("'date'");
    expect(dateGroup?.className).not.toContain("coffee");
    expect(dateGroup?.className).not.toContain("md:grid-cols-2");

    // The add-on is its own row below that group, not pinned into its cells.
    const addon = view.container.querySelector(
      "[data-cowork-optional-addon-toggle]"
    );
    expect(addon).not.toBeNull();
    expect(dateGroup?.contains(addon as Node)).toBe(false);

    // 320px stacks the monitor choices in one column; 768px/1280px may open
    // three. No base grid-cols-3 forces a squeeze at the smallest width.
    const monitors = view.container
      .querySelector("input[value='2x27-qhd']")
      ?.closest("[role='radiogroup']");
    expect(monitors?.classList.contains("grid")).toBe(true);
    expect(monitors?.classList.contains("sm:grid-cols-3")).toBe(true);
    expect(monitors?.classList.contains("grid-cols-3")).toBe(false);

    await act(async () => {
      view.unmount();
    });
  });
});
