import { beforeEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect } from "effect";
import {
  isOfficeAdvertisedPrice,
  type OfficeAdvertisedPriceRequest,
} from "@/features/checkout/advertised-price";
import { getOfficeCheckoutSummary } from "@/features/checkout/checkout-summary-office";
import { getWorkspaceOfficeAccessPrice } from "@/features/checkout/product-catalog";
import { getPublicOfferingsStructuredData } from "@/features/checkout/public-offerings-structured-data";
import { buildOfficeReservationQuote } from "@/features/checkout/reservation-quote-office";
import { m } from "@/features/i18n";
import { recordReservationPagePreloads } from "@/features/reservation/backend/reservation-page-preloads.service.mock";
import { getOfficeSeatAdvertisedPriceRequests } from "@/features/reservation/office-advertised-price";
import {
  type NormalizedOfficeReservationOrder,
  normalizedOfficeReservationOrderSchema,
} from "@/features/reservation/office-reservation";
import { getOfficeAvailabilityQuery } from "@/features/reservation/workspace-availability";
import { currencyCZK } from "@/shared/money/currencies";
import {
  type Money,
  moneyMajorAmount,
  moneyWithValue,
} from "@/shared/money/money";

mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));

const loadOfficeReservationSeatCapacity = mock(() => Promise.resolve(5));
mock.module(
  "@/features/office/backend/office-reservation-capacity.server",
  () => ({ loadOfficeReservationSeatCapacity })
);

const { officeReservationPage } = await import("./office-reservation-page");

// Each request preloads, without a price the structured data could use.
const loadAdvertisedPrices = mock((requests: ReadonlyArray<unknown>) =>
  Effect.succeed(requests.map((request) => ({ request })))
);
const recordEveryPricePreload = () =>
  recordReservationPagePreloads({
    advertisedPrices: (requests) => loadAdvertisedPrices(requests) as never,
  });
let preloads = recordEveryPricePreload();

type OfficePageRequest = Parameters<
  typeof officeReservationPage.loadContent
>[0];

/** The content the page renders: its structured data and form. */
const loadOfficeReservationContent = async ({
  checkoutAccount = { status: "signed-out" },
  initialReservation,
  replacementToken = "signed-replacement-token",
  ...request
}: Omit<OfficePageRequest, "checkoutAccount"> & {
  readonly checkoutAccount?: OfficePageRequest["checkoutAccount"];
  readonly initialReservation?: NormalizedOfficeReservationOrder;
  readonly replacementToken?: string;
}) => {
  const content = await Effect.runPromise(
    officeReservationPage
      .loadContent({
        checkoutAccount,
        ...request,
        ...(initialReservation && {
          restoredReservation: {
            replacementToken,
            reservation: initialReservation,
          },
        }),
      })
      .pipe(Effect.provide(preloads.layer))
  );
  if (content.kind !== "form") throw new Error("Expected the reservation form");
  return content;
};

/** The form the page renders beside its structured data. */
const renderOfficeReservationForm = async (
  input: Parameters<typeof loadOfficeReservationContent>[0]
) => (await loadOfficeReservationContent(input)).form;

beforeEach(() => {
  mock.clearAllMocks();
  preloads = recordEveryPricePreload();
});

test("prefills safe office shape on a fresh date and quote", async () => {
  const originalNow = Temporal.Now.instant;
  Temporal.Now.instant = () => Temporal.Instant.from("2099-07-30T13:01:00Z");

  try {
    const form = await renderOfficeReservationForm({
      locale: "en-US",
      pageData: 5,
      searchParams: { dayCount: "3", seats: "4" },
    });

    expect(form.initialValues).toMatchObject({
      startsOn: "2099-07-30",
      dayCount: 3,
      seats: 4,
      name: "",
      email: "",
      phone: "",
    });
    // The page shell loads the capacity alongside the existing customer.
    expect(loadOfficeReservationSeatCapacity).not.toHaveBeenCalled();
    expect(preloads.advertisedPriceRequests[0]).toEqual(
      getOfficeSeatAdvertisedPriceRequests({
        locale: "en-US",
        seatCapacity: 5,
        startsOn: "2099-07-30",
        endsOn: "2099-08-01",
      })
    );
    expect(preloads.advertisedPriceRequests[0]).toHaveLength(5);
    expect(preloads.advertisedPriceRequests[0]).toContainEqual({
      locale: "en-US",
      reservation: {
        kind: "office",
        details: {
          kind: "office",
          startsOn: "2099-07-30",
          endsOn: "2099-08-01",
          seats: 4,
        },
      },
    });
    expect(form.initialAdvertisedPrices).toHaveLength(5);
    expect(preloads.availabilityPreloads[0]).toEqual({
      queries: [getOfficeAvailabilityQuery("2099-07-30")],
      replacementToken: undefined,
    });
    expect(form.initialAvailability?.map(({ query }) => query)).toEqual([
      getOfficeAvailabilityQuery("2099-07-30"),
    ]);
  } finally {
    Temporal.Now.instant = originalNow;
  }
});

