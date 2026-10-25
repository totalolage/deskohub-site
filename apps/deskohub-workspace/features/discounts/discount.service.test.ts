import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import {
  type Context,
  Deferred,
  Effect,
  Layer,
  Logger,
  References,
  Schema,
} from "effect";
import type { WorkspaceProductIdentity } from "@/features/checkout/product-identity";
import { WorkspaceFeatureFlagServiceMock } from "@/features/feature-flags/backend/workspace-feature-flag.service.mock";
import type { ReferralService as ReferralServiceTag } from "@/features/referrals";
import {
  getReferralInvitationDiscountId,
  getReferralReferrerDiscountId,
} from "@/features/referrals/discount-identifiers";
import {
  ReferralServiceMock,
  WithheldReferralService,
} from "@/features/referrals/referral.service.mock";
import { CalendarDiscountProviderMock } from "./calendar-discount-provider.service.mock";
import { getDiscountCommitmentPayload } from "./commitment";
import { PromotionCodeProviderMock } from "./promotion-code-provider.service.mock";

type LogAnnotations = Context.Service.Shape<
  typeof References.CurrentLogAnnotations
>;

import type { Money } from "@/shared/money/money";
import {
  type ActiveSale,
  affirmedDiscountAdvertisementQuoteCodec,
  canonicalPromotionCodeSchema,
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
import {
  DiscountAffirmationUnavailableError,
  DiscountProviderError,
  PromotionCodeUnavailableError,
} from "./errors";
import {
  discountCodeIdSchema,
  promotionCodeIdSchema,
  storedDiscountIdSchema,
  voucherIdSchema,
} from "./persistence-contracts";
import type {
  DiscountCandidate,
  DiscountCandidateResolution,
} from "./provider";

const product = {
  kind: "cowork",
  tier: "basic",
} satisfies WorkspaceProductIdentity;

const money = (value: number): Money => ({
  value,
  exponent: 2,
  currency: "CZK",
});

const advertisementInput: DiscountAdvertisementInput = {
  product,
  discountableSubtotal: money(10_000),
  lastServiceDate: "2026-07-20",
  bookedAt: Temporal.Instant.from("2026-07-20T10:00:00Z"),
  locale: "en-US",
};

const paymentInput: DisplayedDiscountAffirmationInput = {
  ...advertisementInput,
  dotyposCustomerId: "customer-1",
  submittedCode: Schema.decodeUnknownSync(canonicalPromotionCodeSchema)(
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

/** What a Calendar affirmation resolves; complete unless stated otherwise. */
const calendarResolution = (
  candidates: readonly DiscountCandidate[],
  complete = true
): DiscountCandidateResolution => ({ candidates, complete });

const activeSale: ActiveSale = {
  discount: {
    id: discountId("active-sale"),
    label: "Summer focus",
    adjustment: { kind: "percentage", basisPoints: 2000 },
  },
  products: [{ kind: "cowork" }],
};

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
    | import("./promotion-code-provider.service").PromotionCodeProvider
  >,
  releaseGates: Layer.Layer<
    import("./discount-release-gate.service").DiscountReleaseGateService
  > = allReleaseGatesEnabled,
  referralService: Layer.Layer<ReferralServiceTag> = ReferralServiceMock()
) =>
  effect.pipe(
    Effect.provide(
      DiscountService.Default.pipe(
        Layer.provide(Layer.mergeAll(providers, releaseGates, referralService))
      )
    ),
    Effect.runPromise
  );

describe("DiscountService", () => {
  test.each([true, false])(
    "discovers active sales when the Calendar gate is %s",
    async (calendarSales) => {
      const discoverActiveSales = mock(() =>
        Effect.succeed({ activeSales: [activeSale], complete: true })
      );
      const evaluate = mock(() =>
        Effect.succeed({
          calendarSales,
          customerDiscounts: true,
          discountCodes: true,
        })
      );
      const providers = Layer.mergeAll(
        CalendarDiscountProviderMock({ discoverActiveSales }),
        CustomerDiscountProviderMock(),
        PromotionCodeProviderMock()
      );

      const result = await runWithProviders(
        Effect.gen(function* () {
          const discounts = yield* DiscountService;
          return yield* discounts.discoverActiveSales({
            locale: "en-US",
          });
        }),
        providers,
        DiscountReleaseGateServiceMock({ evaluate })
      );

      expect(result).toEqual(calendarSales ? [activeSale] : []);
      expect(evaluate).toHaveBeenCalledWith({
        operation: "discover_active_sales",
      });
      expect(discoverActiveSales).toHaveBeenCalledTimes(calendarSales ? 1 : 0);
    }
  );

  test("recovers active-sale provider failures without exposing their cause", async () => {
    const logRecords: {
      readonly annotations: LogAnnotations;
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
        discoverActiveSales: () =>
          Effect.fail(
            new DiscountProviderError({
              reason: "provider_failure",
              message: "Calendar failed.",
              cause: new Error("private provider detail"),
            })
          ),
      }),
      CustomerDiscountProviderMock(),
      PromotionCodeProviderMock()
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.discoverActiveSales({
          locale: "en-US",
        });
      }).pipe(Effect.provide(Logger.layer([logger]))),
      providers
    );

    expect(result).toEqual([]);
    expect(logRecords).toContainEqual({
      level: "Error",
      annotations: expect.objectContaining({
        discountBoundary: "resolution",
        discountProvider: "calendar",
        discountOperation: "discover_active_sales",
        discountErrorTag: "DiscountProviderError",
        discountErrorReason: "provider_failure",
      }),
    });
    expect(JSON.stringify(logRecords)).not.toContain("private provider detail");
  });

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
        revalidate: () =>
          waitForEveryProvider("calendar").pipe(Effect.map(calendarResolution)),
      }),
      CustomerDiscountProviderMock({
        resolve: () => waitForEveryProvider("customer"),
      }),
      PromotionCodeProviderMock({
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
          Effect.succeed(
            calendarResolution([
              percentage("calendar-a", 1000, "calendar"),
              percentage("calendar-b", 2000, "calendar"),
            ])
          ),
      }),
      CustomerDiscountProviderMock({
        resolve: () =>
          Effect.succeed([percentage("customer", 500, "customer")]),
      }),
      PromotionCodeProviderMock({
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
    const codeRevalidate = mock(() =>
      Effect.succeed([percentage("code", 5000, "code")])
    );
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock(),
      CustomerDiscountProviderMock(),
      PromotionCodeProviderMock({ revalidate: codeRevalidate })
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

    expect(codeRevalidate).toHaveBeenCalledWith({
      product,
      discountableSubtotal: money(10_000),
      dotyposCustomerId: paymentInput.dotyposCustomerId,
      locale: paymentInput.locale,
      submittedCode: paymentInput.submittedCode,
    });
    expect(result.quote.discounts.map(({ discount }) => discount.id)).toEqual([
      "calendar",
      "code",
    ]);
    expect(result.application).toEqual(result.quote.discounts[1]);
    expect(result.application.amount).toEqual(money(4500));
    expect(result.quote.discountedSubtotal).toEqual(money(4500));
  });

  test.each([
    [false, false, true],
    [true, true, false],
  ] as const)(
    "gates submitted-code admission for calendar=%s customer=%s code=%s",
    async (calendarSales, customerDiscounts, discountCodes) => {
      const codeRevalidate = mock(() =>
        Effect.succeed([percentage("code", 1000, "code")])
      );
      const providers = Layer.mergeAll(
        CalendarDiscountProviderMock(),
        CustomerDiscountProviderMock(),
        PromotionCodeProviderMock({ revalidate: codeRevalidate })
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
      expect(codeRevalidate).toHaveBeenCalledTimes(discountCodes ? 1 : 0);
      if (discountCodes) {
        expect(result._tag).toBe("Success");
      } else {
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: {
            _tag: "PromotionCodeUnavailableError",
            reason: "feature_disabled",
          },
        });
      }
    }
  );

  test("does not resolve a code when no eligible subtotal remains", async () => {
    const codeRevalidate = mock(() => Effect.succeed([]));
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock(),
      CustomerDiscountProviderMock(),
      PromotionCodeProviderMock({ revalidate: codeRevalidate })
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

    expect(codeRevalidate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "PromotionCodeUnavailableError",
        reason: "no_eligible_subtotal",
      },
    });
  });

  test("rejects a code that rounds to no applied amount", async () => {
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock(),
      CustomerDiscountProviderMock(),
      PromotionCodeProviderMock({
        revalidate: () => Effect.succeed([percentage("code", 1, "code")]),
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
        _tag: "PromotionCodeUnavailableError",
        reason: "no_eligible_subtotal",
      },
    });
  });

  test("omits a failed Calendar source during discover_advertised_discounts and logs safely", async () => {
    const failure = new DiscountProviderError({
      reason: "provider_failure",
      message: "Calendar failed.",
      cause: new Error("private provider detail"),
    });
    const logRecords: {
      readonly annotations: LogAnnotations;
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
        discover: () => Effect.fail(failure),
      }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      PromotionCodeProviderMock({
        revalidate: () => Effect.succeed([]),
      })
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.discoverAdvertisedDiscounts(advertisementInput);
      }).pipe(Effect.provide(Logger.layer([logger]))),
      providers
    );

    expect(result.quote.discounts).toEqual([]);
    expect(result.complete).toBeFalse();
    expect(logRecords).toContainEqual({
      level: "Error",
      annotations: expect.objectContaining({
        discountBoundary: "resolution",
        discountProvider: "calendar",
        discountOperation: "discover_advertised_discounts",
        discountErrorTag: "DiscountProviderError",
        discountErrorReason: "provider_failure",
      }),
    });
    expect(JSON.stringify(logRecords)).not.toContain("private provider detail");
  });

  test("fails an advertised Calendar discount it cannot affirm and logs safely", async () => {
    const failure = new DiscountProviderError({
      reason: "provider_failure",
      message: "Calendar failed.",
      cause: new Error("private provider detail"),
    });
    const logRecords: {
      readonly annotations: LogAnnotations;
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
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      PromotionCodeProviderMock({ revalidate: () => Effect.succeed([]) })
    );

    const error = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.affirmAdvertisement({
          ...advertisementInput,
          advertisedDiscountIds: [discountId("advertised")],
        });
      }).pipe(Effect.flip, Effect.provide(Logger.layer([logger]))),
      providers
    );

    expect(error).toBeInstanceOf(DiscountAffirmationUnavailableError);
    expect(error).toMatchObject({ discountIds: ["advertised"] });
    expect(logRecords).toContainEqual({
      level: "Error",
      annotations: expect.objectContaining({
        discountBoundary: "resolution",
        discountProvider: "calendar",
        discountOperation: "affirm_advertisement",
        discountErrorTag: "DiscountProviderError",
        discountErrorReason: "provider_failure",
      }),
    });
    expect(JSON.stringify(logRecords)).not.toContain("private provider detail");
  });

  test("freshly affirms only advertised Calendar discounts", async () => {
    const calendarRevalidate = mock(() =>
      Effect.succeed(
        calendarResolution([
          percentage("advertised", 1000, "calendar"),
          percentage("new", 5000, "calendar"),
        ])
      )
    );
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({ revalidate: calendarRevalidate }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      PromotionCodeProviderMock({ revalidate: () => Effect.succeed([]) })
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

  test("quotes the identified customer after the affirmed advertisement", async () => {
    const customerResolve = mock(() =>
      Effect.succeed([percentage("customer", 500, "customer")])
    );
    const calendarDiscover = mock(() => Effect.succeed(calendarResolution([])));
    const codeRevalidate = mock(() => Effect.succeed([]));
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({ discover: calendarDiscover }),
      CustomerDiscountProviderMock({ resolve: customerResolve }),
      PromotionCodeProviderMock({ revalidate: codeRevalidate })
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
    expect(calendarDiscover).not.toHaveBeenCalled();
    expect(codeRevalidate).not.toHaveBeenCalled();
  });

  test("removes a query code that is unavailable to the identified customer", async () => {
    const codeId = discountId("query-code");
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock(),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      PromotionCodeProviderMock({ revalidate: () => Effect.succeed([]) })
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
        {
          discount: percentage("query-code", 1000, "code").discount,
          subtotalBefore: money(9000),
          amount: money(900),
          subtotalAfter: money(8100),
        },
      ],
      totalDiscount: money(1900),
      discountedSubtotal: money(8100),
    });

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.applyCustomerDiscount({
          affirmedAdvertisement,
          dotyposCustomerId: paymentInput.dotyposCustomerId,
          locale: paymentInput.locale,
          submittedCode: paymentInput.submittedCode,
          submittedCodeDiscountId: codeId,
        });
      }),
      providers
    );

    expect(result.discounts.map(({ discount }) => discount.id)).toEqual([
      "calendar",
    ]);
    expect(result.advertisedPriceChanged).toBeTrue();
    expect(result.submittedCodeDiscountId).toBeUndefined();
  });

  test("fails an advertised query code it cannot affirm", async () => {
    const codeId = discountId("query-code");
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock(),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      PromotionCodeProviderMock({
        revalidate: () =>
          Effect.fail(
            new DiscountProviderError({
              reason: "provider_failure",
              message: "Promotion codes could not be loaded.",
            })
          ),
      })
    );
    const affirmedAdvertisement = affirmedDiscountAdvertisementQuoteCodec.make({
      product,
      discountableSubtotal: money(10_000),
      discounts: [
        {
          discount: percentage("query-code", 1000, "code").discount,
          subtotalBefore: money(10_000),
          amount: money(1000),
          subtotalAfter: money(9000),
        },
      ],
      totalDiscount: money(1000),
      discountedSubtotal: money(9000),
    });

    const error = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.applyCustomerDiscount({
          affirmedAdvertisement,
          dotyposCustomerId: paymentInput.dotyposCustomerId,
          locale: paymentInput.locale,
          submittedCode: paymentInput.submittedCode,
          submittedCodeDiscountId: codeId,
        });
      }).pipe(Effect.flip),
      providers
    );

    expect(error).toMatchObject({
      _tag: "DiscountAffirmationUnavailableError",
      discountIds: ["query-code"],
    });
  });

  test("keeps a validated query code after the identified customer's discount", async () => {
    const codeId = discountId("query-code");
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock(),
      CustomerDiscountProviderMock({
        resolve: () =>
          Effect.succeed([percentage("customer", 500, "customer")]),
      }),
      PromotionCodeProviderMock({
        revalidate: () =>
          Effect.succeed([percentage("query-code", 1000, "code")]),
      })
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
        {
          discount: percentage("query-code", 1000, "code").discount,
          subtotalBefore: money(9000),
          amount: money(900),
          subtotalAfter: money(8100),
        },
      ],
      totalDiscount: money(1900),
      discountedSubtotal: money(8100),
    });

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.applyCustomerDiscount({
          affirmedAdvertisement,
          dotyposCustomerId: paymentInput.dotyposCustomerId,
          locale: paymentInput.locale,
          submittedCode: paymentInput.submittedCode,
          submittedCodeDiscountId: codeId,
        });
      }),
      providers
    );

    expect(result.discounts.map(({ discount }) => discount.id)).toEqual([
      "calendar",
      "customer",
      "query-code",
    ]);
    expect(result.discounts.map(({ amount }) => amount.value)).toEqual([
      1000, 450, 855,
    ]);
    expect(result.advertisedPriceChanged).toBeFalse();
    expect(result.submittedCodeDiscountId).toBe(codeId);
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
  )(
    "$operation gates calendar=$gates.calendarSales customer=$gates.customerDiscounts code=$gates.discountCodes",
    async ({ operation, gates }) => {
      const calendarDiscover = mock(() =>
        Effect.succeed(
          calendarResolution([percentage("calendar", 1000, "calendar")])
        )
      );
      const calendarRevalidate = mock(() =>
        Effect.succeed(
          calendarResolution([percentage("calendar", 1000, "calendar")])
        )
      );
      const customerResolve = mock(() =>
        Effect.succeed([percentage("customer", 1000, "customer")])
      );
      const codeRevalidate = mock(() =>
        Effect.succeed([percentage("code", 1000, "code")])
      );
      const evaluate = mock(() => Effect.succeed(gates));
      const providers = Layer.mergeAll(
        CalendarDiscountProviderMock({
          discover: calendarDiscover,
          revalidate: calendarRevalidate,
        }),
        CustomerDiscountProviderMock({ resolve: customerResolve }),
        PromotionCodeProviderMock({ revalidate: codeRevalidate })
      );

      const applied = await runWithProviders(
        Effect.gen(function* () {
          const discounts = yield* DiscountService;
          if (operation === "discover_advertised_discounts") {
            const result =
              yield* discounts.discoverAdvertisedDiscounts(advertisementInput);
            return {
              complete: result.complete,
              ids: result.quote.discounts.map(({ discount }) => discount.id),
            };
          }
          if (operation === "affirm_advertisement") {
            const result = yield* discounts.affirmAdvertisement({
              ...advertisementInput,
              advertisedDiscountIds: [discountId("calendar")],
            });
            return {
              complete: undefined,
              ids: result.discounts.map(({ discount }) => discount.id),
            };
          }
          if (operation === "apply_customer_discount") {
            const result = yield* discounts.applyCustomerDiscount({
              affirmedAdvertisement: emptyAffirmedAdvertisement,
              dotyposCustomerId: paymentInput.dotyposCustomerId,
              locale: paymentInput.locale,
            });
            return {
              complete: undefined,
              ids: result.discounts.map(({ discount }) => discount.id),
            };
          }
          const result = yield* discounts.affirmDisplayedDiscounts({
            ...paymentInput,
            displayedDiscountIds: [
              discountId("calendar"),
              discountId("customer"),
              discountId("code"),
            ],
          });
          return {
            complete: undefined,
            ids: result.quote.discounts.map(({ discount }) => discount.id),
          };
        }),
        providers,
        DiscountReleaseGateServiceMock({ evaluate })
      );

      expect(evaluate).toHaveBeenCalledTimes(1);
      expect(evaluate).toHaveBeenCalledWith({ operation });
      expect(calendarDiscover).toHaveBeenCalledTimes(
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
      expect(codeRevalidate).toHaveBeenCalledTimes(
        operation === "affirm_displayed_discounts" && gates.discountCodes
          ? 1
          : 0
      );
      let expectedAppliedIds = [
        gates.calendarSales ? "calendar" : undefined,
        gates.customerDiscounts ? "customer" : undefined,
        gates.discountCodes ? "code" : undefined,
      ].filter((id): id is string => id !== undefined);
      if (
        operation === "discover_advertised_discounts" ||
        operation === "affirm_advertisement"
      ) {
        expectedAppliedIds = gates.calendarSales ? ["calendar"] : [];
      } else if (operation === "apply_customer_discount") {
        expectedAppliedIds = gates.customerDiscounts ? ["customer"] : [];
      }
      expect(applied.ids).toEqual(expectedAppliedIds);
      if (operation === "discover_advertised_discounts") {
        expect(applied.complete).toBeTrue();
      }
    }
  );

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
        discover: () =>
          Effect.succeed(
            calendarResolution([percentage("calendar", 1000, "calendar")])
          ),
        revalidate: () =>
          Effect.succeed(
            calendarResolution([percentage("calendar", 1000, "calendar")])
          ),
      }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      PromotionCodeProviderMock({ revalidate: () => Effect.succeed([]) })
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        const advertisement =
          yield* discounts.discoverAdvertisedDiscounts(advertisementInput);
        const affirmation = yield* discounts.affirmAdvertisement({
          ...advertisementInput,
          advertisedDiscountIds: advertisement.quote.discounts.map(
            ({ discount }) => discount.id
          ),
        });
        return { advertisement, affirmation };
      }),
      providers,
      DiscountReleaseGateServiceMock({ evaluate })
    );

    expect(result.advertisement.quote.discounts).toHaveLength(1);
    expect(result.advertisement.complete).toBeTrue();
    expect(result.affirmation.discounts).toEqual([]);
  });

  test("fails closed without provider calls when gate evaluation fails", async () => {
    const calendarRevalidate = mock(() =>
      Effect.succeed(calendarResolution([]))
    );
    const customerResolve = mock(() => Effect.succeed([]));
    const codeRevalidate = mock(() => Effect.succeed([]));
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({ revalidate: calendarRevalidate }),
      CustomerDiscountProviderMock({ resolve: customerResolve }),
      PromotionCodeProviderMock({ revalidate: codeRevalidate })
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
    const failClosedReleaseGates = DiscountReleaseGateService.Default.pipe(
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
      CalendarDiscountProviderMock({
        revalidate: () => Effect.succeed(calendarResolution([])),
      }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      PromotionCodeProviderMock({
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

    expect(getDiscountCommitmentPayload(result.commitment)).toEqual({
      product,
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

  test("applies invitation after ordinary discounts and sizes referrer money from the remaining subtotal", async () => {
    const invitedCustomerId = paymentInput.dotyposCustomerId;
    const referrerCustomerId = "referrer-1" as typeof invitedCustomerId;
    const promotionCodeId = promotionCodeIdSchema.make("referral-promotion");
    const invitation: DiscountCandidate = {
      discount: {
        id: getReferralInvitationDiscountId(invitedCustomerId),
        label: "Invitation discount",
        adjustment: { kind: "percentage", basisPoints: 1_500 },
      },
      provenance: {
        providerNamespace: "referral-invitation",
        providerReference: promotionCodeId,
      },
      claim: {
        kind: "referral_invitation",
        invitedDotyposCustomerId: invitedCustomerId,
        referrerDotyposCustomerId: referrerCustomerId,
        promotionCodeId,
      },
    };
    const referrer: DiscountCandidate = {
      discount: {
        id: getReferralReferrerDiscountId(invitedCustomerId),
        label: "Referrer discount",
        adjustment: { kind: "fixed", amount: money(551) },
      },
      provenance: {
        providerNamespace: "referral-referrer",
        providerReference: invitedCustomerId,
      },
    };
    let referrerSubtotal: Money | undefined;
    const referralService = ReferralServiceMock({
      resolveInvitationCandidate: () => Effect.succeed(invitation),
      resolveReferrerCandidate: (input) => {
        referrerSubtotal = input.remainingSubtotal;
        return Effect.succeed(referrer);
      },
    });
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({
        discover: () =>
          Effect.succeed(
            calendarResolution([percentage("sale", 1_000, "calendar")])
          ),
      }),
      CustomerDiscountProviderMock({
        resolve: () =>
          Effect.succeed([percentage("customer", 1_000, "customer")]),
      }),
      PromotionCodeProviderMock({
        revalidate: () => Effect.succeed([percentage("code", 2_000, "code")]),
      })
    );

    const quote = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.quote({
          ...advertisementInput,
          dotyposCustomerId: invitedCustomerId,
          submittedCode: paymentInput.submittedCode,
        });
      }),
      providers,
      allReleaseGatesEnabled,
      referralService
    );

    expect(referrerSubtotal).toEqual(money(5_508));
    expect(quote.discounts.map(({ discount }) => discount.id)).toEqual([
      "sale",
      "customer",
      "code",
      getReferralInvitationDiscountId(invitedCustomerId),
      getReferralReferrerDiscountId(invitedCustomerId),
    ]);
    expect(
      quote.discounts.map(({ subtotalBefore }) => subtotalBefore.value)
    ).toEqual([10_000, 9_000, 8_100, 6_480, 5_508]);
    expect(quote.discountedSubtotal).toEqual(money(4_957));
  });

  test("prices the invitation from the checkout's carried referral code", async () => {
    const referralCode = canonicalPromotionCodeSchema.make("RFL12345");
    const invitationInputs: unknown[] = [];
    const referralService = ReferralServiceMock({
      resolveInvitationCandidate: (input) =>
        Effect.sync(() => {
          invitationInputs.push(input.referralCode);
          return undefined;
        }),
    });
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({
        discover: () => Effect.succeed(calendarResolution([])),
        revalidate: () => Effect.succeed(calendarResolution([])),
      }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      PromotionCodeProviderMock({ revalidate: () => Effect.succeed([]) })
    );

    await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        yield* discounts.quote({
          ...advertisementInput,
          dotyposCustomerId: paymentInput.dotyposCustomerId,
          referralCode,
        });
        yield* discounts.affirmDisplayedDiscounts({
          ...paymentInput,
          submittedCode: undefined,
          displayedDiscountIds: [],
          referralCode,
        });
        yield* discounts.affirmDisplayedDiscounts({
          ...paymentInput,
          submittedCode: undefined,
          displayedDiscountIds: [],
        });
      }),
      providers,
      allReleaseGatesEnabled,
      referralService
    );

    expect(invitationInputs).toEqual([referralCode, referralCode, undefined]);
  });

  test("applies referral benefits before voucher credit and keeps the voucher claim", async () => {
    const invitedCustomerId = paymentInput.dotyposCustomerId;
    const referrerCustomerId = "referrer-1" as typeof invitedCustomerId;
    const referralPromotionCodeId = promotionCodeIdSchema.make(
      "referral-before-voucher"
    );
    const voucherId = voucherIdSchema.make("voucher-credit-1");
    const voucherCandidate: DiscountCandidate = {
      discount: {
        id: discountId("voucher-credit"),
        label: "Voucher credit",
        adjustment: { kind: "fixed", amount: money(2_000) },
      },
      provenance: {
        providerNamespace: "database-voucher",
        providerReference: voucherId,
        details: { voucherId },
      },
      claim: {
        kind: "voucher",
        voucherId,
        availableAmount: money(2_000),
        dotyposCustomerId: invitedCustomerId,
      },
    };
    const invitation: DiscountCandidate = {
      discount: {
        id: getReferralInvitationDiscountId(invitedCustomerId),
        label: "Invitation discount",
        adjustment: { kind: "percentage", basisPoints: 1_500 },
      },
      provenance: {
        providerNamespace: "referral-invitation",
        providerReference: referralPromotionCodeId,
      },
      claim: {
        kind: "referral_invitation",
        invitedDotyposCustomerId: invitedCustomerId,
        referrerDotyposCustomerId: referrerCustomerId,
        promotionCodeId: referralPromotionCodeId,
      },
    };
    let referrerSubtotal: Money | undefined;
    const referralService = ReferralServiceMock({
      resolveInvitationCandidate: () => Effect.succeed(invitation),
      resolveReferrerCandidate: (input) => {
        referrerSubtotal = input.remainingSubtotal;
        const amount = money(Math.round(input.remainingSubtotal.value / 20));
        return Effect.succeed({
          discount: {
            id: getReferralReferrerDiscountId(invitedCustomerId),
            label: "Referral discount (1 eligible people)",
            adjustment: { kind: "fixed", amount },
          },
          provenance: {
            providerNamespace: "referral-referrer",
            providerReference: invitedCustomerId,
          },
        });
      },
    });
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({
        discover: () => Effect.succeed(calendarResolution([])),
        revalidate: () => Effect.succeed(calendarResolution([])),
      }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      PromotionCodeProviderMock({
        revalidate: () => Effect.succeed([voucherCandidate]),
      })
    );
    const baseQuote = discountQuoteCodec.make({
      product,
      discountableSubtotal: money(10_000),
      discounts: [],
      totalDiscount: money(0),
      discountedSubtotal: money(10_000),
    });

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.applyDiscountCode({
          baseQuote,
          dotyposCustomerId: invitedCustomerId,
          locale: paymentInput.locale,
          submittedCode: paymentInput.submittedCode,
        });
      }),
      providers,
      allReleaseGatesEnabled,
      referralService
    );

    expect(referrerSubtotal).toEqual(money(8_500));
    expect(result.quote.discounts.map(({ discount }) => discount.id)).toEqual([
      getReferralInvitationDiscountId(invitedCustomerId),
      getReferralReferrerDiscountId(invitedCustomerId),
      voucherCandidate.discount.id,
    ]);
    expect(result.quote.discounts.map(({ amount }) => amount)).toEqual([
      money(1_500),
      money(425),
      money(2_000),
    ]);
    expect(
      result.quote.discounts.map(({ subtotalBefore }) => subtotalBefore)
    ).toEqual([money(10_000), money(8_500), money(8_075)]);
    expect(result.quote.discountedSubtotal).toEqual(money(6_075));
    expect(result.application).toEqual(result.quote.discounts[2]);

    const quoted = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.quote({
          ...advertisementInput,
          dotyposCustomerId: invitedCustomerId,
          submittedCode: paymentInput.submittedCode,
        });
      }),
      providers,
      allReleaseGatesEnabled,
      referralService
    );
    expect(quoted.discounts.map(({ discount }) => discount.id)).toEqual([
      getReferralInvitationDiscountId(invitedCustomerId),
      getReferralReferrerDiscountId(invitedCustomerId),
      voucherCandidate.discount.id,
    ]);
    expect(quoted.discounts.map(({ amount }) => amount.value)).toEqual([
      1_500, 425, 2_000,
    ]);
    expect(quoted.discountedSubtotal).toEqual(money(6_075));

    const customerQuote = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.applyCustomerDiscount({
          affirmedAdvertisement: emptyAffirmedAdvertisement,
          dotyposCustomerId: invitedCustomerId,
          locale: paymentInput.locale,
          submittedCode: paymentInput.submittedCode,
          submittedCodeDiscountId: voucherCandidate.discount.id,
        });
      }),
      providers,
      allReleaseGatesEnabled,
      referralService
    );
    expect(customerQuote.discounts.map(({ discount }) => discount.id)).toEqual([
      getReferralInvitationDiscountId(invitedCustomerId),
      getReferralReferrerDiscountId(invitedCustomerId),
      voucherCandidate.discount.id,
    ]);
    expect(customerQuote.discounts.map(({ amount }) => amount.value)).toEqual([
      1_500, 425, 2_000,
    ]);
    expect(customerQuote.discountedSubtotal).toEqual(money(6_075));

    const affirmed = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.affirmDisplayedDiscounts({
          ...paymentInput,
          displayedDiscountIds: [voucherCandidate.discount.id],
        });
      }),
      providers,
      allReleaseGatesEnabled,
      referralService
    );
    const commitment = getDiscountCommitmentPayload(affirmed.commitment);
    expect(affirmed.quote.discounts.map(({ amount }) => amount.value)).toEqual([
      1_500, 425, 2_000,
    ]);
    expect(
      commitment.applications.map(({ application }) => application.amount.value)
    ).toEqual([1_500, 425, 2_000]);
    expect(
      commitment.applications.map(({ application }) => application)
    ).toEqual(affirmed.quote.discounts);
    expect(commitment.applications[2]?.claim).toEqual(voucherCandidate.claim);
  });

  test("prices no invitation or referrer benefit while referrals are withheld", async () => {
    // The real referral gate; reading any recorded referral would die.
    const invitedCustomerId = paymentInput.dotyposCustomerId;
    const referralCode = canonicalPromotionCodeSchema.make("RFL12345");
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({
        discover: () => Effect.succeed(calendarResolution([])),
        revalidate: () => Effect.succeed(calendarResolution([])),
      }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      PromotionCodeProviderMock({
        revalidate: () => Effect.succeed([percentage("code", 2_000, "code")]),
      })
    );

    const { quoted, affirmed } = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        // An invitee or referrer, with a code carried from a pay state
        // signed while the program was released.
        const quoted = yield* discounts.quote({
          ...advertisementInput,
          dotyposCustomerId: invitedCustomerId,
          submittedCode: paymentInput.submittedCode,
          referralCode,
        });
        const affirmed = yield* discounts.affirmDisplayedDiscounts({
          ...paymentInput,
          displayedDiscountIds: [
            discountId("code"),
            getReferralInvitationDiscountId(invitedCustomerId),
            getReferralReferrerDiscountId(invitedCustomerId),
          ],
          referralCode,
        });
        return { quoted, affirmed };
      }),
      providers,
      allReleaseGatesEnabled,
      WithheldReferralService
    );

    expect(quoted.discounts.map(({ discount }) => discount.id)).toEqual([
      "code",
    ]);
    expect(quoted.discountedSubtotal).toEqual(money(8_000));
    expect(affirmed.quote.discounts.map(({ discount }) => discount.id)).toEqual(
      ["code"]
    );
    expect(
      getDiscountCommitmentPayload(affirmed.commitment).applications.map(
        ({ claim }) => claim?.kind
      )
    ).not.toContain("referral_invitation");
  });

  test("does not create a zero-minor invitation application or claim", async () => {
    const invitedCustomerId = paymentInput.dotyposCustomerId;
    const promotionCodeId = promotionCodeIdSchema.make("tiny-referral");
    const invitation: DiscountCandidate = {
      discount: {
        id: getReferralInvitationDiscountId(invitedCustomerId),
        label: "Invitation discount",
        adjustment: { kind: "percentage", basisPoints: 1_500 },
      },
      provenance: {
        providerNamespace: "referral-invitation",
        providerReference: promotionCodeId,
      },
      claim: {
        kind: "referral_invitation",
        invitedDotyposCustomerId: invitedCustomerId,
        referrerDotyposCustomerId: "referrer-1" as typeof invitedCustomerId,
        promotionCodeId,
      },
    };
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({
        revalidate: () => Effect.succeed(calendarResolution([])),
      }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      PromotionCodeProviderMock({ revalidate: () => Effect.succeed([]) })
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.affirmDisplayedDiscounts({
          ...advertisementInput,
          discountableSubtotal: money(1),
          dotyposCustomerId: invitedCustomerId,
          displayedDiscountIds: [],
        });
      }),
      providers,
      allReleaseGatesEnabled,
      ReferralServiceMock({
        resolveInvitationCandidate: () => Effect.succeed(invitation),
      })
    );

    expect(result.quote.discounts).toEqual([]);
    expect(
      getDiscountCommitmentPayload(result.commitment).applications
    ).toEqual([]);
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
          Effect.succeed(
            calendarResolution([percentage("full", 10_000, "calendar")])
          ),
      }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      PromotionCodeProviderMock({
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
    expect(getDiscountCommitmentPayload(result.commitment)).toEqual({
      product,
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
          Effect.succeed(
            calendarResolution([
              percentage("displayed", 1000, "calendar"),
              percentage("newly-available", 5000, "calendar"),
            ])
          ),
      }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      PromotionCodeProviderMock({ revalidate: () => Effect.succeed([]) })
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
      CalendarDiscountProviderMock({
        revalidate: () => Effect.succeed(calendarResolution([])),
      }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      PromotionCodeProviderMock({ revalidate: () => Effect.succeed([]) })
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
    expect(getDiscountCommitmentPayload(result.commitment)).toEqual({
      product,
      applications: [],
    });
  });

  test("fails displayed discounts it cannot affirm when a provider fails", async () => {
    const failure = new DiscountProviderError({
      reason: "provider_failure",
      message: "Calendar failed.",
      cause: new Error("calendar unavailable"),
    });
    const logRecords: {
      readonly annotations: LogAnnotations;
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
      PromotionCodeProviderMock({
        revalidate: () => Effect.succeed([percentage("code", 2000, "code")]),
      })
    );

    const error = await runWithProviders(
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
      }).pipe(Effect.flip, Effect.provide(Logger.layer([logger]))),
      providers
    );

    expect(error).toBeInstanceOf(DiscountAffirmationUnavailableError);
    expect(error).toMatchObject({ discountIds: ["calendar"] });
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

  test("affirms displayed discounts that a failed provider does not own", async () => {
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({
        revalidate: () =>
          Effect.fail(
            new DiscountProviderError({
              reason: "provider_failure",
              message: "Calendar failed.",
            })
          ),
      }),
      CustomerDiscountProviderMock({
        resolve: () =>
          Effect.succeed([percentage("customer", 1000, "customer")]),
      }),
      PromotionCodeProviderMock({ revalidate: () => Effect.succeed([]) })
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.affirmDisplayedDiscounts({
          ...paymentInput,
          displayedDiscountIds: [discountId("customer")],
        });
      }),
      providers
    );

    expect(result.quote.discounts.map(({ discount }) => discount.id)).toEqual([
      "customer",
    ]);
  });

  test("fails a displayed discount missing from an incomplete Calendar resolution", async () => {
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({
        revalidate: () =>
          Effect.succeed(
            calendarResolution([percentage("other", 1000, "calendar")], false)
          ),
      }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      PromotionCodeProviderMock({ revalidate: () => Effect.succeed([]) })
    );

    const error = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.affirmDisplayedDiscounts({
          ...paymentInput,
          displayedDiscountIds: [discountId("calendar")],
        });
      }).pipe(Effect.flip),
      providers
    );

    expect(error).toMatchObject({
      _tag: "DiscountAffirmationUnavailableError",
      discountIds: ["calendar"],
    });
  });

  test("affirms a displayed discount found in an incomplete Calendar resolution", async () => {
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({
        revalidate: () =>
          Effect.succeed(
            calendarResolution(
              [percentage("calendar", 1000, "calendar")],
              false
            )
          ),
      }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      PromotionCodeProviderMock({ revalidate: () => Effect.succeed([]) })
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.affirmDisplayedDiscounts({
          ...paymentInput,
          displayedDiscountIds: [discountId("calendar")],
        });
      }),
      providers
    );

    expect(result.quote.discounts.map(({ discount }) => discount.id)).toEqual([
      "calendar",
    ]);
  });

  test("omits a displayed code that is no longer available", async () => {
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({
        revalidate: () =>
          Effect.succeed(
            calendarResolution([percentage("calendar", 1000, "calendar")])
          ),
      }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      PromotionCodeProviderMock({
        revalidate: () =>
          Effect.fail(
            new PromotionCodeUnavailableError({
              reason: "usage_limit_reached",
              message: "The code has no uses left.",
            })
          ),
      })
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.affirmDisplayedDiscounts({
          ...paymentInput,
          displayedDiscountIds: [discountId("calendar"), discountId("code")],
        });
      }),
      providers
    );

    expect(result.quote.discounts.map(({ discount }) => discount.id)).toEqual([
      "calendar",
    ]);
  });
});
