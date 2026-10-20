import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
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
import {
  currencyCZK,
  formatWorkspaceMoney,
} from "@/features/checkout/workspace-money";
import { discountIdSchema } from "@/features/discounts/contracts";
import { m } from "@/features/i18n";
import {
  continueAndSubmitReservation,
  mockReservationCheckoutStep,
} from "@/features/reservation/components/reservation-checkout-step.test-utils";
import { ReservationOfferingsStructuredData } from "@/features/reservation/components/reservation-offerings-structured-data";
import { mockCheckoutEmailVerification } from "@/features/reservation/components/use-checkout-email-verification.test-utils";
import { getCoworkDateAdvertisedPriceRequests } from "@/features/reservation/cowork-advertised-price";
import { coworkReservationDefaultValues } from "@/features/reservation/cowork-reservation";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { getCoworkPageOfferings } from "@/features/reservation/reservation-page-offerings";
import { coworkReservationPath } from "@/features/reservation/routes";
import {
  getCoworkAvailabilityQueries,
  getWorkspaceAvailabilityRange,
  workspaceAvailabilityKeys,
} from "@/features/reservation/workspace-availability";
import {
  workspaceRouterPush as push,
  workspaceUseAction,
  workspaceUseSearchParams,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const testEmailAddressForAda = testEmailAddress("ada");

registerWorkspaceComponentTestEnv();

const { getImageProps } = await import("next/image");

mock.module("next/image", () => ({
  // Bun resolves static image imports to their file path.
  default: ({
    fetchPriority,
    preload,
    sizes,
    src,
  }: {
    readonly fetchPriority?: string;
    readonly preload?: boolean;
    readonly sizes?: string;
    readonly src: string;
  }) => (
    <span
      data-image-fetch-priority={fetchPriority}
      data-image-preload={preload ? "" : undefined}
      data-image-sizes={sizes}
      data-image-src={src}
    />
  ),
  getImageProps,
}));

const executeAsync = mock(() => Promise.resolve({}));
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

mockCheckoutEmailVerification();
mockReservationCheckoutStep();

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
// Testing Library's default normalizer turns the price's no-break space into
// a plain space.
const openSpaceOriginalPriceText = () =>
  m
    .checkoutSummaryOriginalPrice(
      {
        price: formatWorkspaceMoney(
          getWorkspaceProductByTier("open-space").price,
          "en-US"
        ),
      },
      { locale: "en-US" }
    )
    .replaceAll("\u00a0", " ");
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

const today = () => getCurrentWorkspaceDate().toString();

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
      <CoworkReservationForm
        checkoutCustomer={{
          status: "profile-missing",
          email: testEmailAddressForAda,
          continuesCheckout: false,
        }}
        locale="en-US"
        today={today()}
        {...props}
      />
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
  email: testEmailAddressForAda,
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

// Selection queries ask for the selected day alone, not the calendar range.
const selectedDateAvailabilityQuery = (
  entryTier: "open-space" | "reserved-desk",
  date: string
) => ({ kind: "cowork" as const, from: date, to: date, entryTier, date });

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
        `entryTier=open-space&date=2099-07-30&coffee=true&name=Ada%20Lovelace&email=${encodeURIComponent(testEmailAddressForAda)}&phone=%2B420777777777`
      )
    );
    workspaceUseAction.mockReturnValue({
      executeAsync,
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
    executeAsync.mockClear();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("offers the tier prices the form first shows in the page's structured data", async () => {
    workspaceUseSearchParams.mockReturnValue(new URLSearchParams());
    globalThis.fetch = mock((request: RequestInfo | URL) =>
      Promise.reject(new Error(`Unexpected client fetch: ${String(request)}`))
    ) as typeof fetch;
    const initialValues = {
      ...coworkReservationDefaultValues,
      coffee: false,
      date: "2099-07-30",
    };
    // Both tiers are on sale in what the page preloads.
    const initialAdvertisedPrices = getCoworkDateAdvertisedPriceRequests({
      date: initialValues.date,
      locale: "en-US",
    }).map((request) => ({
      request,
      advertisedPrice: getCoworkAdvertisedPriceResponse(request),
    }));

    const view = render(
      <QueryClientProvider client={new QueryClient()}>
        <ReservationOfferingsStructuredData
          locale="en-US"
          offerings={getCoworkPageOfferings({
            advertisedPrices: initialAdvertisedPrices,
            coffee: initialValues.coffee,
            date: initialValues.date,
            locale: "en-US",
          })}
          pathname={coworkReservationPath}
        />
        <CoworkReservationForm
          checkoutCustomer={{ status: "signed-out" }}
          initialAdvertisedPrices={initialAdvertisedPrices}
          initialValues={initialValues}
          locale="en-US"
          today="2099-07-30"
        />
      </QueryClientProvider>
    );
    const services = JSON.parse(
      view.container.querySelector('script[type="application/ld+json"]')
        ?.textContent ?? "{}"
    )["@graph"];

    expect(services.map(({ offers }) => offers.price)).toEqual([145, 328]);
    for (const [tier, service] of [
      ["open-space", services[0]],
      ["reserved-desk", services[1]],
    ]) {
      expect(
        view.container.querySelector(`[data-reservation-type-price="${tier}"]`)
          ?.textContent
      ).toContain(
        formatWorkspaceMoney(currencyCZK(service.offers.price * 100), "en-US")
      );
    }
    expect(getAdvertisedPrices).not.toHaveBeenCalled();
  });

  test("renders every page-loaded price and availability without a client request", async () => {
    workspaceUseSearchParams.mockReturnValue(new URLSearchParams());
    const fetchCalls = mock((request: RequestInfo | URL) =>
      Promise.reject(new Error(`Unexpected client fetch: ${String(request)}`))
    );
    globalThis.fetch = fetchCalls as typeof fetch;
    const initialValues = {
      ...coworkReservationDefaultValues,
      coffee: false,
      date: "2099-07-30",
    };
    const view = renderForm({
      initialValues,
      initialAdvertisedPrices: getCoworkDateAdvertisedPriceRequests({
        date: "2099-07-30",
        locale: "en-US",
      }).map((request) => ({
        request,
        advertisedPrice: getCoworkAdvertisedPriceResponse(request),
      })),
      initialAvailability: Object.values(
        getCoworkAvailabilityQueries({ ...initialValues, today: "2099-07-30" })
      ).map((query) => ({
        query,
        availability: {
          ...availabilityResponse,
          from: query.from,
          to: query.to,
        },
        loadedAt: Date.now(),
      })),
      today: "2099-07-30",
    });

    for (const tier of ["open-space", "reserved-desk"]) {
      const price = view.container.querySelector(
        `[data-reservation-type-price="${tier}"]`
      );
      expect(price?.querySelector("[data-slot='skeleton']")).toBeNull();
    }
    expect(
      view.container
        .querySelector("[data-reservation-coffee-price]")
        ?.querySelector("[data-slot='skeleton']")
    ).toBeNull();
    expect(
      view.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
    ).toBe(false);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(getAdvertisedPrices).not.toHaveBeenCalled();
    expect(fetchCalls).not.toHaveBeenCalled();
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

    const view = renderForm({ checkoutCustomer: { status: "signed-out" } });
    const continueButton = view.getByRole("button", {
      name: "Continue",
    }) as HTMLButtonElement;
    await waitFor(
      () => {
        expect(continueButton.hasAttribute("disabled")).toBe(false);
      },
      { timeout: 5000 }
    );

    await continueAndSubmitReservation(continueButton);

    expect(await view.findByText("Email is required.")).toBeDefined();
    expect(view.getByText("Phone is required.")).toBeDefined();
    expect(view.getByText("Name must be at least 2 characters.")).toBeDefined();
    expect(executeAsync).not.toHaveBeenCalled();
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

    fireEvent.click(continueButton);
    await waitFor(() => expect(continueButton.id).toBe("reservation-submit"));
    fireEvent.click(view.getByRole("checkbox", { name: "Create invoice" }));
    fireEvent.click(continueButton);

    expect(await view.findAllByText("This field is required.")).toHaveLength(3);
    expect(view.queryByText("undefined")).toBeNull();
    expect(view.queryByText("Expected string, got undefined")).toBeNull();
    expect(executeAsync).not.toHaveBeenCalled();
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
    // The contact details wait at the next step.
    expect(view.container.querySelector('input[name="email"]')).not.toBeNull();
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
      await view.findByText(openSpaceOriginalPriceText(), {}, { timeout: 5000 })
    ).toBeDefined();
    expect(view.getByText(/discounted price.*145/i)).toBeDefined();
    expect(
      view.getByRole("button", { name: /discount.*Open Space/i })
    ).toBeDefined();
    const openSpacePrice = view.container.querySelector(
      '[data-reservation-type-price="open-space"]'
    );
    expect(openSpacePrice?.textContent).toContain("/ day");
    expect(openSpacePrice?.querySelector("del")).not.toBeNull();

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
    await view.findByText(openSpaceOriginalPriceText(), {}, { timeout: 3000 });

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
    executeAsync.mockClear();
    await continueAndSubmitReservation(
      view.getByRole("button", { name: "Continue" }) as HTMLButtonElement
    );
    await waitFor(() => {
      expect(executeAsync).toHaveBeenCalledTimes(1);
    });
    const workstationSubmission = executeAsync.mock.calls[0]?.[0] as {
      advertisedPriceToken?: string;
      reservation?: { monitorOption?: string };
    };
    expect(workstationSubmission.advertisedPriceToken).toBe(
      "sealed-reserved-desk-workstation-advertised-price"
    );
    expect(workstationSubmission.reservation?.monitorOption).toBe("2x32-4k");

    // Toggling the workstation off submits the bare variant: no monitor
    // option and the no-workstation advertised token.
    fireEvent.click(view.getByRole("button", { name: "Change" }));
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
    executeAsync.mockClear();
    await continueAndSubmitReservation(
      view.getByRole("button", { name: "Continue" }) as HTMLButtonElement
    );
    await waitFor(() => {
      expect(executeAsync).toHaveBeenCalledTimes(1);
    });
    const bareSubmission = executeAsync.mock.calls[0]?.[0] as {
      advertisedPriceToken?: string;
      reservation?: { monitorOption?: string };
    };
    expect(bareSubmission.advertisedPriceToken).toBe(
      "sealed-reserved-desk-advertised-price"
    );
    expect(bareSubmission.reservation?.monitorOption).toBeUndefined();
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
    await view.findByText(openSpaceOriginalPriceText(), {}, { timeout: 3000 });
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

    await act(async () => {
      view.unmount();
    });
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

    fireEvent.click(workstationSwitch);
    expect(workstationSwitch.getAttribute("aria-checked")).toBe("true");

    await continueAndSubmitReservation(
      view.getByRole("button", { name: "Continue" }) as HTMLButtonElement
    );
    await waitFor(() => {
      expect(executeAsync).toHaveBeenCalledTimes(1);
    });
    const submission = executeAsync.mock.calls[0]?.[0] as {
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
    const baseQuery = getWorkspaceAvailabilityRange(today());
    const bareQuery = selectedDateAvailabilityQuery(
      "reserved-desk",
      "2099-07-30"
    );
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
          checkoutCustomer={{ status: "signed-out" }}
          initialValues={reservedDeskFormValues()}
          locale="en-US"
          today={today()}
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
    const baseQuery = getWorkspaceAvailabilityRange(today());
    const rangeQuery = {
      kind: "cowork" as const,
      from: baseQuery.from,
      to: baseQuery.to,
      entryTier: "open-space" as const,
    };
    const selectedDateQuery = selectedDateAvailabilityQuery(
      "open-space",
      selectedDate
    );
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
          email: testEmailAddressForAda,
          phone: "+420777777777",
        },
      },
      queryClient
    );
    await view.findByText(openSpaceOriginalPriceText(), {}, { timeout: 5000 });

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
    expect(executeAsync).not.toHaveBeenCalled();
    await act(async () => {
      view.unmount();
    });
  });

  test("blocks checkout with an availability error when the selected-date query fails after retries", async () => {
    const selectedDate = dateOffsetFromToday(1);
    const searchParams = new URLSearchParams(
      `entryTier=open-space&date=${selectedDate}&coffee=true&name=Ada%20Lovelace&email=${encodeURIComponent(testEmailAddressForAda)}&phone=%2B420777777777`
    );
    workspaceUseSearchParams.mockReturnValue(searchParams);
    const selectedDateQuery = selectedDateAvailabilityQuery(
      "open-space",
      selectedDate
    );
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
          email: testEmailAddressForAda,
          phone: "+420777777777",
        },
      },
      queryClient
    );
    await view.findByText(openSpaceOriginalPriceText(), {}, { timeout: 5000 });
    await waitFor(() => {
      expect(queryClient.getQueryState(selectedDateQueryKey)?.status).toBe(
        "error"
      );
    });
    expect(selectedDateRequestCount).toBe(4);

    const continueButton = view.getByRole("button", { name: "Continue" });
    expect(continueButton.hasAttribute("disabled")).toBe(true);
    expect(
      view.getByText(m.reservationAvailabilityError({}, { locale: "en-US" }))
    ).toBeDefined();
    await act(async () => fireEvent.click(continueButton));
    expect(executeAsync).not.toHaveBeenCalled();
    await act(async () => {
      view.unmount();
    });
  });

  test("keeps the last settled monitor choices and checkout during a same-date workstation requirement refresh", async () => {
    const selectedDate = dateOffsetFromToday(1);
    const searchParams = new URLSearchParams(
      `entryTier=reserved-desk&date=${selectedDate}`
    );
    workspaceUseSearchParams.mockReturnValue(searchParams);
    const bareQuery = selectedDateAvailabilityQuery(
      "reserved-desk",
      selectedDate
    );
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
    });

    // A background refresh keeps the last settled answer: checkout stays
    // available and the stale-unavailable monitor stays disabled.
    expect(continueButton.hasAttribute("disabled")).toBe(false);
    expect(unavailableMonitor?.disabled).toBe(true);
    await act(async () => {
      if (!unavailableMonitor) {
        throw new Error("Expected the unavailable monitor radio");
      }
      fireEvent.click(unavailableMonitor);
    });
    expect(unavailableMonitor?.checked).toBe(false);
    expect(availableMonitor?.checked).toBe(true);
    expect(continueButton.hasAttribute("disabled")).toBe(false);

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
    expect(executeAsync).not.toHaveBeenCalled();
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
    const bareQuery = selectedDateAvailabilityQuery(
      "reserved-desk",
      selectedDate
    );
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
    expect(executeAsync).not.toHaveBeenCalled();
    await act(async () => {
      view.unmount();
    });
  });

  test("disables full dates and leaves workstation-required dates selectable before a date is chosen", async () => {
    const searchParams = new URLSearchParams();
    workspaceUseSearchParams.mockReturnValue(searchParams);
    const availabilityRange = getWorkspaceAvailabilityRange(today());
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
        email: testEmailAddressForAda,
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

  test("keeps checkout enabled during a background refetch of settled selected-date availability", async () => {
    const selectedDate = dateOffsetFromToday(1);
    const searchParams = new URLSearchParams(
      `entryTier=open-space&date=${selectedDate}`
    );
    workspaceUseSearchParams.mockReturnValue(searchParams);
    const selectedDateQueryKey = [
      ...workspaceAvailabilityKeys.availability(
        selectedDateAvailabilityQuery("open-space", selectedDate)
      ),
      null,
    ];
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    });
    let selectedDateRequestCount = 0;
    let resolveSelectedDateRefresh: ((response: Response) => void) | undefined;
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = String(request);
      if (!url.startsWith("/api/workspace/availability")) {
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }

      const params = new URL(url, "http://localhost").searchParams;
      const date = params.get("date");
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
      selectedDateRequestCount += 1;
      if (selectedDateRequestCount > 1) {
        return new Promise<Response>((resolve) => {
          resolveSelectedDateRefresh = resolve;
        });
      }
      return Promise.resolve(
        jsonResponse({
          ...availabilityResponse,
          date,
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
          name: "Ada Lovelace",
          email: testEmailAddressForAda,
          phone: "+420777777777",
        },
      },
      queryClient
    );
    const continueButton = view.getByRole("button", { name: "Continue" });
    await waitFor(() => {
      expect(queryClient.getQueryData(selectedDateQueryKey)).toBeDefined();
      expect(continueButton.hasAttribute("disabled")).toBe(false);
    });

    let refresh: Promise<void> | undefined;
    await act(async () => {
      refresh = queryClient.refetchQueries({
        queryKey: selectedDateQueryKey,
        exact: true,
      });
      await waitFor(() => expect(resolveSelectedDateRefresh).toBeDefined());
    });
    expect(
      queryClient.isFetching({ queryKey: selectedDateQueryKey, exact: true })
    ).toBe(1);
    expect(continueButton.hasAttribute("disabled")).toBe(false);
    expect(
      continueButton.getAttribute("data-reservation-availability-loading")
    ).toBe("false");
    expect(
      view.queryByText(m.reservationAvailabilityError({}, { locale: "en-US" }))
    ).toBeNull();

    await act(async () => {
      resolveSelectedDateRefresh?.(
        jsonResponse({
          ...availabilityResponse,
          date: selectedDate,
          from: selectedDate,
          to: selectedDate,
          unavailableDates: [],
        })
      );
      await refresh;
    });
    expect(continueButton.hasAttribute("disabled")).toBe(false);
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
    expect(executeAsync).not.toHaveBeenCalled();

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
      email: testEmailAddressForAda,
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

  test("starts the calendar at the Prague workspace date instead of the browser date", async () => {
    const originalTimeZone = process.env.TZ;
    // 22:30 UTC is already the next day in Prague (CEST, UTC+2).
    process.env.TZ = "UTC";
    setSystemTime(new Date("2026-10-09T22:30:00.000Z"));
    try {
      workspaceUseSearchParams.mockReturnValue(new URLSearchParams());
      globalThis.fetch = mock((request: RequestInfo | URL) => {
        const url = String(request);
        if (!url.startsWith("/api/workspace/availability")) {
          return Promise.reject(new Error(`Unexpected fetch: ${url}`));
        }
        const searchParams = new URL(url, "http://localhost").searchParams;
        return Promise.resolve(
          jsonResponse({
            ...availabilityResponse,
            date: undefined,
            from: searchParams.get("from"),
            to: searchParams.get("to"),
          })
        );
      }) as typeof fetch;

      const view = renderForm({
        initialValues: { ...coworkReservationDefaultValues, date: "" },
      });
      await act(async () =>
        fireEvent.click(view.getByRole("button", { name: /Reservation date/i }))
      );
      const dialog = await within(document.body).findByRole("dialog");
      const browserTodayButton = await getCalendarDateButton(
        dialog,
        "2026-10-09"
      );
      const workspaceTodayButton = await getCalendarDateButton(
        dialog,
        "2026-10-10"
      );

      expect((browserTodayButton as HTMLButtonElement).disabled).toBe(true);
      expect((workspaceTodayButton as HTMLButtonElement).disabled).toBe(false);
      await act(async () => {
        view.unmount();
      });
    } finally {
      setSystemTime();
      if (originalTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimeZone;
      }
    }
  });
});
