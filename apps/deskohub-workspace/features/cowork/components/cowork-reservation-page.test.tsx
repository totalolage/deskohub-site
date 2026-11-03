import { beforeEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Schema } from "effect";
import { isValidElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { getAdvertisedProductItem } from "@/features/checkout/advertised-price";
import {
  buildCoworkCheckoutSummary,
  buildCoworkReservationQuote,
} from "@/features/checkout/checkout-quote.test-utils";
import { PublicOfferingsStructuredData } from "@/features/checkout/components/public-offerings-structured-data";
import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import { discountIdSchema } from "@/features/discounts/contracts";
import { m } from "@/features/i18n";
import { recordReservationPagePreloads } from "@/features/reservation/backend/reservation-page-preloads.service.mock";
import {
  type NormalizedCoworkReservationOrder,
  normalizedBasicCoworkReservationOrderSchema,
  normalizedOpenSpaceCoworkReservationOrderSchema,
  normalizedReservedDeskCoworkReservationOrderSchema,
} from "@/features/reservation/cowork-reservation";
import { defaultReservationBillingSelection } from "@/features/reservation/reservation-billing";
import type { CustomerLastReservationForKind } from "@/features/reservation/reservation-existing-customer";
import { getCoworkAvailabilityQueries } from "@/features/reservation/workspace-availability";
import { Button } from "@/shared/components/ui/button";
import { currencyCZK } from "@/shared/money/currencies";
import { moneyMajorAmount } from "@/shared/money/money";

const janEmail = testEmailAddress("jan");

mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));

let isRememberedOfferAvailable = true;
const isRememberedCoworkOfferAvailable = mock(() =>
  Effect.succeed(isRememberedOfferAvailable)
);
const existingCustomer = await import(
  "@/features/reservation/backend/reservation-existing-customer.server"
);
mock.module(
  "@/features/reservation/backend/reservation-existing-customer.server",
  () => ({
    ...existingCustomer,
    isRememberedCoworkOfferAvailable,
    isRememberedMeetingRoomReservationAvailable: () => Effect.succeed(false),
    loadReservationCheckoutAccount: () =>
      Promise.resolve({ status: "signed-out" }),
  })
);

const { CoworkOfferReplaced, coworkReservationPage } = await import(
  "./cowork-reservation-page"
);

// Each request preloads, without a price the structured data could use.
const loadAdvertisedPrices = mock((requests: ReadonlyArray<unknown>) =>
  Effect.succeed(requests.map((request) => ({ request })))
);
const recordEveryPricePreload = () =>
  recordReservationPagePreloads({
    advertisedPrices: (requests) => loadAdvertisedPrices(requests) as never,
  });
let preloads = recordEveryPricePreload();

type CoworkPageRequest = Parameters<
  typeof coworkReservationPage.loadContent
>[0];