test("prices the office offer at the amounts shown for the URL selection", async () => {
  const originalNow = Temporal.Now.instant;
  Temporal.Now.instant = () => Temporal.Instant.from("2099-07-30T13:01:00Z");
  const halve = (money: Money) => currencyCZK(money.value / 2);
  // A sale halves every preloaded amount, so catalog prices cannot match.
  loadAdvertisedPrices.mockImplementationOnce((requests) =>
    Effect.succeed(
      (requests as ReadonlyArray<OfficeAdvertisedPriceRequest>).map(
        (request) => {
          const quote = Effect.runSync(
            buildOfficeReservationQuote(request.reservation.details)
          );
          const [item] = quote.items;
          const saleQuote = {
            ...quote,
            items: [
              {
                ...item,
                accessAmount: halve(item.accessAmount),
                seatAmount: halve(item.seatAmount),
              },
            ],
          } satisfies typeof quote;
          return {
            request,
            advertisedPrice: {
              kind: "office" as const,
              quote: saleQuote,
              summary: getOfficeCheckoutSummary(saleQuote),
              advertisedPriceToken: "sealed",
            },
          };
        }
      )
    )
  );

  try {
    const { form, offerings } = await loadOfficeReservationContent({
      locale: "en-US",
      pageData: 5,
      searchParams: { dayCount: "2", seats: "3", startsOn: "2099-08-10" },
    });
    const office = getPublicOfferingsStructuredData({
      locale: "en-US",
      offerings,
    })["@graph"].find(
      (service: { readonly name: string }) =>
        service.name ===
        m.reservationOfficeProductTitle({}, { locale: "en-US" })
    );
    const displayed = form.initialAdvertisedPrices?.find(
      ({ request }) =>
        request.reservation.kind === "office" &&
        request.reservation.details.seats === 3
    )?.advertisedPrice;
    const displayedItem =
      displayed && isOfficeAdvertisedPrice(displayed)
        ? displayed.quote.items[0]
        : undefined;
    if (!displayedItem) throw new Error("Expected the selection's price");
    const perDay = (money: Money) =>
      moneyMajorAmount(
        moneyWithValue(money.value / displayedItem.dayCount, money)
      );

    expect(form.initialValues).toMatchObject({
      startsOn: "2099-08-10",
      dayCount: 2,
      seats: 3,
    });
    expect(displayedItem.dayCount).toBe(2);
    expect(office.offers.priceSpecification).toMatchObject([
      { price: perDay(displayedItem.accessAmount) },
      { price: perDay(displayedItem.seatAmount) },
    ]);
    expect(office.offers.priceSpecification[0].price).not.toBe(
      moneyMajorAmount(getWorkspaceOfficeAccessPrice(1))
    );
  } finally {
    Temporal.Now.instant = originalNow;
  }
});

test("keys the preloaded availability to the Prague date near midnight", async () => {
  const originalNow = Temporal.Now.instant;
  Temporal.Now.instant = () => Temporal.Instant.from("2099-07-30T22:30:00Z");

  try {
    const form = await renderOfficeReservationForm({
      locale: "en-US",
      pageData: 5,
      searchParams: {},
    });

    expect(form.today).toBe("2099-07-31");
    expect(preloads.availabilityPreloads[0]).toEqual({
      queries: [getOfficeAvailabilityQuery("2099-07-31")],
      replacementToken: undefined,
    });
    expect(preloads.availabilityPreloads[0].queries[0]?.from).toBe(
      "2099-07-31"
    );
  } finally {
    Temporal.Now.instant = originalNow;
  }
});

describe("a signed restoration", () => {
  const evaEmail = testEmailAddress("eva");
  const restoredReservation = normalizedOfficeReservationOrderSchema.make({
    kind: "office",
    startsOn: "2099-08-04",
    endsOn: "2099-08-05",
    seats: 2,
    name: "Eva Svobodová",
    email: evaEmail,
    phone: "+420777777777",
    billing: { purpose: "personal", invoice: "none" },
  });
  const renderRestored = async (searchParams: Record<string, string>) => {
    const originalNow = Temporal.Now.instant;
    Temporal.Now.instant = () => Temporal.Instant.from("2099-07-30T13:01:00Z");
    try {
      return await renderOfficeReservationForm({
        initialReservation: restoredReservation,
        locale: "en-US",
        pageData: 5,
        replacementToken: "restored-pay-state",
        searchParams: { payState: "restored-pay-state", ...searchParams },
      });
    } finally {
      Temporal.Now.instant = originalNow;
    }
  };

  test("restores the signed office reservation into the form", async () => {
    const form = await renderRestored({});

    expect(form.initialValues).toMatchObject({
      startsOn: "2099-08-04",
      dayCount: 2,
      seats: 2,
      name: "Eva Svobodová",
      email: evaEmail,
    });
  });

  test("reopens the selection edited after returning from Pay with the restored checkout", async () => {
    const form = await renderRestored({
      dayCount: "3",
      seats: "4",
      startsOn: "2099-08-10",
    });

    expect(form.initialValues).toMatchObject({
      startsOn: "2099-08-10",
      dayCount: 3,
      seats: 4,
      name: "Eva Svobodová",
      email: evaEmail,
    });
    expect(form.replacementToken).toBe("restored-pay-state");
    expect(preloads.availabilityPreloads[0]).toMatchObject({
      replacementToken: "restored-pay-state",
    });
  });
});
