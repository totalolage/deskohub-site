import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { DotyposUnavailable } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { customerAvailabilityReplacementHeader } from "@deskohub/workspace-customer-api";
import { Effect, Layer, Schema } from "effect";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import {
  buildSignedPayState,
  sealPayState,
} from "@/features/checkout/backend/checkout/pay-state";
import { ReservationSupersessionService } from "@/features/checkout/backend/checkout/reservation-supersession.service";
import { buildCoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";
import {
  type DiscountAdvertisementInput,
  discountAdvertisementQuoteCodec,
  discountIdSchema,
} from "@/features/discounts/contracts";
import { DiscountServiceMock } from "@/features/discounts/discount.service.mock";
import { DiscountReleaseGateService } from "@/features/discounts/discount-release-gate.service";
import {
  DiscountAffirmationUnavailableError,
  DiscountProviderError,
} from "@/features/discounts/errors";
import { releaseGateForRunOverFlags } from "@/features/feature-flags/backend/release-cohorts.test-utils";
import type { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend/workspace-feature-flag.service";
import { getPaymentSubmitLegalDocuments } from "@/features/legal/payment-submit-evidence";
import { OfficeReleaseGate } from "@/features/office/backend/office-release-gate";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import { AdvisoryAvailabilityInventory } from "@/features/reservation/backend/availability-inventory";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import { normalizedCoworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import type {
  MeetingRoomStartTimes,
  WorkspaceAvailability,
} from "@/features/reservation/workspace-availability";
import { moneyWithValue } from "@/shared/money/money";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";
import {
  instantStringSchema,
  localDateTimeSchema,
  plainDateStringSchema,
} from "@/shared/utils/temporal";
import {
  answerInEachReleaseCohort,
  type CustomerApiCall,
  customerApiRequest,
  expectEachCohortAnsweredAlone,
  inReleaseCohort,
  makeCustomerApiTestServer,
  testCustomerEndpointGuards,
} from "./customer-api.test-utils";
import type { CustomerBookingCatalogLayerSet } from "./customer-booking-catalog-layers";

type AvailabilityRequest = Parameters<
  WorkspaceAvailabilityService["Service"]["getAvailability"]
>[0];

const workspaceDateFromToday = (days: number) =>
  getCurrentWorkspaceDate().add({ days }).toString();

/** No public sale runs. */
const noSale = ({
  product,
  discountableSubtotal,
}: DiscountAdvertisementInput) =>
  Effect.succeed({
    complete: true,
    quote: discountAdvertisementQuoteCodec.make({
      product,
      discountableSubtotal,
      discounts: [],
      totalDiscount: moneyWithValue(0, discountableSubtotal),
      discountedSubtotal: discountableSubtotal,
    }),
  });

/** Every sale source answers but one, so the prices may miss a sale. */
const incompleteSale = (input: DiscountAdvertisementInput) =>
  noSale(input).pipe(
    Effect.map((discovery) => ({ ...discovery, complete: false }))
  );

const saleDiscountId = Schema.decodeSync(discountIdSchema)("app-sale");

/** A public 10 % sale on every product. */
const tenPercentSale = ({
  product,
  discountableSubtotal,
}: DiscountAdvertisementInput) => {
  const amount = moneyWithValue(
    Math.round(discountableSubtotal.value / 10),
    discountableSubtotal
  );
  const after = moneyWithValue(
    discountableSubtotal.value - amount.value,
    discountableSubtotal
  );
  return Effect.succeed({
    complete: true,
    quote: discountAdvertisementQuoteCodec.make({
      product,
      discountableSubtotal,
      discounts: [
        {
          discount: {
            id: saleDiscountId,
            label: "App sale",
            adjustment: { kind: "percentage", basisPoints: 1000 },
          },
          subtotalBefore: discountableSubtotal,
          amount,
          subtotalAfter: after,
        },
      ],
      totalDiscount: amount,
      discountedSubtotal: after,
    }),
  });
};

/** Anonymous pricing whose sale source answers with `discover`. */
const pricingWith = (
  discoverAdvertisedDiscounts: (
    input: DiscountAdvertisementInput
  ) =>
    | Effect.Effect<never, unknown>
    | ReturnType<typeof noSale>
    | ReturnType<typeof tenPercentSale>
) =>
  CheckoutPricingService.Default.pipe(
    Layer.provide(
      DiscountServiceMock({
        discoverAdvertisedDiscounts: discoverAdvertisedDiscounts as never,
      })
    )
  );

const emptyInventory = Layer.succeed(AdvisoryAvailabilityInventory, {
  tables: Effect.succeed([]),
  listActiveReservationsOverlapping: () => Effect.succeed([]),
  listLimitations: () => Effect.succeed([]),
});

/** Availability served by `service`, with no replacement hold to ignore. */
const availabilityWith = (
  service: Partial<WorkspaceAvailabilityService["Service"]>
) =>
  Layer.mergeAll(
    Layer.mock(WorkspaceAvailabilityService, service),
    Layer.mock(ReservationSupersessionService, {
      findCurrent: () => Effect.succeed(undefined),
    }),
    TestSealedStateKeys
  );

/** The catalog with prices quoted and no sale running. */
const pricedCatalog = (
  overrides: Partial<CustomerBookingCatalogLayerSet> = {}
): Partial<CustomerBookingCatalogLayerSet> => ({
  pricing: pricingWith(noSale),
  inventory: emptyInventory,
  ...overrides,
});

const officeOpen: CustomerBookingCatalogLayerSet["releases"] = {
  office: OfficeReleaseGate.fromDecision(true),
  referral: ReferralReleaseGate.fromDecision(false),
};

const providerDown = new DotyposUnavailable({
  operation: "getTables",
  reason: "timeout",
});

describe("listOfferings", () => {
  const listOfferings: CustomerApiCall = {
    method: "GET",
    path: "/booking/offerings?locale=en-US",
  };

  testCustomerEndpointGuards(listOfferings);

  test("lists every offering at its catalog and advertised price", async () => {
    const api = makeCustomerApiTestServer({ bookingCatalog: pricedCatalog() });

    const response = await api.handle(customerApiRequest(listOfferings));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.advertisedOn).toBe(workspaceDateFromToday(0));
    expect(body.openingHours).toEqual(expect.any(String));
    expect(
      body.offerings.map(
        (offering: { family: string; tier?: string; duration?: string }) => [
          offering.family,
          offering.tier ?? offering.duration,
        ]
      )
    ).toEqual([
      ["cowork", "open-space"],
      ["cowork", "reserved-desk"],
      ["meeting-room", "hour:1"],
      ["meeting-room", "hour:4"],
      ["meeting-room", "day:1"],
    ]);
    expect(body.offerings[0]).toMatchObject({
      name: "Open Space",
      price: { currency: "CZK" },
      addOns: [{ id: "coffee", included: false }],
    });
    for (const offering of body.offerings) {
      expect(offering.advertisedPrice.price).toEqual(offering.price);
      expect(offering.advertisedPrice.discount.value).toBe(0);
    }
  });

  test("lists the office while office reservations are open", async () => {
    const api = makeCustomerApiTestServer({
      bookingCatalog: pricedCatalog({ releases: officeOpen }),
    });

    const response = await api.handle(customerApiRequest(listOfferings));

    expect(response.status).toBe(200);
    expect((await response.json()).offerings.at(-1)).toMatchObject({
      family: "office",
      seatPrice: { currency: "CZK" },
      maximumDurationHours: expect.any(Number),
    });
  });

  test("refuses a language the site doesn't speak", async () => {
    const api = makeCustomerApiTestServer({ bookingCatalog: pricedCatalog() });

    const response = await api.handle(
      customerApiRequest({
        ...listOfferings,
        path: "/booking/offerings?locale=fr-FR",
      })
    );

    expect(response.status).toBe(400);
  });

  test("answers unavailable while a sale source can't answer, rather than prices that may miss a sale", async () => {
    const api = makeCustomerApiTestServer({
      bookingCatalog: pricedCatalog({ pricing: pricingWith(incompleteSale) }),
    });

    const response = await api.handle(customerApiRequest(listOfferings));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });

  test("answers unavailable while the sale source can't be read", async () => {
    const api = makeCustomerApiTestServer({
      bookingCatalog: pricedCatalog({
        pricing: pricingWith(() =>
          Effect.fail(
            new DiscountProviderError({
              reason: "provider_failure",
              message: "Calendar down",
            })
          )
        ),
      }),
    });

    const response = await api.handle(customerApiRequest(listOfferings));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });
});

const testAvailability: WorkspaceAvailability = {
  from: "2026-11-07",
  to: "2026-12-07",
  date: "2026-11-09",
  unavailableDates: ["2026-11-10"],
  reservedDeskWorkstationRequiredDates: [],
  unavailableCoworkTiers: ["reserved-desk"],
  meetingRoomUnavailable: false,
  officeUnavailable: false,
  unavailableMonitorOptions: ["2x32-4k"],
  notices: [
    {
      date: "2026-11-10",
      startsAt: "2026-11-10T08:00:00Z",
      endsAt: "2026-11-10T12:00:00Z",
    },
  ],
};

/** A signed cowork pay state, as a client changing that booking sends it. */
const coworkReplacementToken = Effect.runPromise(
  Effect.gen(function* () {
    const reservation = Schema.decodeUnknownSync(
      normalizedCoworkReservationOrderSchema
    )({
      kind: "cowork",
      entryTier: "open-space",
      date: "2099-06-20",
      coffee: false,
      name: "Ada Lovelace",
      email: testEmailAddress("ada"),
      phone: "+420777000111",
    });
    const state = yield* buildSignedPayState({
      locale: "en-US",
      reservation,
      quote: yield* buildCoworkReservationQuote({
        kind: "cowork",
        entryTier: reservation.entryTier,
        date: reservation.date,
        coffee: reservation.coffee,
      }),
      orderId: "reservation-id",
      bookedAt: Schema.decodeUnknownSync(instantStringSchema)(
        "2099-06-01T10:00:00Z"
      ),
      checkoutSessionId: "session-id",
    });
    return yield* sealPayState(state);
  }).pipe(Effect.provide(TestSealedStateKeys))
);

describe("getAvailability", () => {
  const getAvailability: CustomerApiCall = {
    method: "GET",
    path: "/booking/availability?kind=cowork&from=2026-11-07&to=2026-12-07&date=2026-11-09&entryTier=reserved-desk",
  };

  testCustomerEndpointGuards(getAvailability);

  test("answers the availability the booking pages read for the same query", async () => {
    const queries: AvailabilityRequest[] = [];
    const api = makeCustomerApiTestServer({
      bookingCatalog: {
        availability: availabilityWith({
          getAvailability: (input) => {
            queries.push(input);
            return Effect.succeed(testAvailability);
          },
        }),
      },
    });

    const response = await api.handle(
      customerApiRequest({
        ...getAvailability,
        headers: { [customerAvailabilityReplacementHeader]: "not-a-pay-state" },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(testAvailability);
    expect(queries).toEqual([
      {
        query: {
          kind: "cowork",
          from: "2026-11-07",
          to: "2026-12-07",
          date: "2026-11-09",
          entryTier: "reserved-desk",
        },
        occupancyExclusion: undefined,
      },
    ]);
  });

  // The availability service leaves the date and a notice's summary
  // undefined when the query names no date or the calendar event has no
  // title, as a plain range query does.
  test("answers a range without a date or a notice summary", async () => {
    const api = makeCustomerApiTestServer({
      bookingCatalog: {
        availability: availabilityWith({
          getAvailability: () =>
            Effect.succeed({
              ...testAvailability,
              date: undefined,
              notices: [{ ...testAvailability.notices[0], summary: undefined }],
            }),
        }),
      },
    });

    const response = await api.handle(
      customerApiRequest({ method: "GET", path: "/booking/availability" })
    );

    expect(response.status).toBe(200);
    const { date: _date, ...range } = testAvailability;
    expect(await response.json()).toEqual(range);
  });

  test("ignores the hold of the pay state the client replaces", async () => {
    const queries: AvailabilityRequest[] = [];
    const lookups: unknown[] = [];
    const api = makeCustomerApiTestServer({
      bookingCatalog: {
        availability: Layer.mergeAll(
          Layer.mock(WorkspaceAvailabilityService, {
            getAvailability: (input) => {
              queries.push(input);
              return Effect.succeed(testAvailability);
            },
          }),
          Layer.mock(ReservationSupersessionService, {
            findCurrent: (input) => {
              lookups.push(input);
              return Effect.succeed({
                dotyposReservationId: "dotypos-reservation-1",
              } as never);
            },
          }),
          TestSealedStateKeys
        ),
      },
    });

    const response = await api.handle(
      customerApiRequest({
        ...getAvailability,
        headers: {
          [customerAvailabilityReplacementHeader]: await coworkReplacementToken,
        },
      })
    );

    expect(response.status).toBe(200);
    expect(lookups).toEqual([
      { orderId: "reservation-id", checkoutSessionId: "session-id" },
    ]);
    expect(queries.map(({ occupancyExclusion }) => occupancyExclusion)).toEqual(
      [{ dotyposReservationId: "dotypos-reservation-1" }]
    );
  });

  test.each([
    ["an unknown tier", "kind=cowork&entryTier=basic"],
    ["a malformed date", "kind=cowork&from=7.11.2026"],
    ["no seats", "kind=office&seats=0"],
  ])("refuses %s before reading availability", async (_case, query) => {
    const api = makeCustomerApiTestServer();

    const response = await api.handle(
      customerApiRequest({
        method: "GET",
        path: `/booking/availability?${query}`,
      })
    );

    expect(response.status).toBe(400);
  });

  test("refuses a meeting-room interval no booking spans", async () => {
    const api = makeCustomerApiTestServer();

    const response = await api.handle(
      customerApiRequest({
        method: "GET",
        path: "/booking/availability?kind=meeting-room&startsAt=2026-11-09T09:00&endsAt=2026-11-09T11:00",
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      _tag: "CustomerBookingSelectionInvalid",
    });
  });

  test("answers unavailable while Dotypos can't be read", async () => {
    const api = makeCustomerApiTestServer({
      bookingCatalog: {
        availability: availabilityWith({
          getAvailability: () => Effect.fail(providerDown),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(getAvailability));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });
});

describe("getMeetingRoomStartTimes", () => {
  const getStartTimes: CustomerApiCall = {
    method: "GET",
    path: "/booking/availability/meeting-room-start-times?date=2026-11-09&duration=hour:4",
  };

  const startTimes: MeetingRoomStartTimes = {
    date: plainDateStringSchema.make("2026-11-09"),
    duration: "hour:4",
    startTimes: [
      {
        startDateTime: localDateTimeSchema.make("2026-11-09T09:00"),
        startsAt: instantStringSchema.make("2026-11-09T08:00:00Z"),
        endsAt: instantStringSchema.make("2026-11-09T12:00:00Z"),
        earlySetupAvailable: true,
      },
    ],
  };

  testCustomerEndpointGuards(getStartTimes);

  test("answers every free start of the duration on the date", async () => {
    const queries: unknown[] = [];
    const api = makeCustomerApiTestServer({
      bookingCatalog: {
        availability: availabilityWith({
          getMeetingRoomStartTimes: ({ query }) => {
            queries.push(query);
            return Effect.succeed(startTimes);
          },
        }),
      },
    });

    const response = await api.handle(customerApiRequest(getStartTimes));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(startTimes);
    expect(queries).toEqual([
      {
        kind: "meeting-room",
        mode: "start-times",
        date: "2026-11-09",
        duration: "hour:4",
      },
    ]);
  });

  test.each([
    ["an unknown duration", "date=2026-11-09&duration=hour:2"],
    ["a date that doesn't exist", "date=2026-02-30&duration=hour:1"],
    ["no date", "duration=hour:1"],
  ])("refuses %s", async (_case, query) => {
    const api = makeCustomerApiTestServer();

    const response = await api.handle(
      customerApiRequest({
        method: "GET",
        path: `/booking/availability/meeting-room-start-times?${query}`,
      })
    );

    expect(response.status).toBe(400);
  });

  test("answers unavailable while Dotypos can't be read", async () => {
    const api = makeCustomerApiTestServer({
      bookingCatalog: {
        availability: availabilityWith({
          getMeetingRoomStartTimes: () => Effect.fail(providerDown),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(getStartTimes));

    expect(response.status).toBe(503);
  });
});

describe("getQuote", () => {
  const quotePath = (query: string) => `/booking/quote?locale=en-US&${query}`;
  const coworkToday = quotePath(
    `family=cowork&tier=open-space&coffee=true&date=${workspaceDateFromToday(1)}`
  );
  const getQuote: CustomerApiCall = { method: "GET", path: coworkToday };

  testCustomerEndpointGuards(getQuote);

  test("quotes the selection with its summary and the signed quote checkout starts from", async () => {
    const api = makeCustomerApiTestServer({ bookingCatalog: pricedCatalog() });

    const response = await api.handle(customerApiRequest(getQuote));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.family).toBe("cowork");
    expect(body.total.currency).toBe("CZK");
    expect(body.total).toEqual(body.regularPrice);
    expect(body.discount.value).toBe(0);
    expect(Temporal.Instant.from(body.quotedAt)).toBeInstanceOf(
      Temporal.Instant
    );
    expect(body.summary.total).toEqual(body.total);
    expect(
      body.summary.sections.flatMap(({ items }: { items: { key: string }[] }) =>
        items.map(({ key }) => key)
      )
    ).toEqual(["product:cowork:open-space", "addon:coffee", "total:final"]);
    expect(body.advertisedPriceToken).toEqual(expect.any(String));
    expect(body.advertisedPriceToken.length).toBeGreaterThan(0);
  });

  test("itemizes a sale on the discounted line", async () => {
    const api = makeCustomerApiTestServer({
      bookingCatalog: pricedCatalog({ pricing: pricingWith(tenPercentSale) }),
    });

    const response = await api.handle(
      customerApiRequest({
        method: "GET",
        path: quotePath(
          `family=meeting-room&duration=hour:1&startTime=10:00&date=${workspaceDateFromToday(2)}`
        ),
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.discount.value).toBeGreaterThan(0);
    expect(body.total.value).toBe(
      body.regularPrice.value - body.discount.value
    );
    const [product] = body.summary.sections[0].items;
    expect(Object.keys(product).toSorted()).toEqual([
      "amount",
      "discounts",
      "key",
      "originalAmount",
    ]);
    expect(product.key).toStartWith("product:meeting-room:");
    expect(product.originalAmount).toEqual(body.regularPrice);
    expect(product.discounts).toEqual([
      {
        discount: { id: "app-sale", label: "App sale" },
        amount: body.discount,
      },
    ]);
  });

  test("names the field a family needs", async () => {
    const api = makeCustomerApiTestServer({ bookingCatalog: pricedCatalog() });

    const response = await api.handle(
      customerApiRequest({
        method: "GET",
        path: quotePath(`family=cowork&date=${workspaceDateFromToday(1)}`),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      _tag: "CustomerBookingSelectionInvalid",
      field: "tier",
    });
  });

  test("refuses a date that doesn't exist", async () => {
    const api = makeCustomerApiTestServer({ bookingCatalog: pricedCatalog() });

    const response = await api.handle(
      customerApiRequest({
        method: "GET",
        path: quotePath("family=cowork&tier=open-space&date=2026-02-30"),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      _tag: "CustomerBookingSelectionInvalid",
      field: "date",
    });
  });

  test("tells the client which dates can be booked", async () => {
    const api = makeCustomerApiTestServer({ bookingCatalog: pricedCatalog() });

    const response = await api.handle(
      customerApiRequest({
        method: "GET",
        path: quotePath(
          `family=cowork&tier=open-space&date=${workspaceDateFromToday(-1)}`
        ),
      })
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      _tag: "CustomerBookingDateOutOfRange",
      earliest: expect.any(String),
      latest: expect.any(String),
    });
  });

  test("answers the office as unavailable while office reservations are closed", async () => {
    const api = makeCustomerApiTestServer({ bookingCatalog: pricedCatalog() });

    const response = await api.handle(
      customerApiRequest({
        method: "GET",
        path: quotePath(
          `family=office&seats=2&date=${workspaceDateFromToday(1)}`
        ),
      })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      _tag: "CustomerOfferingUnavailable",
      family: "office",
    });
  });

  test.each([["a sale source that can't answer", incompleteSale]])(
    "answers %s as retryable unavailable",
    async (_case, discover) => {
      const api = makeCustomerApiTestServer({
        bookingCatalog: pricedCatalog({ pricing: pricingWith(discover) }),
      });

      const response = await api.handle(customerApiRequest(getQuote));

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        _tag: "CustomerServiceUnavailable",
      });
    }
  );

  test.each([
    [
      "an unknown Calendar discount",
      new DiscountAffirmationUnavailableError({
        message: "unknown discount",
        discountIds: [],
      }),
    ],
    [
      "a sale source that can't be read",
      new DiscountProviderError({
        reason: "provider_failure",
        message: "Calendar down",
      }),
    ],
  ])(
    "answers %s as retryable unavailable, never as a changed price",
    async (_case, failure) => {
      const api = makeCustomerApiTestServer({
        bookingCatalog: pricedCatalog({
          pricing: pricingWith(() => Effect.fail(failure)),
        }),
      });

      const response = await api.handle(customerApiRequest(getQuote));

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        _tag: "CustomerServiceUnavailable",
      });
    }
  );
});

describe("listLegalDocuments", () => {
  const listLegalDocuments: CustomerApiCall = {
    method: "GET",
    path: "/booking/legal-documents?locale=cs-CZ",
  };

  testCustomerEndpointGuards(listLegalDocuments);

  test("lists the documents a payment accepts, at their current versions", async () => {
    const api = makeCustomerApiTestServer();

    const response = await api.handle(customerApiRequest(listLegalDocuments));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      documents: getPaymentSubmitLegalDocuments("cs-CZ"),
    });
  });

  test("refuses a language the site doesn't speak", async () => {
    const api = makeCustomerApiTestServer();

    const response = await api.handle(
      customerApiRequest({
        method: "GET",
        path: "/booking/legal-documents?locale=fr-FR",
      })
    );

    expect(response.status).toBe(400);
  });
});

describe("overlapping requests in different release cohorts", () => {
  /**
   * The catalog with every release gate decided over `featureFlags`: the
   * office's and the referral program's, and the discount gates under
   * pricing, which run a 10 % sale while calendar sales are released.
   */
  const catalogDecidedOver = (
    featureFlags: Layer.Layer<WorkspaceFeatureFlagService>
  ): Partial<CustomerBookingCatalogLayerSet> => ({
    pricing: CheckoutPricingService.Default.pipe(
      Layer.provide(
        Layer.unwrap(
          Effect.map(DiscountReleaseGateService, (gates) =>
            DiscountServiceMock({
              discoverAdvertisedDiscounts: ((
                input: DiscountAdvertisementInput
              ) =>
                gates
                  .evaluate({ operation: "discover_advertised_discounts" })
                  .pipe(
                    Effect.flatMap(({ calendarSales }) =>
                      calendarSales ? tenPercentSale(input) : noSale(input)
                    )
                  )) as never,
            })
          )
        ).pipe(
          Layer.provide(DiscountReleaseGateService.Default),
          Layer.provide(featureFlags)
        )
      )
    ),
    inventory: emptyInventory,
    releases: {
      office: releaseGateForRunOverFlags(OfficeReleaseGate, featureFlags),
      referral: releaseGateForRunOverFlags(ReferralReleaseGate, featureFlags),
    },
  });

  const serve = (featureFlags: Layer.Layer<WorkspaceFeatureFlagService>) =>
    makeCustomerApiTestServer({
      bookingCatalog: catalogDecidedOver(featureFlags),
    });

  test("lists the offerings and their sale prices each request's own cohort sees", async () => {
    const listOfferings: CustomerApiCall = {
      method: "GET",
      path: "/booking/offerings?locale=en-US",
    };

    expectEachCohortAnsweredAlone(
      await answerInEachReleaseCohort({
        serve,
        send: (cohort) =>
          customerApiRequest(inReleaseCohort(listOfferings, cohort)),
      })
    );
  });

  test("quotes each request's selection with the sale its own cohort sees", async () => {
    const getQuote: CustomerApiCall = {
      method: "GET",
      path: `/booking/quote?locale=en-US&family=meeting-room&duration=hour:1&startTime=10:00&date=${workspaceDateFromToday(2)}`,
    };

    expectEachCohortAnsweredAlone(
      await answerInEachReleaseCohort({
        serve,
        send: (cohort) => customerApiRequest(inReleaseCohort(getQuote, cohort)),
        // The quote's time and signed token differ between any two quotes.
        answer: async (response) => {
          const { total, regularPrice, discount } = await response.json();
          return { status: response.status, total, regularPrice, discount };
        },
      })
    );
  });
});
