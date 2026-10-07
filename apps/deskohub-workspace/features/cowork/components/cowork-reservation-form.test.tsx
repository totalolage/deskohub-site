import {
  afterAll,
  afterEach,
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
import { getWorkspaceAvailabilityQueryFromReservationSearchParams } from "@/features/reservation/reservation-checkout-query";
import { workspaceAvailabilityKeys } from "@/features/reservation/workspace-availability";
import {
  workspaceRouterPush as push,
  workspaceUseAction,
  workspaceUseSearchParams,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

mock.module("next/image", () => ({
  default: () => null,
}));

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

mock.module("@/features/reservation/actions/prepare-pay-state", () => ({
  preparePayState: mock(),
}));

mock.module("@/features/reservation/actions/submit-reservation", () => ({
  submitReservation: mock(),
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
  reservedDeskWorkstationRequiredDates: [],
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

const reservedDeskFormValues = (
  date = "2099-07-30",
  monitorOption?: (typeof workspaceProductMonitorOptions)[number]
) => ({
  ...coworkReservationDefaultValues,
  entryTier: "reserved-desk" as const,
  date,
  monitorOption,
  name: "Ada Lovelace",
  email: "ada@example.test",
  phone: "+420777777777",
});

const requiredWorkstationAvailability = (
  date = "2099-07-30",
  monitorOption?: (typeof workspaceProductMonitorOptions)[number] | null
) => ({
  ...availabilityResponse,
  date,
  unavailableDates: monitorOption ? [] : [date],
  reservedDeskWorkstationRequiredDates: [date],
  unavailableMonitorOptions: ["2x27-qhd"],
});

const getCalendarDateButton = async (dialog: HTMLElement, date: string) => {
  const targetDate = new Date(`${date}T12:00:00`);
  const currentMonthLabel = within(dialog).getByRole("status").textContent;
  const currentMonthDate = new Date(
    currentMonthLabel?.replace(" ", " 1, ") ?? ""
  );
  const monthsToNavigate =
    (targetDate.getFullYear() - currentMonthDate.getFullYear()) * 12 +
    targetDate.getMonth() -
    currentMonthDate.getMonth();
  for (let month = 0; month < Math.abs(monthsToNavigate); month += 1) {
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", {
          name:
            monthsToNavigate > 0
              ? "Go to the Next Month"
              : "Go to the Previous Month",
        })
      );
    });
  }
  const formattedMonth = targetDate.toLocaleDateString("en-US", {
    month: "long",
  });
  const dateButton = await within(dialog).findByRole("button", {
    name: new RegExp(
      `${formattedMonth} ${targetDate.getDate()}(?:st|nd|rd|th)?, ${targetDate.getFullYear()}`
    ),
  });
  return dateButton;
};

const selectCalendarDate = async (
  view: ReturnType<typeof renderForm>,
  date: string
) => {
  const datePickerButton = view.getByRole("button", {
    name: /Reservation date/i,
  });
  await act(async () => fireEvent.click(datePickerButton));
  const dialog = await within(document.body).findByRole("dialog");
  const dateButton = await getCalendarDateButton(dialog, date);
  expect((dateButton as HTMLButtonElement).disabled).toBe(false);
  await act(async () => fireEvent.click(dateButton));
};

const dateOffsetFromToday = (days: number) =>
  Temporal.Now.plainDateISO().add({ days }).toString();

