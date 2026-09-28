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
});
