import { beforeEach, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Schema } from "effect";
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToString } from "react-dom/server";
import { getAdvertisedProductItem } from "@/features/checkout/advertised-price";
import {
  buildCoworkCheckoutSummary,
  buildCoworkReservationQuote,
} from "@/features/checkout/checkout-quote.test-utils";
import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import { discountIdSchema } from "@/features/discounts/contracts";
import { m } from "@/features/i18n";
import {
  type NormalizedCoworkReservationOrder,
  normalizedBasicCoworkReservationOrderSchema,
  normalizedOpenSpaceCoworkReservationOrderSchema,
  normalizedReservedDeskCoworkReservationOrderSchema,
} from "@/features/reservation/cowork-reservation";
import { defaultReservationBillingSelection } from "@/features/reservation/reservation-billing";
import {
  getCoworkAvailabilityQueries,
  type WorkspaceAvailabilityQuery,
} from "@/features/reservation/workspace-availability";
import { Button } from "@/shared/components/ui/button";
import { currencyCZK } from "@/shared/money/currencies";
import { moneyMajorAmount } from "@/shared/money/money";
import type { CoworkReservationForm } from "./cowork-reservation-form";

const janEmail = testEmailAddress("jan");

mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));

// Each request preloads, without a price the structured data could use.
const loadAdvertisedPrices = mock((requests: ReadonlyArray<unknown>) =>
  Effect.succeed(requests.map((request) => ({ request })))
);

mock.module("@/features/reservation/backend/advertised-prices.server", () => ({
  loadAdvertisedPrices,
  preloadPageAdvertisedPrices: loadAdvertisedPrices,
}));

const preloadAvailability = mock(
  ({
    queries,
  }: {
    readonly queries: ReadonlyArray<WorkspaceAvailabilityQuery>;
    readonly replacementToken?: string;
  }) =>
    Effect.succeed(
      queries.map((query) => ({
        query,
        availability: {
          from: query.from,
          to: query.to,
          unavailableDates: [],
          reservedDeskWorkstationRequiredDates: [],
          unavailableCoworkTiers: [],
          meetingRoomUnavailable: false,
          officeUnavailable: false,
          unavailableMonitorOptions: [],
          notices: [],
        },
        loadedAt: 1,
      }))
    )
);

mock.module(
  "@/features/reservation/backend/workspace-availability-loader",
  () => ({
    preloadPageAvailability: preloadAvailability,
  })
);

const { CoworkOfferReplaced, renderCoworkReservationContent } = await import(
  "./cowork-reservation-page"
);

/** The form the page renders beside its structured data. */
const renderCoworkReservationForm = async (
  input: Omit<
    Parameters<typeof renderCoworkReservationContent>[0],
    "checkoutAccount"
  > &
    Partial<
      Pick<
        Parameters<typeof renderCoworkReservationContent>[0],
        "checkoutAccount"
      >
    >
) => {
  const page = (await renderCoworkReservationContent({
    checkoutAccount: { status: "signed-out" },
    ...input,
  })) as ReactElement<{
    readonly children: ReactNode;
  }>;
  return Children.toArray(page.props.children)[1];
};

beforeEach(() => mock.clearAllMocks());

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

type CoworkFormElement = ReactElement<
  Parameters<typeof CoworkReservationForm>[0]
