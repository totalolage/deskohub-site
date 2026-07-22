import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { Deferred, Effect, Layer, Logger, References, Schema } from "effect";
import type { WorkspaceProductIdentity } from "@/features/checkout/product-identity";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import { WorkspaceFeatureFlagServiceMock } from "@/features/feature-flags/backend/workspace-feature-flag.service.mock";
import { CalendarDiscountProviderMock } from "./calendar-discount-provider.service.mock";
import { CodeDiscountProviderMock } from "./code-discount-provider.service.mock";
import {
  affirmedDiscountAdvertisementQuoteCodec,
  canonicalDiscountCodeSchema,
  type Discount,
  type DiscountAdvertisementInput,
  discountIdSchema,
  discountQuoteCodec,
} from "./contracts";
import { CustomerDiscountProviderMock } from "./customer-discount-provider.service.mock";
import {
  DiscountService,
  type DisplayedDiscountAffirmationInput,
} from "./discount.service";
import { DiscountReleaseGateService } from "./discount-release-gate.service";
import { DiscountReleaseGateServiceMock } from "./discount-release-gate.service.mock";
import { DiscountCodeUnavailableError, DiscountProviderError } from "./errors";
import {
  discountCodeIdSchema,
  storedDiscountIdSchema,
} from "./persistence-contracts";
import type { DiscountCandidate } from "./provider";

const product = {
  kind: "cowork",
  tier: "basic",
} satisfies WorkspaceProductIdentity;

const money = (value: number): WorkspaceMoney => ({
  value,
  exponent: 2,
  currency: "CZK",
});

const advertisementInput: DiscountAdvertisementInput = {
  product,
  discountableSubtotal: money(10_000),
  reservationDate: "2026-07-20",
  locale: "en-US",
};

const paymentInput: DisplayedDiscountAffirmationInput = {
  ...advertisementInput,
  dotyposCustomerId: "customer-1",
  submittedCode: Schema.decodeUnknownSync(canonicalDiscountCodeSchema)(
    "SAVE20"
  ),
  displayedDiscountIds: [],
};

const discountId = Schema.decodeUnknownSync(discountIdSchema);

const allReleaseGatesEnabled = DiscountReleaseGateServiceMock({
  evaluate: () =>
    Effect.succeed({
      calendarSales: true,
      customerDiscounts: true,
      discountCodes: true,
    }),
});

const candidate = (
  id: string,
  adjustment: Discount["adjustment"],
  providerNamespace: string
): DiscountCandidate => ({
  discount: {
    id: discountId(id),
    label: id,
    adjustment,
  },
  provenance: {
    providerNamespace,
    providerReference: `${providerNamespace}-${id}`,
  },
});

const percentage = (
  id: string,
  basisPoints: number,
  providerNamespace: string
) => candidate(id, { kind: "percentage", basisPoints }, providerNamespace);

const emptyAffirmedAdvertisement = affirmedDiscountAdvertisementQuoteCodec.make(
  {
    product,
    discountableSubtotal: advertisementInput.discountableSubtotal,
    discounts: [],
    totalDiscount: money(0),
    discountedSubtotal: advertisementInput.discountableSubtotal,
  }
);

const runWithProviders = <A, E>(
  effect: Effect.Effect<A, E, DiscountService>,
  providers: Layer.Layer<
    | import("./calendar-discount-provider.service").CalendarDiscountProvider
    | import("./customer-discount-provider.service").CustomerDiscountProvider
    | import("./code-discount-provider.service").CodeDiscountProvider
  >,
  releaseGates: Layer.Layer<
    import("./discount-release-gate.service").DiscountReleaseGateService
  > = allReleaseGatesEnabled
) =>
  effect.pipe(
    Effect.provide(
      DiscountService.Live.pipe(
        Layer.provide(Layer.mergeAll(providers, releaseGates))
      )
    ),
    Effect.runPromise
  );