describe("CoworkReservationForm advertised pricing", () => {
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

  afterEach(async () => {
    cleanup();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
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
    const reservedDeskPrice = view.container.querySelector(
      '[data-reservation-type-price="reserved-desk"]'
    );
    expect(reservedDeskPrice?.querySelector("del")?.className).toContain(
      "text-[0.6em]"
    );
    expect(
      reservedDeskPrice?.querySelector(".text-aquamarine-ink")?.className
    ).not.toContain("text-[0.6em]");
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
    expect(openSpacePrice?.textContent).toContain("/ day");
    expect(openSpacePrice?.querySelector("del")?.className).toContain(
      "text-navy-blue/45"
    );
    expect(openSpacePrice?.querySelector("del")?.className).toContain(
      "text-[0.6em]"
    );
    expect(
      Array.from(openSpacePrice?.querySelectorAll("span") ?? []).some(
        (element) => element.className.includes("text-aquamarine-ink")
      )
    ).toBe(true);
    expect(
      Array.from(openSpacePrice?.querySelectorAll("span") ?? []).find(
        (element) => element.className.includes("text-aquamarine-ink")
      )?.className
    ).not.toContain("text-[0.6em]");

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

  test("renders cowork offers as portrait illustrated choices", () => {
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

    expect(offerGrid?.getAttribute("data-reservation-type-presentation")).toBe(
      "illustrated"
    );
    expect(offerGrid?.classList.contains("grid")).toBe(true);
    expect(offerGrid?.classList.contains("gap-4")).toBe(true);
    for (const offer of offers) {
      expect(offer.querySelector('input[type="radio"]')).not.toBeNull();
      expect(
        offer.querySelector("[data-reservation-type-description]")
      ).not.toBeNull();
      expect(
        offer.querySelector("[data-reservation-type-illustration]")
      ).not.toBeNull();
      expect(
        offer.querySelector("[data-reservation-type-perks]")
      ).not.toBeNull();
      const showcase = offer.querySelector("[data-cowork-tier-showcase]");
      const perks = offer.querySelector("[data-reservation-type-perks]");
      expect(showcase).not.toBeNull();
      expect(perks).not.toBeNull();
      expect(showcase?.nextElementSibling).toBe(perks);
      const perksLabelId = perks?.querySelector(".sr-only")?.getAttribute("id");
      expect(perks?.querySelector("ul")?.getAttribute("aria-labelledby")).toBe(
        perksLabelId
      );
      expect(
        offer
          .querySelector("[data-reservation-type-illustration]")
          ?.getAttribute("aria-hidden")
      ).toBe("true");
      expect(perks?.querySelector("li > span")?.classList.contains("h-8")).toBe(
        true
      );
    }
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

  test("does not render a message field in the cowork form", () => {
    const view = renderForm();
    const form = view.container.querySelector("form");

    expect(form).not.toBeNull();
    expect(form?.querySelector("textarea")).toBeNull();
    expect(
      within(form!).queryByRole("textbox", { name: /message/i })
    ).toBeNull();
    view.unmount();
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
        return Promise.resolve(
          jsonResponse({
            ...availabilityResponse,
            notices: [
              {
                date: "2099-07-30",
                startsAt: "12:00",
                endsAt: "14:00",
              },
            ],
          })
        );
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

    const dateAddonRow = form!.querySelector("[data-cowork-date-addon-row]");
    const dateColumn = form!.querySelector("[data-cowork-date-column]");
    const addonColumn = form!.querySelector("[data-cowork-addon-column]");
    const dateNotice = await view.findByText(
      "From 12:00 to 14:00, the workspace may be busier than usual."
    );
    const dateNoticeRegion = dateNotice.closest("p[aria-live='polite']");
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

    expect(dateAddonRow?.classList.contains("grid")).toBe(true);
    expect(dateAddonRow?.classList.contains("lg:grid-cols-2")).toBe(true);
    expect(dateAddonRow?.classList.contains("grid-cols-2")).toBe(false);
    expect(dateColumn?.parentElement).toBe(dateAddonRow);
    expect(addonColumn?.parentElement).toBe(dateAddonRow);
    expect(dateColumn?.nextElementSibling).toBe(addonColumn);
    expect(dateColumn?.contains(dateNoticeRegion)).toBe(true);
    expect(dateNoticeRegion?.getAttribute("aria-live")).toBe("polite");

    // offer -> date/notices -> add-on -> monitors -> contact -> billing ->
    // privacy -> marketing -> submit. DOM order is focus order here: no
    // element reorders itself with tabindex.
    expect(at(offer)).toBeLessThan(at(dateField));
    expect(at(dateField)).toBeLessThan(at(dateNoticeRegion));
    expect(at(dateNoticeRegion)).toBeLessThan(at(addon));
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
    const addonColumn = view.container.querySelector(
      "[data-cowork-addon-column]"
    );
    const addonControl = view.container.querySelector(
      "[data-cowork-addon-control]"
    );
    const toggle = view.container.querySelector(
      "[data-cowork-optional-addon-toggle='workstation']"
    );
    expect(toggle).not.toBeNull();
    const monitors = view.container
      .querySelector("input[value='2x27-qhd']")
      ?.closest("[role='radiogroup']");
    expect(monitors).not.toBeNull();
    const monitorOptions = monitors?.closest("[data-cowork-monitor-options]");
    expect(addonControl?.contains(toggle as Node)).toBe(true);
    expect(addonControl?.nextElementSibling).toBe(monitorOptions);
    expect(monitorOptions?.parentElement).toBe(addonColumn);
    expect(monitorOptions?.classList.contains("lg:col-span-2")).toBe(true);
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

  test("keeps cowork access claims in one card section in both locales", async () => {
    const expectations = [
      {
        locale: "en-US",
        openSpaceDescription: "Sit wherever you like, available until 17:00.",
        openSpaceWifi: "High-speed Wi-Fi",
        reservedDeskDescription: "Your own desk for uninterrupted flow.",
        reservedDeskAccess: "24/7 access on your reserved day",
        reservedDeskCoffee: "Coffee included",
        reservedDeskMonitor: "Optional monitor workstation",
        currency: "CZK",
      },
      {
        locale: "cs-CZ",
        openSpaceDescription: "Seďte, kde chcete, k dispozici do 17:00.",
        openSpaceWifi: "Vysokorychlostní Wi-Fi",
        reservedDeskDescription: "Váš vlastní stůl pro nepřetržitý flow.",
        reservedDeskAccess: "24/7 přístup v den tvé rezervace",
        reservedDeskCoffee: "Káva v ceně",
        reservedDeskMonitor: "Možnost přidat monitory a dock",
        currency: "Kč",
      },
    ] as const;

    for (const copy of expectations) {
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

      const view = renderForm({
        locale: copy.locale,
        initialValues: {
          ...coworkReservationDefaultValues,
          entryTier: "open-space",
          coffee: true,
          date: "2099-07-30",
        },
      });

      await waitFor(() => {
        const openSpacePrice = view.container.querySelector(
          '[data-reservation-type-price="open-space"]'
        );
        const reservedDeskPrice = view.container.querySelector(
          '[data-reservation-type-price="reserved-desk"]'
        );
        expect(openSpacePrice?.textContent).toContain("290");
        expect(openSpacePrice?.textContent).toContain(copy.currency);
        expect(reservedDeskPrice?.textContent).toContain("410");
        expect(reservedDeskPrice?.textContent).toContain(copy.currency);
        expect(
          view.container.querySelector("[data-reservation-coffee-price]")
            ?.textContent
        ).toContain("50");
      });

      const openSpaceDescription = view.container.querySelector(
        '[data-reservation-type-description="open-space"]'
      )?.textContent;
      const openSpacePerks = view.container.querySelector(
        '[data-reservation-type-perks="open-space"]'
      )?.textContent;
      const reservedDeskDescription = view.container.querySelector(
        '[data-reservation-type-description="reserved-desk"]'
      )?.textContent;
      const reservedDeskPerks = view.container.querySelector(
        '[data-reservation-type-perks="reserved-desk"]'
      )?.textContent;

      expect(openSpaceDescription).toBe(copy.openSpaceDescription);
      expect(openSpaceDescription).not.toMatch(/24\/7/);
      expect(openSpacePerks).toContain(copy.openSpaceWifi);
      expect(openSpacePerks).not.toMatch(/00:00|17:00|24\/7/);
      expect(reservedDeskDescription).toBe(copy.reservedDeskDescription);
      expect(reservedDeskDescription).not.toMatch(/24\/7/);
      expect(reservedDeskPerks).toContain(copy.reservedDeskAccess);
      expect(reservedDeskPerks).toContain(copy.reservedDeskCoffee);
      expect(reservedDeskPerks).toContain(copy.reservedDeskMonitor);
      expect(
        `${reservedDeskDescription} ${reservedDeskPerks}`.match(/24\/7/g)
      ).toHaveLength(1);

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
      expect(
        view.container.querySelector("[data-reservation-coffee-price]")
      ).toBeNull();

      await act(async () => {
        view.unmount();
      });
    }
  });

  test("pairs either optional cowork add-on with the date in responsive columns", async () => {
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (url.startsWith("/api/workspace/availability")) {
        return Promise.resolve(jsonResponse(availabilityResponse));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as typeof fetch;

    const cases = [
      {
        addon: "coffee",
        initialValues: {
          ...coworkReservationDefaultValues,
          entryTier: "open-space" as const,
          date: "2099-07-30",
          coffee: true,
        },
      },
      {
        addon: "workstation",
        initialValues: {
          ...coworkReservationDefaultValues,
          entryTier: "reserved-desk" as const,
          date: "2099-07-30",
          monitorOption: undefined,
        },
      },
    ] as const;

    for (const { addon, initialValues } of cases) {
      const view = renderForm({ initialValues });
      const dateAddonRow = view.container.querySelector(
        "[data-cowork-date-addon-row]"
      );
      const dateColumn = view.container.querySelector(
        "[data-cowork-date-column]"
      );
      const addonColumn = view.container.querySelector(
        "[data-cowork-addon-column]"
      );
      const addonControl = view.container.querySelector(
        "[data-cowork-addon-control]"
      );
      const toggle = view.container.querySelector(
        `[data-cowork-optional-addon-toggle='${addon}']`
      );

      expect(dateAddonRow?.classList.contains("lg:grid-cols-2")).toBe(true);
      expect(dateAddonRow?.classList.contains("grid-cols-2")).toBe(false);
      expect(dateColumn?.parentElement).toBe(dateAddonRow);
      expect(addonColumn?.parentElement).toBe(dateAddonRow);
      expect(dateColumn?.nextElementSibling).toBe(addonColumn);
      expect(addonColumn?.classList.contains("contents")).toBe(true);
      expect(addonControl?.parentElement).toBe(addonColumn);
      expect(addonControl?.contains(toggle as Node)).toBe(true);
      expect(
        view.container.querySelectorAll("[data-cowork-optional-addon-toggle]")
      ).toHaveLength(1);

      await act(async () => {
        view.unmount();
      });
    }
  });

  test("forces the first available paid workstation and submits its advertised variant", async () => {
    const availabilityRequests: string[] = [];
    getAdvertisedPrices.mockImplementation((requests) =>
      Promise.resolve(
        advertisedPricesResult(requests, getCoworkAdvertisedPriceResponse)
      )
    );
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (!url.startsWith("/api/workspace/availability")) {
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }

      availabilityRequests.push(url);
      const monitorOption = new URL(url, "http://localhost").searchParams.get(
        "monitorOption"
      );
      return Promise.resolve(
        jsonResponse(
          requiredWorkstationAvailability(
            "2099-07-30",
            monitorOption as
              | (typeof workspaceProductMonitorOptions)[number]
              | null
          )
        )
      );
    }) as typeof fetch;

    const view = renderForm({
      initialValues: reservedDeskFormValues(),
    });
    const workstationSwitch = view.getByRole("switch", {
      name: "Monitor workstation",
    });

    await waitFor(() => {
      expect(
        (
          view.container.querySelector(
            "input[type='radio'][value='2x32-qhd']"
          ) as HTMLInputElement | null
        )?.checked
      ).toBe(true);
      expect(workstationSwitch.getAttribute("aria-checked")).toBe("true");
      expect(workstationSwitch.hasAttribute("disabled")).toBe(true);
      expect(
        view.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
      ).toBe(false);
    });

    expect(
      availabilityRequests.some((url) => url.includes("monitorOption=2x32-qhd"))
    ).toBe(true);
    expect(
      view.container.querySelector("[data-reservation-workstation-price]")
        ?.textContent
    ).toContain("120");

    const help = view.getByRole("button", {
      name: "Why is a workstation required?",
    });
    expect(help.tagName).toBe("BUTTON");
    expect(help.hasAttribute("disabled")).toBe(false);
    await act(async () => help.focus());
    const tooltip = await within(view.baseElement).findByRole("tooltip");
    expect(tooltip.textContent).toBe(
      "All desks without a workstation are fully booked for this date. A workstation is required."
    );
    expect(help.getAttribute("aria-describedby")).toBe(tooltip.id);
    await act(async () => {
      fireEvent.pointerMove(help, { pointerType: "mouse" });
    });
    expect(
      (await within(view.baseElement).findByRole("tooltip")).textContent
    ).toBe(tooltip.textContent);

    fireEvent.click(workstationSwitch);
    expect(workstationSwitch.getAttribute("aria-checked")).toBe("true");

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Continue" }));
    });
    await waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    const submission = execute.mock.calls[0]?.[0] as {
      readonly advertisedPriceToken?: string;
      readonly reservation?: {
        readonly date?: string;
        readonly entryTier?: string;
        readonly monitorOption?: string;
      };
    };
    expect(submission.advertisedPriceToken).toBe(
      "sealed-reserved-desk-workstation-advertised-price"
    );
    expect(submission.reservation).toMatchObject({
      date: "2099-07-30",
      entryTier: "reserved-desk",
      monitorOption: "2x32-qhd",
    });
  });

  test("uses one bare availability snapshot for required and selected workstation availability", async () => {
    const searchParams = new URLSearchParams(
      "entryTier=reserved-desk&date=2099-07-30"
    );
    workspaceUseSearchParams.mockReturnValue(searchParams);
    const baseQuery =
      getWorkspaceAvailabilityQueryFromReservationSearchParams(searchParams);
    const bareQuery = {
      ...baseQuery,
      entryTier: "reserved-desk" as const,
      date: "2099-07-30",
    };
    const rangeQuery = {
      kind: "cowork" as const,
      from: baseQuery.from,
      to: baseQuery.to,
      entryTier: "reserved-desk" as const,
    };
    const monitorQuery = {
      ...bareQuery,
      monitorOption: "2x32-qhd" as const,
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    });
    queryClient.setQueryData(
      [...workspaceAvailabilityKeys.availability(bareQuery), null],
      {
        ...requiredWorkstationAvailability("2099-07-30"),
        from: bareQuery.from,
        to: bareQuery.to,
      }
    );
    queryClient.setQueryData(
      [...workspaceAvailabilityKeys.availability(monitorQuery), null],
      {
        ...availabilityResponse,
        date: "2099-07-30",
        from: monitorQuery.from,
        to: monitorQuery.to,
        unavailableDates: [],
        reservedDeskWorkstationRequiredDates: [],
        unavailableMonitorOptions: ["2x32-qhd"],
      }
    );
    queryClient.setQueryData(
      [...workspaceAvailabilityKeys.availability(rangeQuery), null],
      {
        ...availabilityResponse,
        date: undefined,
        from: rangeQuery.from,
        to: rangeQuery.to,
      }
    );
    getAdvertisedPrices.mockImplementation((requests) =>
      Promise.resolve(
        advertisedPricesResult(requests, getCoworkAdvertisedPriceResponse)
      )
    );

    let renderCount = 0;
    function CountedReservationForm() {
      renderCount += 1;
      return (
        <CoworkReservationForm
          initialValues={reservedDeskFormValues()}
          locale="en-US"
        />
      );
    }

    const view = render(
      <QueryClientProvider client={queryClient}>
        <CountedReservationForm />
      </QueryClientProvider>
    );
    const selectedMonitor = view.container.querySelector<HTMLInputElement>(
      "input[type='radio'][value='2x32-qhd']"
    );

    await waitFor(() => expect(selectedMonitor?.checked).toBe(true));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(selectedMonitor?.checked).toBe(true);
    expect(selectedMonitor?.disabled).toBe(false);
    expect(
      view.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
    ).toBe(false);
    const settledRenderCount = renderCount;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(renderCount).toBe(settledRenderCount);
    expect(
      view
        .getByRole("switch", { name: "Monitor workstation" })
        .getAttribute("aria-checked")
    ).toBe("true");
  });

  test("blocks checkout when the settled selected-date response closes an otherwise available date", async () => {
    const selectedDate = dateOffsetFromToday(1);
    const searchParams = new URLSearchParams(
      `entryTier=open-space&date=${selectedDate}`
    );
    workspaceUseSearchParams.mockReturnValue(searchParams);
    const baseQuery =
      getWorkspaceAvailabilityQueryFromReservationSearchParams(searchParams);
    const rangeQuery = {
      kind: "cowork" as const,
      from: baseQuery.from,
      to: baseQuery.to,
      entryTier: "open-space" as const,
    };
    const selectedDateQuery = { ...rangeQuery, date: selectedDate };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    });
    queryClient.setQueryData(
      [...workspaceAvailabilityKeys.availability(rangeQuery), null],
      {
        ...availabilityResponse,
        date: undefined,
        from: rangeQuery.from,
        to: rangeQuery.to,
        unavailableDates: [],
      }
    );
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (!url.startsWith("/api/workspace/availability")) {
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }

      const params = new URL(url, "http://localhost").searchParams;
      const date = params.get("date");
      return Promise.resolve(
        jsonResponse(
          date
            ? {
                ...availabilityResponse,
                date,
                unavailableDates: [selectedDate],
                unavailableCoworkTiers: [],
                unavailableMonitorOptions: [],
              }
            : {
                ...availabilityResponse,
                date: undefined,
                from: params.get("from"),
                to: params.get("to"),
                unavailableDates: [],
              }
        )
      );
    }) as typeof fetch;

    const view = renderForm(
      {
        initialValues: {
          ...coworkReservationDefaultValues,
          entryTier: "open-space",
          date: selectedDate,
          name: "Ada Lovelace",
          email: "ada@example.test",
          phone: "+420777777777",
        },
      },
      queryClient
    );
    await view.findByText(/original price.*290/i, {}, { timeout: 5000 });

    const selectedDateAvailabilityKey = [
      ...workspaceAvailabilityKeys.availability(selectedDateQuery),
      null,
    ];
    await waitFor(() => {
      expect(
        queryClient.getQueryData(selectedDateAvailabilityKey)
      ).toMatchObject({
        date: selectedDate,
        unavailableDates: [selectedDate],
        unavailableCoworkTiers: [],
        unavailableMonitorOptions: [],
      });
    });
    expect(
      queryClient.getQueryData([
        ...workspaceAvailabilityKeys.availability(rangeQuery),
        null,
      ])
    ).toMatchObject({ unavailableDates: [] });

    const continueButton = view.getByRole("button", { name: "Continue" });
    await waitFor(() => {
      expect(continueButton.hasAttribute("disabled")).toBe(true);
    });
    await act(async () => fireEvent.click(continueButton));
    expect(execute).not.toHaveBeenCalled();
    await act(async () => {
      view.unmount();
    });
  });

  test("blocks checkout with an availability error when the selected-date query fails after retries", async () => {
    const selectedDate = dateOffsetFromToday(1);
    const searchParams = new URLSearchParams(
      `entryTier=open-space&date=${selectedDate}&coffee=true&name=Ada%20Lovelace&email=ada%40example.test&phone=%2B420777777777`
    );
    workspaceUseSearchParams.mockReturnValue(searchParams);
    const baseQuery =
      getWorkspaceAvailabilityQueryFromReservationSearchParams(searchParams);
    const rangeQuery = {
      kind: "cowork" as const,
      from: baseQuery.from,
      to: baseQuery.to,
      entryTier: "open-space" as const,
    };
    const selectedDateQuery = { ...rangeQuery, date: selectedDate };
    const selectedDateQueryKey = [
      ...workspaceAvailabilityKeys.availability(selectedDateQuery),
      null,
    ];
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    });
    let selectedDateRequestCount = 0;
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (!url.startsWith("/api/workspace/availability")) {
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }

      const params = new URL(url, "http://localhost").searchParams;
      if (params.has("date")) {
        selectedDateRequestCount += 1;
        return Promise.reject(new Error("Selected-date availability failed"));
      }

      return Promise.resolve(
        jsonResponse({
          ...availabilityResponse,
          date: undefined,
          from: params.get("from"),
          to: params.get("to"),
          unavailableDates: [],
        })
      );
    }) as typeof fetch;
    getAdvertisedPrices.mockImplementation((requests) =>
      Promise.resolve(advertisedPricesResult(requests))
    );

    const view = renderForm(
      {
        initialValues: {
          ...coworkReservationDefaultValues,
          entryTier: "open-space",
          date: selectedDate,
          coffee: true,
          name: "Ada Lovelace",
          email: "ada@example.test",
          phone: "+420777777777",
        },
      },
      queryClient
    );
    await view.findByText(/original price.*290/i, {}, { timeout: 5000 });
    await waitFor(() => {
      expect(queryClient.getQueryState(selectedDateQueryKey)?.status).toBe(
        "error"
      );
    });
    expect(selectedDateRequestCount).toBe(4);

    const continueButton = view.getByRole("button", { name: "Continue" });
    expect(continueButton.hasAttribute("disabled")).toBe(true);
    expect(
      view.getByText("We couldn't confirm availability. Please try again.")
    ).toBeDefined();
    await act(async () => fireEvent.click(continueButton));
    expect(execute).not.toHaveBeenCalled();
    await act(async () => {
      view.unmount();
    });
  });

  test("keeps monitor choices non-interactive during a same-date workstation requirement refresh", async () => {
    const selectedDate = dateOffsetFromToday(1);
    const searchParams = new URLSearchParams(
      `entryTier=reserved-desk&date=${selectedDate}`
    );
    workspaceUseSearchParams.mockReturnValue(searchParams);
    const baseQuery =
      getWorkspaceAvailabilityQueryFromReservationSearchParams(searchParams);
    const bareQuery = {
      ...baseQuery,
      entryTier: "reserved-desk" as const,
      date: selectedDate,
    };
    const bareQueryKey = [
      ...workspaceAvailabilityKeys.availability(bareQuery),
      null,
    ];
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    });
    let bareQueryRequestCount = 0;
    let resolveBareQueryRefresh: ((response: Response) => void) | undefined;
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (!url.startsWith("/api/workspace/availability")) {
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }

      const params = new URL(url, "http://localhost").searchParams;
      const date = params.get("date");
      const monitorOption = params.get("monitorOption");
      if (!date) {
        return Promise.resolve(
          jsonResponse({
            ...availabilityResponse,
            date: undefined,
            from: params.get("from"),
            to: params.get("to"),
            unavailableDates: [],
          })
        );
      }
      if (date === selectedDate && monitorOption === null) {
        bareQueryRequestCount += 1;
        if (bareQueryRequestCount > 1) {
          return new Promise<Response>((resolve) => {
            resolveBareQueryRefresh = resolve;
          });
        }
        return Promise.resolve(
          jsonResponse({
            ...availabilityResponse,
            date,
            unavailableDates: [],
            reservedDeskWorkstationRequiredDates: [],
            unavailableMonitorOptions: ["2x27-qhd"],
          })
        );
      }
      return Promise.resolve(
        jsonResponse({
          ...availabilityResponse,
          date,
          unavailableDates: [],
          reservedDeskWorkstationRequiredDates: [],
          unavailableMonitorOptions: [],
        })
      );
    }) as typeof fetch;

    const view = renderForm(
      {
        initialValues: reservedDeskFormValues(selectedDate, "2x32-qhd"),
      },
      queryClient
    );
    const unavailableMonitor = view.container.querySelector<HTMLInputElement>(
      "input[type='radio'][value='2x27-qhd']"
    );
    const availableMonitor = view.container.querySelector<HTMLInputElement>(
      "input[type='radio'][value='2x32-qhd']"
    );
    const continueButton = view.getByRole("button", { name: "Continue" });
    await waitFor(() => {
      expect(unavailableMonitor?.disabled).toBe(true);
      expect(availableMonitor?.disabled).toBe(false);
      expect(availableMonitor?.checked).toBe(true);
      expect(continueButton.hasAttribute("disabled")).toBe(false);
    });

    let refresh: Promise<void> | undefined;
    await act(async () => {
      refresh = queryClient.refetchQueries({
        queryKey: bareQueryKey,
        exact: true,
      });
      await waitFor(() => expect(resolveBareQueryRefresh).toBeDefined());
    });
    await waitFor(() => {
      expect(
        queryClient.isFetching({ queryKey: bareQueryKey, exact: true })
      ).toBe(1);
      expect(continueButton.hasAttribute("disabled")).toBe(true);
    });

    expect(unavailableMonitor?.disabled).toBe(true);
    await act(async () => {
      if (!unavailableMonitor) {
        throw new Error("Expected the unavailable monitor radio");
      }
      fireEvent.click(unavailableMonitor);
    });
    expect(unavailableMonitor?.checked).toBe(false);
    expect(availableMonitor?.checked).toBe(true);
    expect(continueButton.hasAttribute("disabled")).toBe(true);
    expect(execute).not.toHaveBeenCalled();

    await act(async () => {
      resolveBareQueryRefresh?.(
        jsonResponse({
          ...availabilityResponse,
          date: selectedDate,
          unavailableDates: [],
          reservedDeskWorkstationRequiredDates: [],
          unavailableMonitorOptions: ["2x32-qhd"],
        })
      );
      await refresh;
    });
    await waitFor(() => {
      expect(unavailableMonitor?.disabled).toBe(false);
      expect(availableMonitor?.disabled).toBe(true);
      expect(continueButton.hasAttribute("disabled")).toBe(true);
    });
    expect(queryClient.getQueryData(bareQueryKey)).toMatchObject({
      unavailableMonitorOptions: ["2x32-qhd"],
    });
    expect(execute).not.toHaveBeenCalled();
    await act(async () => {
      view.unmount();
    });
  });

  test("blocks checkout after a failed workstation availability refetch despite stale data", async () => {
    const selectedDate = dateOffsetFromToday(1);
    const searchParams = new URLSearchParams(
      `entryTier=reserved-desk&date=${selectedDate}`
    );
    workspaceUseSearchParams.mockReturnValue(searchParams);
    const baseQuery =
      getWorkspaceAvailabilityQueryFromReservationSearchParams(searchParams);
    const bareQuery = {
      ...baseQuery,
      entryTier: "reserved-desk" as const,
      date: selectedDate,
    };
    const bareQueryKey = [
      ...workspaceAvailabilityKeys.availability(bareQuery),
      null,
    ];
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    });
    let failBareQuery = false;
    let bareQueryRequestCount = 0;
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (!url.startsWith("/api/workspace/availability")) {
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }

      const params = new URL(url, "http://localhost").searchParams;
      const date = params.get("date");
      const monitorOption = params.get("monitorOption");
      if (!date) {
        return Promise.resolve(
          jsonResponse({
            ...availabilityResponse,
            date: undefined,
            from: params.get("from"),
            to: params.get("to"),
            unavailableDates: [],
          })
        );
      }
      if (!monitorOption) {
        if (failBareQuery) {
          bareQueryRequestCount += 1;
          return Promise.reject(
            new Error("Workstation availability refresh failed")
          );
        }

        return Promise.resolve(
          jsonResponse({
            ...availabilityResponse,
            date,
            from: params.get("from"),
            to: params.get("to"),
            unavailableDates: [],
            reservedDeskWorkstationRequiredDates: [],
            unavailableMonitorOptions: [],
          })
        );
      }

      return Promise.resolve(
        jsonResponse({
          ...availabilityResponse,
          date,
          from: params.get("from"),
          to: params.get("to"),
          unavailableDates: [],
          reservedDeskWorkstationRequiredDates: [],
          unavailableMonitorOptions: [],
        })
      );
    }) as typeof fetch;
    getAdvertisedPrices.mockImplementation((requests) =>
      Promise.resolve(
        advertisedPricesResult(requests, getCoworkAdvertisedPriceResponse)
      )
    );

    const view = renderForm(
      {
        locale: "cs-CZ",
        initialValues: reservedDeskFormValues(selectedDate, "2x32-qhd"),
      },
      queryClient
    );
    const continueButton = view.getByRole("button", { name: "Pokračovat" });
    await waitFor(() => {
      expect(continueButton.hasAttribute("disabled")).toBe(false);
      expect(queryClient.getQueryData(bareQueryKey)).toBeDefined();
    });

    failBareQuery = true;
    const refresh = queryClient.refetchQueries({
      queryKey: bareQueryKey,
      exact: true,
    });
    await waitFor(() => {
      expect(bareQueryRequestCount).toBe(4);
      expect(queryClient.getQueryState(bareQueryKey)?.status).toBe("error");
    });
    await act(async () => refresh);

    expect(queryClient.getQueryData(bareQueryKey)).toMatchObject({
      date: selectedDate,
      unavailableDates: [],
      unavailableMonitorOptions: [],
    });
    expect(continueButton.hasAttribute("disabled")).toBe(true);
    expect(
      view.getByText("Nepodařilo se ověřit dostupnost. Zkus to prosím znovu.")
    ).toBeDefined();
    await act(async () => fireEvent.click(continueButton));
    expect(execute).not.toHaveBeenCalled();
    await act(async () => {
      view.unmount();
    });
  });

  test("keeps the locked workstation help trigger keyboard accessible in both locales", async () => {
    const cases = [
      {
        locale: "en-US" as const,
        trigger: "Why is a workstation required?",
        content:
          "All desks without a workstation are fully booked for this date. A workstation is required.",
      },
      {
        locale: "cs-CZ" as const,
        trigger: "Proč je pracovní stanice povinná?",
        content:
          "Všechna místa bez pracovní stanice jsou pro toto datum plně obsazená. Pracovní stanice je povinná.",
      },
    ];

    for (const { locale, trigger, content } of cases) {
      globalThis.fetch = mock((request: RequestInfo | URL) => {
        const url = String(request);
        if (!url.startsWith("/api/workspace/availability")) {
          return Promise.reject(new Error(`Unexpected fetch: ${url}`));
        }

        const monitorOption = new URL(url, "http://localhost").searchParams.get(
          "monitorOption"
        );
        return Promise.resolve(
          jsonResponse(
            requiredWorkstationAvailability(
              "2099-07-30",
              monitorOption as
                | (typeof workspaceProductMonitorOptions)[number]
                | null
            )
          )
        );
      }) as typeof fetch;

      const view = renderForm({
        locale,
        initialValues: reservedDeskFormValues(),
      });
      const workstationSwitch = view.getByRole("switch", {
        name:
          locale === "en-US"
            ? "Monitor workstation"
            : "Pracovní stanice s monitory",
      });
      await waitFor(() => {
        expect(workstationSwitch.getAttribute("aria-checked")).toBe("true");
        expect(workstationSwitch.hasAttribute("disabled")).toBe(true);
      });

      const help = view.getByRole("button", { name: trigger });
      expect(help.tagName).toBe("BUTTON");
      expect(help.hasAttribute("disabled")).toBe(false);
      await act(async () => help.focus());
      const tooltip = await within(view.baseElement).findByRole("tooltip");
      expect(tooltip.textContent).toBe(content);
      expect(help.getAttribute("aria-describedby")).toBe(tooltip.id);
      await act(async () => {
        fireEvent.pointerMove(help, { pointerType: "mouse" });
      });
      expect(
        (await within(view.baseElement).findByRole("tooltip")).textContent
      ).toBe(content);

      await act(async () => {
        view.unmount();
      });
    }
  });

  test("keeps the required workstation explanation open after a touch tap until tapped again", async () => {
    const cases = [
      {
        locale: "en-US" as const,
        trigger: "Why is a workstation required?",
        content:
          "All desks without a workstation are fully booked for this date. A workstation is required.",
      },
      {
        locale: "cs-CZ" as const,
        trigger: "Proč je pracovní stanice povinná?",
        content:
          "Všechna místa bez pracovní stanice jsou pro toto datum plně obsazená. Pracovní stanice je povinná.",
      },
    ];

    for (const { locale, trigger, content } of cases) {
      globalThis.fetch = mock((request: RequestInfo | URL) => {
        const url = String(request);
        if (!url.startsWith("/api/workspace/availability")) {
          return Promise.reject(new Error(`Unexpected fetch: ${url}`));
        }

        const monitorOption = new URL(url, "http://localhost").searchParams.get(
          "monitorOption"
        );
        return Promise.resolve(
          jsonResponse(
            requiredWorkstationAvailability(
              "2099-07-30",
              monitorOption as
                | (typeof workspaceProductMonitorOptions)[number]
                | null
            )
          )
        );
      }) as typeof fetch;

      const view = renderForm({
        locale,
        initialValues: reservedDeskFormValues(),
      });
      const help = await view.findByRole("button", { name: trigger });
      await waitFor(() => {
        expect(
          view
            .getByRole("switch", {
              name:
                locale === "en-US"
                  ? "Monitor workstation"
                  : "Pracovní stanice s monitory",
            })
            .hasAttribute("disabled")
        ).toBe(true);
      });

      const tap = async () => {
        await act(async () => {
          fireEvent.pointerDown(help, {
            button: 0,
            isPrimary: true,
            pointerId: 1,
            pointerType: "touch",
          });
          help.focus();
          fireEvent.pointerMove(help, {
            pointerId: 1,
            pointerType: "touch",
          });
          fireEvent.pointerUp(help, {
            button: 0,
            isPrimary: true,
            pointerId: 1,
            pointerType: "touch",
          });
          fireEvent.click(help, { detail: 1 });
          fireEvent.pointerLeave(help, {
            pointerId: 1,
            pointerType: "touch",
          });
        });
      };

      await tap();
      const tooltip = await within(view.baseElement).findByRole("tooltip");
      expect(tooltip.textContent).toBe(content);
      expect(help.getAttribute("aria-describedby")).toBe(tooltip.id);
      await act(async () => {
        fireEvent.pointerMove(help, {
          pointerId: 1,
          pointerType: "touch",
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      });
      expect(
        (await within(view.baseElement).findByRole("tooltip")).textContent
      ).toBe(content);

      await tap();
      await waitFor(() => {
        expect(within(view.baseElement).queryByRole("tooltip")).toBeNull();
      });

      await tap();
      const reopenedTooltip = await within(view.baseElement).findByRole(
        "tooltip"
      );
      expect(reopenedTooltip.textContent).toBe(content);
      await act(async () => {
        fireEvent.keyDown(reopenedTooltip, { key: "Escape" });
      });
      await waitFor(() => {
        expect(within(view.baseElement).queryByRole("tooltip")).toBeNull();
      });

      await act(async () => {
        view.unmount();
      });
    }
  });

  test("keeps required workstation dates selectable even when the bare date is unavailable", async () => {
    const initialDate = dateOffsetFromToday(1);
    const requiredDate = dateOffsetFromToday(2);
    getAdvertisedPrices.mockImplementation((requests) =>
      Promise.resolve(
        advertisedPricesResult(requests, getCoworkAdvertisedPriceResponse)
      )
    );
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (!url.startsWith("/api/workspace/availability")) {
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }

      const searchParams = new URL(url, "http://localhost").searchParams;
      const date = searchParams.get("date") ?? initialDate;
      const monitorOption = searchParams.get("monitorOption");
      if (date === initialDate) {
        return Promise.resolve(
          jsonResponse({
            ...availabilityResponse,
            date,
            unavailableDates: [requiredDate],
            reservedDeskWorkstationRequiredDates: [requiredDate],
          })
        );
      }

      return Promise.resolve(
        jsonResponse(
          requiredWorkstationAvailability(
            date,
            monitorOption as
              | (typeof workspaceProductMonitorOptions)[number]
              | null
          )
        )
      );
    }) as typeof fetch;

    const view = renderForm({
      initialValues: reservedDeskFormValues(initialDate),
    });
    await waitFor(() => {
      expect(
        view.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
      ).toBe(false);
    });

    await selectCalendarDate(view, requiredDate);
    await waitFor(() => {
      expect(
        view.container.querySelector<HTMLInputElement>("input[name='date']")
          ?.value
      ).toBe(requiredDate);
      expect(
        view.container.querySelector<HTMLInputElement>(
          "input[type='radio'][value='2x32-qhd']"
        )?.checked
      ).toBe(true);
    });
  });

  test("disables full dates and leaves workstation-required dates selectable before a date is chosen", async () => {
    const searchParams = new URLSearchParams();
    workspaceUseSearchParams.mockReturnValue(searchParams);
    const availabilityRange =
      getWorkspaceAvailabilityQueryFromReservationSearchParams(searchParams);
    const firstAvailableDate = Temporal.PlainDate.from(availabilityRange.from);
    const fullDate = firstAvailableDate.with({
      day: firstAvailableDate.daysInMonth,
    });
    const requiredDate = fullDate.add({ days: 1 });
    expect(fullDate.day).toBe(fullDate.daysInMonth);
    expect(requiredDate.day).toBe(1);
    let requestedAvailabilityRange: { from: string; to: string } | undefined;
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (!url.startsWith("/api/workspace/availability")) {
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }

      const searchParams = new URL(url, "http://localhost").searchParams;
      const from = searchParams.get("from");
      const to = searchParams.get("to");
      if (from !== null && to !== null) {
        requestedAvailabilityRange = { from, to };
      }
      return Promise.resolve(
        jsonResponse({
          ...availabilityResponse,
          date: undefined,
          from,
          to,
          unavailableDates: [fullDate.toString(), requiredDate.toString()],
          reservedDeskWorkstationRequiredDates: [requiredDate.toString()],
        })
      );
    }) as typeof fetch;

    const view = renderForm({
      initialValues: reservedDeskFormValues(""),
    });
    const datePickerButton = view.getByRole("button", {
      name: /Reservation date/i,
    });
    await act(async () => fireEvent.click(datePickerButton));
    const dialog = await within(document.body).findByRole("dialog");
    const fullDateButton = await getCalendarDateButton(
      dialog,
      fullDate.toString()
    );
    const requiredDateButton = await getCalendarDateButton(
      dialog,
      requiredDate.toString()
    );

    await waitFor(() => {
      expect((fullDateButton as HTMLButtonElement).disabled).toBe(true);
      expect((requiredDateButton as HTMLButtonElement).disabled).toBe(false);
      expect(
        view.container.querySelector<HTMLInputElement>("input[name='date']")
          ?.value
      ).toBe("");
    });
    if (!requestedAvailabilityRange) {
      throw new Error("Expected a calendar availability range request");
    }
    expect(requestedAvailabilityRange).toEqual({
      from: availabilityRange.from,
      to: availabilityRange.to,
    });
    expect(requestedAvailabilityRange.from <= fullDate.toString()).toBe(true);
    expect(requestedAvailabilityRange.to >= requiredDate.toString()).toBe(true);
  });

  test("keeps range calendar availability while a new selected-date query is pending", async () => {
    const initialDate = dateOffsetFromToday(1);
    const newDate = dateOffsetFromToday(2);
    const unavailableDate = dateOffsetFromToday(4);
    const availabilityRequests: string[] = [];
    let resolveNewDateAvailability: ((response: Response) => void) | undefined;
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (!url.startsWith("/api/workspace/availability")) {
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }

      availabilityRequests.push(url);
      const searchParams = new URL(url, "http://localhost").searchParams;
      const date = searchParams.get("date");
      if (!date) {
        return Promise.resolve(
          jsonResponse({
            ...availabilityResponse,
            date: undefined,
            from: searchParams.get("from"),
            to: searchParams.get("to"),
            unavailableDates: [unavailableDate],
          })
        );
      }
      if (date === newDate) {
        return new Promise<Response>((resolve) => {
          resolveNewDateAvailability = resolve;
        });
      }
      return Promise.resolve(
        jsonResponse({
          ...availabilityResponse,
          date,
          unavailableDates: [],
        })
      );
    }) as typeof fetch;

    const view = renderForm({
      initialValues: {
        ...coworkReservationDefaultValues,
        entryTier: "open-space",
        date: initialDate,
        name: "Ada Lovelace",
        email: "ada@example.test",
        phone: "+420777777777",
      },
    });
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => {
      expect(
        availabilityRequests.some(
          (url) => !new URL(url, "http://localhost").searchParams.has("date")
        )
      ).toBe(true);
    });

    await selectCalendarDate(view, newDate);
    await waitFor(() => {
      expect(
        view.container.querySelector<HTMLInputElement>("input[name='date']")
          ?.value
      ).toBe(newDate);
      expect(
        availabilityRequests.some((url) =>
          new URL(url, "http://localhost").searchParams
            .get("date")
            ?.includes(newDate)
        )
      ).toBe(true);
    });

    const datePickerButton = view.getByRole("button", {
      name: /Reservation date/i,
    });
    await act(async () => fireEvent.click(datePickerButton));
    const dialog = await within(document.body).findByRole("dialog");
    const unavailableDateButton = await getCalendarDateButton(
      dialog,
      unavailableDate
    );
    expect((unavailableDateButton as HTMLButtonElement).disabled).toBe(true);
    expect(
      view.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
    ).toBe(true);

    await act(async () => {
      resolveNewDateAvailability?.(
        jsonResponse({
          ...availabilityResponse,
          date: newDate,
          unavailableDates: [],
        })
      );
    });
    await act(async () => {
      view.unmount();
    });
  });

  test("does not force a workstation when the selected offer or date is unavailable, or when a bare desk remains available", async () => {
    const cases = [
      {
        name: "every reserved desk configuration is unavailable",
        availability: {
          ...availabilityResponse,
          unavailableCoworkTiers: ["reserved-desk"],
          unavailableMonitorOptions: [...workspaceProductMonitorOptions],
        },
        unavailable: true,
      },
      {
        name: "the whole calendar date is unavailable",
        availability: {
          ...availabilityResponse,
          unavailableDates: ["2099-07-30"],
          unavailableCoworkTiers: ["open-space", "reserved-desk"],
          unavailableMonitorOptions: [...workspaceProductMonitorOptions],
        },
        unavailable: true,
      },
      {
        name: "a bare Reserved Desk remains available",
        availability: availabilityResponse,
        unavailable: false,
      },
    ];

    for (const testCase of cases) {
      globalThis.fetch = mock((request: RequestInfo | URL) => {
        const url = String(request);
        if (!url.startsWith("/api/workspace/availability")) {
          return Promise.reject(new Error(`Unexpected fetch: ${url}`));
        }
        return Promise.resolve(jsonResponse(testCase.availability));
      }) as typeof fetch;

      const view = renderForm({
        initialValues: reservedDeskFormValues(),
      });
      await waitFor(() => {
        expect(
          view
            .getByRole("button", { name: "Continue" })
            .hasAttribute("disabled")
        ).toBe(testCase.unavailable);
      });
      expect(
        view
          .getByRole("switch", { name: "Monitor workstation" })
          .getAttribute("aria-checked")
      ).toBe("false");
      expect(
        view.queryByRole("button", { name: "Why is a workstation required?" })
      ).toBeNull();

      await act(async () => {
        view.unmount();
      });
    }
  });

  test("does not use previous-date availability while the new date is refetching and clears only its own addon after settlement", async () => {
    const initialDate = dateOffsetFromToday(1);
    const newDate = dateOffsetFromToday(2);
    let resolveNewDateAvailability: ((response: Response) => void) | undefined;
    const availabilityRequests: string[] = [];
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (!url.startsWith("/api/workspace/availability")) {
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }

      availabilityRequests.push(url);
      const searchParams = new URL(url, "http://localhost").searchParams;
      const date = searchParams.get("date") ?? initialDate;
      const monitorOption = searchParams.get("monitorOption");
      if (date === initialDate) {
        return Promise.resolve(
          jsonResponse({
            ...requiredWorkstationAvailability(
              date,
              monitorOption as
                | (typeof workspaceProductMonitorOptions)[number]
                | null
            ),
            reservedDeskWorkstationRequiredDates: [initialDate, newDate],
          })
        );
      }
      if (date === newDate && monitorOption) {
        return new Promise<Response>((resolve) => {
          resolveNewDateAvailability = resolve;
        });
      }

      return Promise.resolve(
        jsonResponse({
          ...availabilityResponse,
          date,
          unavailableDates: [],
          reservedDeskWorkstationRequiredDates: [],
          unavailableMonitorOptions: [],
        })
      );
    }) as typeof fetch;

    const view = renderForm({
      initialValues: reservedDeskFormValues(initialDate),
    });
    await waitFor(() => {
      expect(
        view.container.querySelector<HTMLInputElement>(
          "input[type='radio'][value='2x32-qhd']"
        )?.checked
      ).toBe(true);
      expect(
        view.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
      ).toBe(false);
    });

    await selectCalendarDate(view, newDate);
    await waitFor(() => {
      expect(
        view.container.querySelector<HTMLInputElement>("input[name='date']")
          ?.value
      ).toBe(newDate);
      expect(
        view.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
      ).toBe(true);
    });
    expect(
      view.queryByRole("button", { name: "Why is a workstation required?" })
    ).toBeNull();
    expect(
      view
        .getByRole("switch", { name: "Monitor workstation" })
        .hasAttribute("disabled")
    ).toBe(false);
    expect(
      view
        .getByRole("switch", { name: "Monitor workstation" })
        .getAttribute("aria-checked")
    ).toBe("true");

    fireEvent.click(view.getByRole("button", { name: "Continue" }));
    expect(execute).not.toHaveBeenCalled();

    await act(async () => {
      resolveNewDateAvailability?.(
        jsonResponse({
          ...availabilityResponse,
          date: newDate,
          unavailableDates: [],
          reservedDeskWorkstationRequiredDates: [],
          unavailableMonitorOptions: [],
        })
      );
    });
    await waitFor(() => {
      expect(
        view
          .getByRole("switch", { name: "Monitor workstation" })
          .getAttribute("aria-checked")
      ).toBe("false");
      expect(
        view.container.querySelector("[data-cowork-monitor-options]")
      ).toBeNull();
      expect(
        view.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
      ).toBe(false);
    });
    expect(
      availabilityRequests.some((url) => url.includes(`date=${newDate}`))
    ).toBe(true);
  });

  test("preserves restored and initial workstation preferences when the requirement clears", async () => {
    const requiredDate = dateOffsetFromToday(1);
    const availableDate = dateOffsetFromToday(2);
    const restoredReservation = {
      kind: "cowork" as const,
      entryTier: "reserved-desk" as const,
      coffee: true,
      date: requiredDate,
      monitorOption: "2x32-qhd" as const,
      name: "Ada Lovelace",
      email: "ada@example.test",
      phone: "+420777777777",
      billing: coworkReservationDefaultValues.billing,
    };
    const cases = [
      {
        props: {
          initialValues: reservedDeskFormValues(requiredDate, "2x32-qhd"),
        },
      },
      { props: { initialReservation: restoredReservation } },
    ];

    for (const { props } of cases) {
      globalThis.fetch = mock((request: RequestInfo | URL) => {
        const url = String(request);
        if (!url.startsWith("/api/workspace/availability")) {
          return Promise.reject(new Error(`Unexpected fetch: ${url}`));
        }

        const searchParams = new URL(url, "http://localhost").searchParams;
        const date = searchParams.get("date") ?? requiredDate;
        if (date === requiredDate) {
          return Promise.resolve(
            jsonResponse(requiredWorkstationAvailability(date, "2x32-qhd"))
          );
        }
        return Promise.resolve(
          jsonResponse({
            ...availabilityResponse,
            date,
            unavailableDates: [],
            reservedDeskWorkstationRequiredDates: [],
            unavailableMonitorOptions: [],
          })
        );
      }) as typeof fetch;

      const view = renderForm(props);
      await waitFor(() => {
        expect(
          view.container.querySelector<HTMLInputElement>(
            "input[type='radio'][value='2x32-qhd']"
          )?.checked
        ).toBe(true);
      });
      await selectCalendarDate(view, availableDate);
      await waitFor(() => {
        expect(
          view.container.querySelector<HTMLInputElement>(
            "input[type='radio'][value='2x32-qhd']"
          )?.checked
        ).toBe(true);
        expect(
          view
            .getByRole("switch", { name: "Monitor workstation" })
            .getAttribute("aria-checked")
        ).toBe("true");
        expect(
          view.queryByRole("button", {
            name: "Why is a workstation required?",
          })
        ).toBeNull();
      });

      await act(async () => {
        view.unmount();
      });
    }
  });

  test("keeps a monitor choice made while the workstation is forced", async () => {
    const requiredDate = dateOffsetFromToday(1);
    const availableDate = dateOffsetFromToday(2);
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (!url.startsWith("/api/workspace/availability")) {
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }

      const searchParams = new URL(url, "http://localhost").searchParams;
      const date = searchParams.get("date") ?? requiredDate;
      if (date === requiredDate) {
        return Promise.resolve(
          jsonResponse(
            requiredWorkstationAvailability(
              date,
              searchParams.get("monitorOption") as
                | (typeof workspaceProductMonitorOptions)[number]
                | null
            )
          )
        );
      }
      return Promise.resolve(
        jsonResponse({
          ...availabilityResponse,
          date,
          unavailableDates: [],
          reservedDeskWorkstationRequiredDates: [],
          unavailableMonitorOptions: [],
        })
      );
    }) as typeof fetch;

    const view = renderForm({
      initialValues: reservedDeskFormValues(requiredDate),
    });
    await waitFor(() => {
      expect(
        view.container.querySelector<HTMLInputElement>(
          "input[type='radio'][value='2x32-qhd']"
        )?.checked
      ).toBe(true);
      expect(
        view
          .getByRole("switch", { name: "Monitor workstation" })
          .hasAttribute("disabled")
      ).toBe(true);
    });

    fireEvent.click(
      view.container.querySelector(
        "input[type='radio'][value='2x27-4k']"
      ) as HTMLInputElement
    );
    await waitFor(() => {
      expect(
        view.container.querySelector<HTMLInputElement>(
          "input[type='radio'][value='2x27-4k']"
        )?.checked
      ).toBe(true);
    });
    await selectCalendarDate(view, availableDate);
    await waitFor(() => {
      expect(
        view.container.querySelector<HTMLInputElement>(
          "input[type='radio'][value='2x27-4k']"
        )?.checked
      ).toBe(true);
      expect(
        view
          .getByRole("switch", { name: "Monitor workstation" })
          .getAttribute("aria-checked")
      ).toBe("true");
    });
    await act(async () => {});
    expect(
      view.container.querySelector<HTMLInputElement>(
        "input[type='radio'][value='2x27-4k']"
      )?.checked
    ).toBe(true);
  });
});