>;

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
const expectPreloadedFormAvailability = (form: CoworkFormElement) => {
  const { initialValues, today } = form.props;
  const queries = Object.values(
    getCoworkAvailabilityQueries({ ...initialValues, today })
  );

  expect(preloadAvailability).toHaveBeenCalledTimes(1);
  expect(preloadAvailability.mock.calls[0]?.[0].queries).toEqual(queries);
  expect(form.props.initialAvailability?.map(({ query }) => query)).toEqual(
    queries
  );
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
    const form = (await renderCoworkReservationForm({
      locale: "en-US",
      searchParams: {},
    })) as CoworkFormElement;

    expect(form.props.initialValues).toMatchObject({
      entryTier: "open-space",
      coffee: false,
      date: "2099-07-30",
    });
    expect(form.props.today).toBe("2099-07-30");

    expect(loadAdvertisedPrices).toHaveBeenCalledTimes(1);
    expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toEqual(
      everyCoworkPriceRequest("en-US", "2099-07-30")
    );
    expect(form.props.initialAdvertisedPrices).toHaveLength(4);
    expectPreloadedFormAvailability(form);
    expect(preloadAvailability.mock.calls[0]?.[0].queries).toEqual([
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

    const page = (await renderCoworkReservationContent({
      checkoutAccount: { status: "signed-out" },
      locale: "en-US",
      searchParams: {},
    })) as ReactElement<{ readonly children: ReactNode }>;
    const [structuredData, form] = Children.toArray(page.props.children) as [
      ReactElement,
      CoworkFormElement,
    ];
    const markup = renderToString(structuredData);
    const services = JSON.parse(
      markup.slice(markup.indexOf(">") + 1, markup.lastIndexOf("</script>"))
    )["@graph"];
    const openSpaceAdvertisedPrice = form.props.initialAdvertisedPrices?.find(
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
    const form = (await renderCoworkReservationForm({
      locale: "en-US",
      searchParams: {},
    })) as CoworkFormElement;

    // 22:30 UTC is already the next day in Prague (CEST, UTC+2).
    expect(form.props.today).toBe("2099-07-31");
    expect(form.props.initialValues?.date).toBe("2099-07-31");
    expect(preloadAvailability.mock.calls[0]?.[0].queries[0]).toEqual({
      kind: "cowork",
      from: "2099-07-31",
      to: "2100-01-31",
      entryTier: "open-space",
    });
    expectPreloadedFormAvailability(form);
  }, "2099-07-30T22:30:00Z"));

test("preloads the selection resolved from reservation query values", async () => {
  const form = (await renderCoworkReservationForm({
    locale: "cs-CZ",
    searchParams: {
      entryTier: "reserved-desk",
      coffee: "true",
      date: "2099-08-01",
      monitorOption: "2x27-qhd",
    },
  })) as CoworkFormElement;

  expect(form.props.initialValues).toMatchObject({
    entryTier: "reserved-desk",
    coffee: true,
    date: "2099-08-01",
    monitorOption: "2x27-qhd",
    name: "",
    email: "",
    phone: "",
  });

  expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toEqual(
    everyCoworkPriceRequest("cs-CZ", "2099-08-01")
  );
  expectPreloadedFormAvailability(form);
  expect(preloadAvailability.mock.calls[0]?.[0].queries.slice(1)).toEqual([
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

  const markup = renderToString(
    await renderCoworkReservationContent({
      checkoutAccount: { status: "signed-out" },
      locale: "en-US",
      initialReservation: legacyBasicReservation,
      searchParams: {},
    })
  );

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

  const form = (await renderCoworkReservationForm({
    locale: "en-US",
    initialReservation: restoredOpenSpaceReservation,
    searchParams: {},
  })) as CoworkFormElement;

  expect(form.props.initialValues).toMatchObject({
    entryTier: "open-space",
    coffee: true,
    date: "2099-08-01",
    name: "Jan Novák",
    email: janEmail,
  });
  expect(loadAdvertisedPrices).toHaveBeenCalledTimes(1);
  expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toEqual(
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

  const form = (await renderCoworkReservationForm({
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
  })) as CoworkFormElement;

  expect(form.props.initialValues).toMatchObject({
    entryTier: "reserved-desk",
    coffee: true,
    monitorOption: undefined,
    date: "2099-08-03",
    name: "Jan Novák",
    email: janEmail,
  });
  expect(form.props.replacementToken).toBe("restored-pay-state");
  expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toEqual(
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

  const form = (await renderCoworkReservationForm({
    locale: "en-US",
    initialReservation: restoredReservedDeskReservation,
    searchParams: {},
  })) as CoworkFormElement;

  expect(form.props.initialValues).toMatchObject({
    entryTier: "reserved-desk",
    coffee: true,
    monitorOption: "2x27-qhd",
    date: "2099-08-01",
  });
  expect(loadAdvertisedPrices).toHaveBeenCalledTimes(1);
  expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toEqual(
    everyCoworkPriceRequest("en-US", "2099-08-01")
  );
  expectPreloadedFormAvailability(form);
});