describe("DiscountService", () => {
  test("starts payment-affirmation providers in parallel", async () => {
    const allProvidersStarted = Deferred.makeUnsafe<void>();
    const startedProviders: string[] = [];
    const waitForEveryProvider = (provider: string) =>
      Effect.sync(() => {
        startedProviders.push(provider);
        return startedProviders.length === 3;
      }).pipe(
        Effect.tap((allStarted) =>
          allStarted
            ? Deferred.succeed(allProvidersStarted, undefined)
            : Effect.void
        ),
        Effect.andThen(Deferred.await(allProvidersStarted)),
        Effect.as([])
      );
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({
        revalidate: () => waitForEveryProvider("calendar"),
      }),
      CustomerDiscountProviderMock({
        resolve: () => waitForEveryProvider("customer"),
      }),
      CodeDiscountProviderMock({
        revalidate: () => waitForEveryProvider("code"),
      })
    );

    await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.affirmDisplayedDiscounts(paymentInput);
      }).pipe(Effect.timeout("1 second")),
      providers
    );

    expect(startedProviders.toSorted()).toEqual([
      "calendar",
      "code",
      "customer",
    ]);
  });

  test("applies freshly resolved candidates in displayed order", async () => {
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({
        revalidate: () =>
          Effect.succeed([
            percentage("calendar-a", 1000, "calendar"),
            percentage("calendar-b", 2000, "calendar"),
          ]),
      }),
      CustomerDiscountProviderMock({
        resolve: () =>
          Effect.succeed([percentage("customer", 500, "customer")]),
      }),
      CodeDiscountProviderMock({
        revalidate: () =>
          Effect.succeed([
            candidate("code", { kind: "fixed", amount: money(1000) }, "code"),
          ]),
      })
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.affirmDisplayedDiscounts({
          ...paymentInput,
          displayedDiscountIds: [
            discountId("calendar-a"),
            discountId("calendar-b"),
            discountId("customer"),
            discountId("code"),
          ],
        });
      }),
      providers
    );

    expect(result.quote.discounts.map(({ discount }) => discount.id)).toEqual([
      "calendar-a",
      "calendar-b",
      "customer",
      "code",
    ]);
    expect(result.quote.discounts.map(({ amount }) => amount.value)).toEqual([
      1000, 1800, 360, 1000,
    ]);
    expect(result.quote.discountedSubtotal.value).toBe(5840);
  });

  test("strictly appends a submitted code after freshly affirmed discounts", async () => {
    const codeQuote = mock(() =>
      Effect.succeed([percentage("code", 5000, "code")])
    );
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock(),
      CustomerDiscountProviderMock(),
      CodeDiscountProviderMock({ quote: codeQuote })
    );
    const baseQuote = discountQuoteCodec.make({
      product,
      discountableSubtotal: money(10_000),
      discounts: [
        {
          discount: percentage("calendar", 1000, "calendar").discount,
          subtotalBefore: money(10_000),
          amount: money(1000),
          subtotalAfter: money(9000),
        },
      ],
      totalDiscount: money(1000),
      discountedSubtotal: money(9000),
    });

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.applyDiscountCode({
          baseQuote,
          dotyposCustomerId: paymentInput.dotyposCustomerId,
          locale: paymentInput.locale,
          submittedCode: paymentInput.submittedCode,
        });
      }),
      providers
    );

    expect(codeQuote).toHaveBeenCalledWith({
      product,
      discountableSubtotal: money(10_000),
      dotyposCustomerId: paymentInput.dotyposCustomerId,
      locale: paymentInput.locale,
      submittedCode: paymentInput.submittedCode,
    });
    expect(result.discounts.map(({ discount }) => discount.id)).toEqual([
      "calendar",
      "code",
    ]);
    expect(result.discounts[1]?.amount).toEqual(money(4500));
    expect(result.discountedSubtotal).toEqual(money(4500));
  });

  test.each([
    [false, false, false],
    [false, false, true],
    [false, true, false],
    [false, true, true],
    [true, false, false],
    [true, false, true],
    [true, true, false],
    [true, true, true],
  ] as const)("gates submitted-code admission for calendar=%s customer=%s code=%s", async (calendarSales, customerDiscounts, discountCodes) => {
    const codeQuote = mock(() =>
      Effect.succeed([percentage("code", 1000, "code")])
    );
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock(),
      CustomerDiscountProviderMock(),
      CodeDiscountProviderMock({ quote: codeQuote })
    );
    const evaluate = mock(() =>
      Effect.succeed({ calendarSales, customerDiscounts, discountCodes })
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts
          .applyDiscountCode({
            baseQuote: emptyAffirmedAdvertisement,
            dotyposCustomerId: paymentInput.dotyposCustomerId,
            locale: paymentInput.locale,
            submittedCode: paymentInput.submittedCode,
          })
          .pipe(Effect.result);
      }),
      providers,
      DiscountReleaseGateServiceMock({ evaluate })
    );

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledWith({
      operation: "apply_discount_code",
    });
    expect(codeQuote).toHaveBeenCalledTimes(discountCodes ? 1 : 0);
    if (discountCodes) {
      expect(result._tag).toBe("Success");
    } else {
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "DiscountCodeUnavailableError",
          reason: "feature_disabled",
        },
      });
    }
  });

  test("preserves a submitted code's specific unavailable reason", async () => {
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock(),
      CustomerDiscountProviderMock(),
      CodeDiscountProviderMock({
        quote: () =>
          Effect.fail(
            new DiscountCodeUnavailableError({
              reason: "already_redeemed",
              message: "Already redeemed.",
            })
          ),
      })
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts
          .applyDiscountCode({
            baseQuote: emptyAffirmedAdvertisement,
            dotyposCustomerId: paymentInput.dotyposCustomerId,
            locale: paymentInput.locale,
            submittedCode: paymentInput.submittedCode,
          })
          .pipe(Effect.result);
      }),
      providers
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DiscountCodeUnavailableError",
        reason: "already_redeemed",
      },
    });
  });

  test("does not resolve a code when no eligible subtotal remains", async () => {
    const codeQuote = mock(() => Effect.succeed([]));
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock(),
      CustomerDiscountProviderMock(),
      CodeDiscountProviderMock({ quote: codeQuote })
    );
    const exhaustedQuote = discountQuoteCodec.make({
      product,
      discountableSubtotal: money(10_000),
      discounts: [
        {
          discount: percentage("full", 10_000, "calendar").discount,
          subtotalBefore: money(10_000),
          amount: money(10_000),
          subtotalAfter: money(0),
        },
      ],
      totalDiscount: money(10_000),
      discountedSubtotal: money(0),
    });

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts
          .applyDiscountCode({
            baseQuote: exhaustedQuote,
            dotyposCustomerId: paymentInput.dotyposCustomerId,
            locale: paymentInput.locale,
            submittedCode: paymentInput.submittedCode,
          })
          .pipe(Effect.result);
      }),
      providers
    );

    expect(codeQuote).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DiscountCodeUnavailableError",
        reason: "no_eligible_subtotal",
      },
    });
  });

  test("rejects a code that rounds to no applied amount", async () => {
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock(),
      CustomerDiscountProviderMock(),
      CodeDiscountProviderMock({
        quote: () => Effect.succeed([percentage("code", 1, "code")]),
      })
    );
    const minimalQuote = discountQuoteCodec.make({
      product,
      discountableSubtotal: money(1),
      discounts: [],
      totalDiscount: money(0),
      discountedSubtotal: money(1),
    });

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts
          .applyDiscountCode({
            baseQuote: minimalQuote,
            dotyposCustomerId: paymentInput.dotyposCustomerId,
            locale: paymentInput.locale,
            submittedCode: paymentInput.submittedCode,
          })
          .pipe(Effect.result);
      }),
      providers
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DiscountCodeUnavailableError",
        reason: "no_eligible_subtotal",
      },
    });
  });

  test("discovers advertised discounts through Calendar only", async () => {
    const calendarQuote = mock(() =>
      Effect.succeed([percentage("calendar", 1000, "calendar")])
    );
    const customerResolve = mock(() => Effect.succeed([]));
    const codeQuote = mock(() => Effect.succeed([]));
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({ quote: calendarQuote }),
      CustomerDiscountProviderMock({ resolve: customerResolve }),
      CodeDiscountProviderMock({ quote: codeQuote })
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.discoverAdvertisedDiscounts(advertisementInput);
      }),
      providers
    );

    expect(result.discounts.map(({ discount }) => discount.id)).toEqual([
      "calendar",
    ]);
    expect(calendarQuote).toHaveBeenCalledTimes(1);
    expect(customerResolve).not.toHaveBeenCalled();
    expect(codeQuote).not.toHaveBeenCalled();
  });

  test.each([
    ["discover_advertised_discounts", "quote"],
    ["affirm_advertisement", "revalidate"],
  ] as const)("omits a failed Calendar source during %s and logs safely", async (operation, providerOperation) => {
    const failure = new DiscountProviderError({
      reason: "provider_failure",
      message: "Calendar failed.",
      cause: new Error("private provider detail"),
    });
    const logRecords: {
      readonly annotations: Record<string, unknown>;
      readonly level: string;
    }[] = [];
    const logger = Logger.make((options) => {
      logRecords.push({
        annotations: options.fiber.getRef(References.CurrentLogAnnotations),
        level: options.logLevel,
      });
    });
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({
        [providerOperation]: () => Effect.fail(failure),
      }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      CodeDiscountProviderMock({
        quote: () => Effect.succeed([]),
        revalidate: () => Effect.succeed([]),
      })
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* operation === "discover_advertised_discounts"
          ? discounts.discoverAdvertisedDiscounts(advertisementInput)
          : discounts.affirmAdvertisement({
              ...advertisementInput,
              advertisedDiscountIds: [discountId("advertised")],
            });
      }).pipe(Effect.provide(Logger.layer([logger]))),
      providers
    );

    expect(result.discounts).toEqual([]);
    expect(logRecords).toContainEqual({
      level: "Error",
      annotations: expect.objectContaining({
        discountBoundary: "resolution",
        discountProvider: "calendar",
        discountOperation: operation,
        discountErrorTag: "DiscountProviderError",
        discountErrorReason: "provider_failure",
      }),
    });
    expect(JSON.stringify(logRecords)).not.toContain("private provider detail");
  });

  test("freshly affirms only advertised Calendar discounts", async () => {
    const calendarRevalidate = mock(() =>
      Effect.succeed([
        percentage("advertised", 1000, "calendar"),
        percentage("new", 5000, "calendar"),
      ])
    );
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({ revalidate: calendarRevalidate }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      CodeDiscountProviderMock({ revalidate: () => Effect.succeed([]) })
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.affirmAdvertisement({
          ...advertisementInput,
          advertisedDiscountIds: [discountId("advertised")],
        });
      }),
      providers
    );

    expect(result.discounts.map(({ discount }) => discount.id)).toEqual([
      "advertised",
    ]);
    expect(calendarRevalidate).toHaveBeenCalledTimes(1);
  });

  test("skips Calendar affirmation when no discount was advertised", async () => {
    const calendarRevalidate = mock(() => Effect.succeed([]));
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({ revalidate: calendarRevalidate }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      CodeDiscountProviderMock({ revalidate: () => Effect.succeed([]) })
    );

    await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.affirmAdvertisement({
          ...advertisementInput,
          advertisedDiscountIds: [],
        });
      }),
      providers
    );

    expect(calendarRevalidate).not.toHaveBeenCalled();
  });

  test("quotes the identified customer after the affirmed advertisement", async () => {
    const customerResolve = mock(() =>
      Effect.succeed([percentage("customer", 500, "customer")])
    );
    const calendarQuote = mock(() => Effect.succeed([]));
    const codeQuote = mock(() => Effect.succeed([]));
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({ quote: calendarQuote }),
      CustomerDiscountProviderMock({ resolve: customerResolve }),
      CodeDiscountProviderMock({ quote: codeQuote })
    );
    const affirmedAdvertisement = affirmedDiscountAdvertisementQuoteCodec.make({
      product,
      discountableSubtotal: money(10_000),
      discounts: [
        {
          discount: percentage("calendar", 1000, "calendar").discount,
          subtotalBefore: money(10_000),
          amount: money(1000),
          subtotalAfter: money(9000),
        },
      ],
      totalDiscount: money(1000),
      discountedSubtotal: money(9000),
    });

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.applyCustomerDiscount({
          affirmedAdvertisement,
          dotyposCustomerId: paymentInput.dotyposCustomerId,
          locale: paymentInput.locale,
        });
      }),
      providers
    );

    expect(result.discounts.map(({ discount }) => discount.id)).toEqual([
      "calendar",
      "customer",
    ]);
    expect(result.discounts.map(({ amount }) => amount.value)).toEqual([
      1000, 450,
    ]);
    expect(result.discountedSubtotal.value).toBe(8550);
    expect(customerResolve).toHaveBeenCalledTimes(1);
    expect(calendarQuote).not.toHaveBeenCalled();
    expect(codeQuote).not.toHaveBeenCalled();
  });

  test.each(
    (
      [
        "discover_advertised_discounts",
        "affirm_advertisement",
        "apply_customer_discount",
        "affirm_displayed_discounts",
      ] as const
    ).flatMap((operation) =>
      [
        [false, false, false],
        [false, false, true],
        [false, true, false],
        [false, true, true],
        [true, false, false],
        [true, false, true],
        [true, true, false],
        [true, true, true],
      ].map(([calendarSales, customerDiscounts, discountCodes]) => ({
        operation,
        gates: { calendarSales, customerDiscounts, discountCodes },
      }))
    )
  )("$operation gates calendar=$gates.calendarSales customer=$gates.customerDiscounts code=$gates.discountCodes", async ({
    operation,
    gates,
  }) => {
    const calendarQuote = mock(() =>
      Effect.succeed([percentage("calendar", 1000, "calendar")])
    );
    const calendarRevalidate = mock(() =>
      Effect.succeed([percentage("calendar", 1000, "calendar")])
    );
    const customerResolve = mock(() =>
      Effect.succeed([percentage("customer", 1000, "customer")])
    );
    const codeQuote = mock(() =>
      Effect.succeed([percentage("code", 1000, "code")])
    );
    const codeRevalidate = mock(() =>
      Effect.succeed([percentage("code", 1000, "code")])
    );
    const evaluate = mock(() => Effect.succeed(gates));
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({
        quote: calendarQuote,
        revalidate: calendarRevalidate,
      }),
      CustomerDiscountProviderMock({ resolve: customerResolve }),
      CodeDiscountProviderMock({
        quote: codeQuote,
        revalidate: codeRevalidate,
      })
    );

    const appliedIds = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        if (operation === "discover_advertised_discounts") {
          const result =
            yield* discounts.discoverAdvertisedDiscounts(advertisementInput);
          return result.discounts.map(({ discount }) => discount.id);
        }
        if (operation === "affirm_advertisement") {
          const result = yield* discounts.affirmAdvertisement({
            ...advertisementInput,
            advertisedDiscountIds: [discountId("calendar")],
          });
          return result.discounts.map(({ discount }) => discount.id);
        }
        if (operation === "apply_customer_discount") {
          const result = yield* discounts.applyCustomerDiscount({
            affirmedAdvertisement: emptyAffirmedAdvertisement,
            dotyposCustomerId: paymentInput.dotyposCustomerId,
            locale: paymentInput.locale,
          });
          return result.discounts.map(({ discount }) => discount.id);
        }
        const result = yield* discounts.affirmDisplayedDiscounts({
          ...paymentInput,
          displayedDiscountIds: [
            discountId("calendar"),
            discountId("customer"),
            discountId("code"),
          ],
        });
        return result.quote.discounts.map(({ discount }) => discount.id);
      }),
      providers,
      DiscountReleaseGateServiceMock({ evaluate })
    );

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledWith({ operation });
    expect(calendarQuote).toHaveBeenCalledTimes(
      operation === "discover_advertised_discounts" && gates.calendarSales
        ? 1
        : 0
    );
    expect(calendarRevalidate).toHaveBeenCalledTimes(
      (operation === "affirm_advertisement" ||
        operation === "affirm_displayed_discounts") &&
        gates.calendarSales
        ? 1
        : 0
    );
    expect(customerResolve).toHaveBeenCalledTimes(
      (operation === "apply_customer_discount" ||
        operation === "affirm_displayed_discounts") &&
        gates.customerDiscounts
        ? 1
        : 0
    );
    expect(codeQuote).not.toHaveBeenCalled();
    expect(codeRevalidate).toHaveBeenCalledTimes(
      operation === "affirm_displayed_discounts" && gates.discountCodes ? 1 : 0
    );
    expect(appliedIds).toEqual(
      operation === "discover_advertised_discounts" ||
        operation === "affirm_advertisement"
        ? gates.calendarSales
          ? ["calendar"]
          : []
        : operation === "apply_customer_discount"
          ? gates.customerDiscounts
            ? ["customer"]
            : []
          : [
              gates.calendarSales ? "calendar" : undefined,
              gates.customerDiscounts ? "customer" : undefined,
              gates.discountCodes ? "code" : undefined,
            ].filter((id): id is string => id !== undefined)
    );
  });

  test("observes a Calendar gate disabled between advertisement and affirmation", async () => {
    const evaluate = mock(({ operation }: { operation: string }) =>
      Effect.succeed({
        calendarSales: operation === "discover_advertised_discounts",
        customerDiscounts: false,
        discountCodes: false,
      })
    );
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({
        quote: () => Effect.succeed([percentage("calendar", 1000, "calendar")]),
        revalidate: () =>
          Effect.succeed([percentage("calendar", 1000, "calendar")]),
      }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      CodeDiscountProviderMock({ revalidate: () => Effect.succeed([]) })
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        const advertisement =
          yield* discounts.discoverAdvertisedDiscounts(advertisementInput);
        const affirmation = yield* discounts.affirmAdvertisement({
          ...advertisementInput,
          advertisedDiscountIds: advertisement.discounts.map(
            ({ discount }) => discount.id
          ),
        });
        return { advertisement, affirmation };
      }),
      providers,
      DiscountReleaseGateServiceMock({ evaluate })
    );

    expect(result.advertisement.discounts).toHaveLength(1);
    expect(result.affirmation.discounts).toEqual([]);
  });

  test("fails closed without provider calls when gate evaluation fails", async () => {
    const calendarRevalidate = mock(() => Effect.succeed([]));
    const customerResolve = mock(() => Effect.succeed([]));
    const codeRevalidate = mock(() => Effect.succeed([]));
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({ revalidate: calendarRevalidate }),
      CustomerDiscountProviderMock({ resolve: customerResolve }),
      CodeDiscountProviderMock({ revalidate: codeRevalidate })
    );
    const failingFeatureFlags = WorkspaceFeatureFlagServiceMock({
      evaluateFlags: () =>
        Effect.fail(
          new PostHogFeatureFlagEvaluationError({
            message: "Evaluation failed.",
            cause: new Error("provider unavailable"),
          })
        ),
    });
    const failClosedReleaseGates = DiscountReleaseGateService.Live.pipe(
      Layer.provide(failingFeatureFlags)
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.affirmDisplayedDiscounts({
          ...paymentInput,
          displayedDiscountIds: [discountId("calendar")],
        });
      }).pipe(Effect.provide(Logger.layer([]))),
      providers,
      failClosedReleaseGates
    );

    expect(result.quote.discounts).toEqual([]);
    expect(calendarRevalidate).not.toHaveBeenCalled();
    expect(customerResolve).not.toHaveBeenCalled();
    expect(codeRevalidate).not.toHaveBeenCalled();
  });

  test("creates an opaque commitment from freshly affirmed applications", async () => {
    const storedDiscountId = Schema.decodeUnknownSync(storedDiscountIdSchema)(
      "019bfe6e-8ef0-7def-8b16-55cfbc82edb7"
    );
    const codeId = Schema.decodeUnknownSync(discountCodeIdSchema)("code-1");
    const codeCandidate: DiscountCandidate = {
      ...candidate(
        storedDiscountId,
        { kind: "percentage", basisPoints: 2000 },
        "database-discount-code"
      ),
      claim: {
        kind: "discount_code",
        codeId,
        storedDiscountId,
        dotyposCustomerId: paymentInput.dotyposCustomerId,
        product,
      },
    };
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({ revalidate: () => Effect.succeed([]) }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      CodeDiscountProviderMock({
        revalidate: () => Effect.succeed([codeCandidate]),
      })
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.affirmDisplayedDiscounts({
          ...paymentInput,
          displayedDiscountIds: [storedDiscountId],
        });
      }),
      providers
    );

    expect(result.commitment).toEqual({
      applications: [
        {
          application: result.quote.discounts[0],
          provenance: codeCandidate.provenance,
          claim: codeCandidate.claim,
        },
      ],
    });
    expect(JSON.stringify(result.quote)).not.toContain(
      "database-discount-code"
    );
    expect(JSON.stringify(result.quote)).not.toContain(codeId);
    expect(JSON.stringify(result.quote)).not.toContain(
      paymentInput.submittedCode
    );
  });

  test("omits claims for discounts that cannot apply after earlier discounts", async () => {
    const codeCandidate: DiscountCandidate = {
      ...percentage("code", 5000, "code"),
      claim: {
        kind: "discount_code",
        codeId: Schema.decodeUnknownSync(discountCodeIdSchema)("code-1"),
        storedDiscountId: Schema.decodeUnknownSync(storedDiscountIdSchema)(
          "019bfe6e-8ef0-7def-8b16-55cfbc82edb7"
        ),
        dotyposCustomerId: paymentInput.dotyposCustomerId,
        product,
      },
    };
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({
        revalidate: () =>
          Effect.succeed([percentage("full", 10_000, "calendar")]),
      }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      CodeDiscountProviderMock({
        revalidate: () => Effect.succeed([codeCandidate]),
      })
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.affirmDisplayedDiscounts({
          ...paymentInput,
          displayedDiscountIds: [discountId("full"), discountId("code")],
        });
      }),
      providers
    );

    expect(result.quote.discounts).toHaveLength(1);
    expect(result.commitment).toEqual({
      applications: [
        {
          application: result.quote.discounts[0],
          provenance: expect.objectContaining({
            providerNamespace: "calendar",
          }),
        },
      ],
    });
  });

  test("does not introduce newly available discounts during payment affirmation", async () => {
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({
        revalidate: () =>
          Effect.succeed([
            percentage("displayed", 1000, "calendar"),
            percentage("newly-available", 5000, "calendar"),
          ]),
      }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      CodeDiscountProviderMock({ revalidate: () => Effect.succeed([]) })
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.affirmDisplayedDiscounts({
          ...paymentInput,
          displayedDiscountIds: [discountId("displayed")],
        });
      }),
      providers
    );

    expect(result.quote.discounts.map(({ discount }) => discount.id)).toEqual([
      "displayed",
    ]);
  });

  test("omits a displayed discount that cannot be affirmed", async () => {
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({ revalidate: () => Effect.succeed([]) }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      CodeDiscountProviderMock({ revalidate: () => Effect.succeed([]) })
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.affirmDisplayedDiscounts({
          ...paymentInput,
          displayedDiscountIds: [discountId("missing")],
        });
      }),
      providers
    );

    expect(result.quote.discounts).toEqual([]);
    expect(result.commitment).toEqual({ applications: [] });
  });

  test("keeps successful displayed discounts when another provider fails", async () => {
    const failure = new DiscountProviderError({
      reason: "provider_failure",
      message: "Calendar failed.",
      cause: new Error("calendar unavailable"),
    });
    const logRecords: {
      readonly annotations: Record<string, unknown>;
      readonly level: string;
    }[] = [];
    const logger = Logger.make((options) => {
      logRecords.push({
        annotations: options.fiber.getRef(References.CurrentLogAnnotations),
        level: options.logLevel,
      });
    });
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({ revalidate: () => Effect.fail(failure) }),
      CustomerDiscountProviderMock({
        resolve: () =>
          Effect.succeed([percentage("customer", 1000, "customer")]),
      }),
      CodeDiscountProviderMock({
        revalidate: () => Effect.succeed([percentage("code", 2000, "code")]),
      })
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.affirmDisplayedDiscounts({
          ...paymentInput,
          displayedDiscountIds: [
            discountId("calendar"),
            discountId("customer"),
            discountId("code"),
          ],
        });
      }).pipe(Effect.provide(Logger.layer([logger]))),
      providers
    );

    expect(result.quote.discounts.map(({ discount }) => discount.id)).toEqual([
      "customer",
      "code",
    ]);
    expect(logRecords).toContainEqual({
      level: "Error",
      annotations: expect.objectContaining({
        discountBoundary: "resolution",
        discountProvider: "calendar",
        discountOperation: "affirm_displayed_discounts",
        discountErrorTag: "DiscountProviderError",
        discountErrorReason: "provider_failure",
      }),
    });
    expect(JSON.stringify(logRecords)).not.toContain("customer-1");
    expect(JSON.stringify(logRecords)).not.toContain("SAVE20");
  });

  test.each([
    ["defect", Effect.die("provider bug")],
    ["interruption", Effect.interrupt],
  ] as const)("does not recover a provider %s", async (_label, failureEffect) => {
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({ revalidate: () => failureEffect }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      CodeDiscountProviderMock({ revalidate: () => Effect.succeed([]) })
    );

    const exit = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.affirmDisplayedDiscounts({
          ...paymentInput,
          displayedDiscountIds: [discountId("calendar")],
        });
      }).pipe(Effect.exit),
      providers
    );

    expect(exit._tag).toBe("Failure");
  });
});