/** What the page renders: its structured data and form, or a restart. */
const loadCoworkReservationContent = ({
  checkoutAccount = { status: "signed-out" },
  initialReservation,
  replacementToken = "signed-replacement-token",
  ...request
}: Omit<CoworkPageRequest, "checkoutAccount" | "pageData"> & {
  readonly checkoutAccount?: CoworkPageRequest["checkoutAccount"];
  readonly initialReservation?: NormalizedCoworkReservationOrder;
  readonly replacementToken?: string;
}) =>
  Effect.runPromise(
    coworkReservationPage
      .loadContent({
        checkoutAccount,
        pageData: undefined,
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

/** The content's form and structured data offerings. */
const loadCoworkReservationForm = async (
  input: Parameters<typeof loadCoworkReservationContent>[0]
) => {
  const content = await loadCoworkReservationContent(input);
  if (content.kind !== "form") throw new Error("Expected the reservation form");
  return content;
};

/** The form the page renders beside its structured data. */
const renderCoworkReservationForm = async (
  input: Parameters<typeof loadCoworkReservationContent>[0]
) => (await loadCoworkReservationForm(input)).form;

beforeEach(() => {
  mock.clearAllMocks();
  preloads = recordEveryPricePreload();
});

const stubWorkspaceInstant = (
  run: () => Promise<void>,
  instant = "2099-07-30T13:01:00Z"
): Promise<void> => {
  const originalNow = Temporal.Now.instant;
  Temporal.Now.instant = () => Temporal.Instant.from(instant);

  return run().finally(() => {
    Temporal.Now.instant = originalNow;
  });
};

const decodeLegacyBasicReservation = Schema.decodeUnknownSync(
  normalizedBasicCoworkReservationOrderSchema
);

const decodeOpenSpaceReservation = Schema.decodeUnknownSync(
  normalizedOpenSpaceCoworkReservationOrderSchema
);

const decodeReservedDeskReservation = Schema.decodeUnknownSync(
  normalizedReservedDeskCoworkReservationOrderSchema
);

type CoworkForm = Awaited<ReturnType<typeof renderCoworkReservationForm>>;

const coworkPriceRequest = (
  locale: string,
  date: string,
  details:
    | { readonly entryTier: "open-space"; readonly coffee: boolean }
    | { readonly entryTier: "reserved-desk"; readonly workstation: boolean }
) => ({
  locale,
  reservation: {
    kind: "cowork",
    details: { kind: "cowork", ...details, date },
  },
});

// Every tier card, coffee choice, and the workstation addon for the date.
const everyCoworkPriceRequest = (locale: string, date: string) => [
  coworkPriceRequest(locale, date, { entryTier: "open-space", coffee: false }),
  coworkPriceRequest(locale, date, { entryTier: "open-space", coffee: true }),
  coworkPriceRequest(locale, date, {
    entryTier: "reserved-desk",
    workstation: false,
  }),
  coworkPriceRequest(locale, date, {
    entryTier: "reserved-desk",
    workstation: true,
  }),
];

/** The page preloads exactly the availability its form reads first. */
const expectPreloadedFormAvailability = (form: CoworkForm) => {
  const { initialValues, today } = form;
  const queries = Object.values(
    getCoworkAvailabilityQueries({ ...initialValues, today })
  );

  expect(preloads.availabilityPreloads).toHaveLength(1);
  expect(preloads.availabilityPreloads[0].queries).toEqual(queries);
  expect(form.initialAvailability?.map(({ query }) => query)).toEqual(queries);
};

/**
 * Locates the restart Button and returns its direct-child anchor's href.
 * A `next/link` `legacyBehavior` anchor wrapped inside the Button does not
 * count: only a plain document anchor as the Button's immediate child proves
 * document navigation.
 */
const getRestartButtonDirectChildAnchorHref = (
  node: ReactNode
): string | undefined => {
  if (Array.isArray(node)) {
    for (const child of node) {
      const href = getRestartButtonDirectChildAnchorHref(child);
      if (href !== undefined) {
        return href;
      }
    }
    return undefined;
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) {
    return undefined;
  }
  // biome-ignore lint/plugin: an identity check on the rendered element type passes no props.
  if (node.type === Button) {
    const { children } = node.props;
    const anchor = Array.isArray(children) ? children[0] : children;
    if (
      isValidElement<{ href?: string }>(anchor) &&
      anchor.type === "a" &&
      anchor.props.href !== undefined
    ) {
      return anchor.props.href;
    }
    return undefined;
  }
  return getRestartButtonDirectChildAnchorHref(node.props.children);
};

test("preloads every cowork price and the default selection's availability", async () =>
  stubWorkspaceInstant(async () => {
    const form = await renderCoworkReservationForm({
      locale: "en-US",
      searchParams: {},
    });

    expect(form.initialValues).toMatchObject({
      entryTier: "open-space",
      coffee: false,
      date: "2099-07-30",
    });
    expect(form.today).toBe("2099-07-30");

    expect(loadAdvertisedPrices).toHaveBeenCalledTimes(1);
    expect(preloads.advertisedPriceRequests[0]).toEqual(
      everyCoworkPriceRequest("en-US", "2099-07-30")
    );
    expect(form.initialAdvertisedPrices).toHaveLength(4);
    expectPreloadedFormAvailability(form);
    expect(preloads.availabilityPreloads[0].queries).toEqual([
      {
        kind: "cowork",
        from: "2099-07-30",
        to: "2100-01-30",
        entryTier: "open-space",
      },
      {
        kind: "cowork",
        from: "2099-07-30",
        to: "2099-07-30",
        entryTier: "open-space",
        date: "2099-07-30",
      },
    ]);
  }));

test("offers the default selection's preloaded prices in structured data", async () =>
  stubWorkspaceInstant(async () => {
    const openSpacePrice = getWorkspaceProductByTier("open-space").price;
    const sale = {
      product: { kind: "cowork" as const, tier: "open-space" as const },
      discountableSubtotal: openSpacePrice,
      discounts: [
        {
          discount: {
            id: Schema.decodeUnknownSync(discountIdSchema)("summer-sale"),
            label: "Summer sale",
            adjustment: { kind: "percentage" as const, basisPoints: 5000 },
          },
          subtotalBefore: openSpacePrice,
          amount: currencyCZK(openSpacePrice.value / 2),
          subtotalAfter: currencyCZK(openSpacePrice.value / 2),
        },
      ],
      totalDiscount: currencyCZK(openSpacePrice.value / 2),
      discountedSubtotal: currencyCZK(openSpacePrice.value / 2),
    };
    const openSpaceOrder = { entryTier: "open-space" as const, coffee: false };
    loadAdvertisedPrices.mockImplementationOnce((requests) =>
      Effect.succeed(
        requests.map((request) => ({
          request,
          advertisedPrice: {
            kind: "cowork",
            quote: buildCoworkReservationQuote(openSpaceOrder, {
              discountQuote: sale,
            }),
            summary: buildCoworkCheckoutSummary(openSpaceOrder, {
              discountQuote: sale,
            }),
            advertisedPriceToken: "sealed",
          },
        }))
      )
    );

    const { form, offerings } = await loadCoworkReservationForm({
      locale: "en-US",
      searchParams: {},
    });
    const markup = renderToString(
      <PublicOfferingsStructuredData locale="en-US" offerings={offerings} />
    );
    const services = JSON.parse(
      markup.slice(markup.indexOf(">") + 1, markup.lastIndexOf("</script>"))
    )["@graph"];
    const openSpaceAdvertisedPrice = form.initialAdvertisedPrices?.find(
      ({ request }) =>
        request.reservation.kind === "cowork" &&
        request.reservation.details.entryTier === "open-space" &&
        !request.reservation.details.coffee
    )?.advertisedPrice;
    const displayedAmount =
      openSpaceAdvertisedPrice &&
      getAdvertisedProductItem(openSpaceAdvertisedPrice, {
        kind: "cowork",
        tier: "open-space",
      })?.amount;

    expect(markup).toStartWith('<script type="application/ld+json">');
    expect(displayedAmount).toEqual(currencyCZK(openSpacePrice.value / 2));
    expect(services[0]).toMatchObject({
      name: m.reservationOpenSpaceTitle({}, { locale: "en-US" }),
      offers: {
        url: "https://workspace.deskohub.cz/reservation/cowork",
        price: moneyMajorAmount(displayedAmount ?? openSpacePrice),
        priceCurrency: "CZK",
      },
    });
  }));

test("preloads the Prague workspace date's range just before UTC midnight", async () =>
  stubWorkspaceInstant(async () => {
    const form = await renderCoworkReservationForm({
      locale: "en-US",
      searchParams: {},
    });

    // 22:30 UTC is already the next day in Prague (CEST, UTC+2).
    expect(form.today).toBe("2099-07-31");
    expect(form.initialValues?.date).toBe("2099-07-31");
    expect(preloads.availabilityPreloads[0].queries[0]).toEqual({
      kind: "cowork",
      from: "2099-07-31",
      to: "2100-01-31",
      entryTier: "open-space",
    });
    expectPreloadedFormAvailability(form);
  }, "2099-07-30T22:30:00Z"));

test("preloads the selection resolved from reservation query values", async () => {
  const form = await renderCoworkReservationForm({
    locale: "cs-CZ",
    searchParams: {
      entryTier: "reserved-desk",
      coffee: "true",
      date: "2099-08-01",
      monitorOption: "2x27-qhd",
    },
  });

  expect(form.initialValues).toMatchObject({
    entryTier: "reserved-desk",
    coffee: true,
    date: "2099-08-01",
    monitorOption: "2x27-qhd",
    name: "",
    email: "",
    phone: "",
  });

  expect(preloads.advertisedPriceRequests[0]).toEqual(
    everyCoworkPriceRequest("cs-CZ", "2099-08-01")
  );
  expectPreloadedFormAvailability(form);
  expect(preloads.availabilityPreloads[0].queries.slice(1)).toEqual([
    {
      kind: "cowork",
      from: "2099-08-01",
      to: "2099-08-01",
      entryTier: "reserved-desk",
      date: "2099-08-01",
      monitorOption: "2x27-qhd",
    },
    {
      kind: "cowork",
      from: "2099-08-01",
      to: "2099-08-01",
      entryTier: "reserved-desk",
      date: "2099-08-01",
    },
  ]);
});

test("offers the restart state for a legacy basic reservation in en-US", async () => {
  const legacyBasicReservation = decodeLegacyBasicReservation({
    kind: "cowork",
    name: "Jan Novák",
    email: janEmail,
    phone: "+420712345678",
    billing: defaultReservationBillingSelection,
    entryTier: "basic",
    coffee: false,
    date: "2099-08-01",
  }) as NormalizedCoworkReservationOrder;

  const content = await loadCoworkReservationContent({
    locale: "en-US",
    initialReservation: legacyBasicReservation,
    searchParams: {},
  });
  if (content.kind !== "replaced") throw new Error("Expected the restart");
  const markup = renderToString(content.content);

  expect(preloads.availabilityPreloads).toHaveLength(0);
  expect(loadAdvertisedPrices).not.toHaveBeenCalled();
  expect(markup).toContain(
    m.reservationValidationCoworkOfferReplaced({}, { locale: "en-US" })
  );
  expect(markup).toContain(`<a href="/en-US/reservation/cowork"`);
  expect(
    getRestartButtonDirectChildAnchorHref(
      CoworkOfferReplaced({ locale: "en-US" })
    )
  ).toBe("/en-US/reservation/cowork");
});

test("restores a signed current-tier open-space reservation into the form", async () => {
  const restoredOpenSpaceReservation = decodeOpenSpaceReservation({
    kind: "cowork",
    name: "Jan Novák",
    email: janEmail,
    phone: "+420712345678",
    billing: defaultReservationBillingSelection,
    entryTier: "open-space",
    coffee: true,
    date: "2099-08-01",
  }) as NormalizedCoworkReservationOrder;

  const form = await renderCoworkReservationForm({
    locale: "en-US",
    initialReservation: restoredOpenSpaceReservation,
    searchParams: {},
  });

  expect(form.initialValues).toMatchObject({
    entryTier: "open-space",
    coffee: true,
    date: "2099-08-01",
    name: "Jan Novák",
    email: janEmail,
  });
  expect(loadAdvertisedPrices).toHaveBeenCalledTimes(1);
  expect(preloads.advertisedPriceRequests[0]).toEqual(
    everyCoworkPriceRequest("en-US", "2099-08-01")
  );
  expectPreloadedFormAvailability(form);
});

test("reopens the cowork selection edited after returning from Pay with the restored checkout", async () => {
  const restoredReservedDeskReservation = decodeReservedDeskReservation({
    kind: "cowork",
    name: "Jan Novák",
    email: janEmail,
    phone: "+420712345678",
    billing: defaultReservationBillingSelection,
    entryTier: "reserved-desk",
    coffee: true,
    monitorOption: "2x27-qhd",
    date: "2099-08-01",
  }) as NormalizedCoworkReservationOrder;

  const form = await renderCoworkReservationForm({
    locale: "en-US",
    initialReservation: restoredReservedDeskReservation,
    replacementToken: "restored-pay-state",
    searchParams: {
      coffee: "true",
      date: "2099-08-03",
      entryTier: "reserved-desk",
      monitorOption: "none",
      name: "Query Override",
      payState: "restored-pay-state",
    },
  });

  expect(form.initialValues).toMatchObject({
    entryTier: "reserved-desk",
    coffee: true,
    monitorOption: undefined,
    date: "2099-08-03",
    name: "Jan Novák",
    email: janEmail,
  });
  expect(form.replacementToken).toBe("restored-pay-state");
  expect(preloads.advertisedPriceRequests[0]).toEqual(
    everyCoworkPriceRequest("en-US", "2099-08-03")
  );
});

test("restores a signed current-tier reserved-desk reservation into the form", async () => {
  const restoredReservedDeskReservation = decodeReservedDeskReservation({
    kind: "cowork",
    name: "Jan Novák",
    email: janEmail,
    phone: "+420712345678",
    billing: defaultReservationBillingSelection,
    entryTier: "reserved-desk",
    coffee: true,
    monitorOption: "2x27-qhd",
    date: "2099-08-01",
  }) as NormalizedCoworkReservationOrder;

  const form = await renderCoworkReservationForm({
    locale: "en-US",
    initialReservation: restoredReservedDeskReservation,
    searchParams: {},
  });

  expect(form.initialValues).toMatchObject({
    entryTier: "reserved-desk",
    coffee: true,
    monitorOption: "2x27-qhd",
    date: "2099-08-01",
  });
  expect(loadAdvertisedPrices).toHaveBeenCalledTimes(1);
  expect(preloads.advertisedPriceRequests[0]).toEqual(
    everyCoworkPriceRequest("en-US", "2099-08-01")
  );
  expectPreloadedFormAvailability(form);
});

describe("a linked customer's remembered cowork offer", () => {
  const linkedAccount = (
    lastReservation: CustomerLastReservationForKind<"cowork">
  ) =>
    ({
      status: "linked",
      customer: {
        contact: { name: "Jan Novak", email: janEmail, phone: "+420777777777" },
        hasMarketingConsent: false,
        lastReservation,
      },
    }) as const;

  const renderInitialValues = async (
    lastReservation: CustomerLastReservationForKind<"cowork">
  ) => {
    let form: CoworkForm | undefined;
    await stubWorkspaceInstant(async () => {
      form = await renderCoworkReservationForm({
        checkoutAccount: linkedAccount(lastReservation),
        locale: "en-US",
        searchParams: {},
      });
    });
    return form?.initialValues;
  };

  const reservedDeskWithWorkstation = {
    kind: "cowork",
    entryTier: "reserved-desk",
    coffee: true,
    monitorOption: "2x27-qhd",
  } as const;

  test("opens on the remembered offer while it is bookable on the form's date", async () => {
    isRememberedOfferAvailable = true;

    expect(
      await renderInitialValues(reservedDeskWithWorkstation)
    ).toMatchObject({
      date: "2099-07-30",
      entryTier: "reserved-desk",
      monitorOption: "2x27-qhd",
    });
    expect(isRememberedCoworkOfferAvailable).toHaveBeenCalledWith(
      expect.objectContaining({
        date: "2099-07-30",
        entryTier: "reserved-desk",
        monitorOption: "2x27-qhd",
      })
    );
  });

  test("opens on the link's selection once the remembered offer is taken", async () => {
    isRememberedOfferAvailable = false;

    expect(
      await renderInitialValues(reservedDeskWithWorkstation)
    ).toMatchObject({
      date: "2099-07-30",
      entryTier: "open-space",
      coffee: false,
    });
    expect(isRememberedCoworkOfferAvailable).toHaveBeenCalledTimes(1);
  });

  test("skips the availability check when the remembered offer matches the link", async () => {
    expect(
      await renderInitialValues({
        kind: "cowork",
        entryTier: "open-space",
        coffee: false,
      })
    ).toMatchObject({ entryTier: "open-space", coffee: false });
    expect(isRememberedCoworkOfferAvailable).not.toHaveBeenCalled();
  });
});
