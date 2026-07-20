import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { Deferred, Effect, Layer, Logger, References, Schema } from "effect";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import type { WorkspaceCoworkProductIdentity } from "@/features/reservation/cowork-reservation-product";
import { CalendarDiscountProviderMock } from "./calendar-discount-provider.service.mock";
import { CodeDiscountProviderMock } from "./code-discount-provider.service.mock";
import {
  canonicalDiscountCodeSchema,
  type Discount,
  type DiscountQuoteInput,
  discountIdSchema,
} from "./contracts";
import { CustomerDiscountProviderMock } from "./customer-discount-provider.service.mock";
import { DiscountService } from "./discount.service";
import {
  DiscountReleaseGateEvaluator,
  DiscountReleaseGateService,
} from "./discount-release-gate.service";
import { DiscountReleaseGateServiceMock } from "./discount-release-gate.service.mock";
import { DiscountProviderError } from "./errors";
import {
  discountCodeIdSchema,
  storedDiscountIdSchema,
} from "./persistence-contracts";
import type { DiscountCandidate } from "./provider";

const product = {
  kind: "cowork",
  tier: "basic",
} satisfies WorkspaceCoworkProductIdentity;

const money = (value: number): WorkspaceMoney => ({
  value,
  exponent: 2,
  currency: "CZK",
});

const input: DiscountQuoteInput = {
  product,
  discountableSubtotal: money(10_000),
  reservationDate: "2026-07-20",
  dotyposCustomerId: "customer-1",
  locale: "en-US",
  submittedCode: Schema.decodeUnknownSync(canonicalDiscountCodeSchema)(
    "SAVE20"
  ),
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
    Effect.provide(DiscountService.Live),
    Effect.provide(providers),
    Effect.provide(releaseGates),
    Effect.runPromise
  );

describe("DiscountService", () => {
  test.each([
    "quote",
    "affirm",
  ] as const)("starts providers in parallel for %s", async (operation) => {
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
        quote: () => waitForEveryProvider("calendar"),
        revalidate: () => waitForEveryProvider("calendar"),
      }),
      CustomerDiscountProviderMock({
        resolve: () => waitForEveryProvider("customer"),
      }),
      CodeDiscountProviderMock({
        quote: () => waitForEveryProvider("code"),
        revalidate: () => waitForEveryProvider("code"),
      })
    );

    await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* operation === "quote"
          ? discounts.quote(input)
          : discounts.affirm({ ...input, acceptedDiscountIds: [] });
      }).pipe(Effect.timeout("1 second")),
      providers
    );

    expect(startedProviders.toSorted()).toEqual([
      "calendar",
      "code",
      "customer",
    ]);
  });

  test("applies provider candidates in calendar, customer, and code order", async () => {
    const calendarQuote = mock(() =>
      Effect.succeed([
        percentage("calendar-a", 1000, "calendar"),
        percentage("calendar-b", 2000, "calendar"),
      ])
    );
    const customerResolve = mock(() =>
      Effect.succeed([percentage("customer", 500, "customer")])
    );
    const codeQuote = mock(() =>
      Effect.succeed([
        candidate("code", { kind: "fixed", amount: money(1000) }, "code"),
      ])
    );
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({ quote: calendarQuote }),
      CustomerDiscountProviderMock({ resolve: customerResolve }),
      CodeDiscountProviderMock({ quote: codeQuote })
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.quote(input);
      }),
      providers
    );

    expect(calendarQuote).toHaveBeenCalledWith(input);
    expect(customerResolve).toHaveBeenCalledWith(
      expect.objectContaining(input)
    );
    expect(codeQuote).toHaveBeenCalledWith(expect.objectContaining(input));
    expect(result.discounts.map(({ discount }) => discount.id)).toEqual([
      "calendar-a",
      "calendar-b",
      "customer",
      "code",
    ]);
    expect(result.discounts.map(({ amount }) => amount.value)).toEqual([
      1000, 1800, 360, 1000,
    ]);
    expect(result.discountedSubtotal.value).toBe(5840);
  });

  test.each(
    (["quote", "affirm"] as const).flatMap((operation) =>
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
    const evaluateGates = mock(() => Effect.succeed(gates));
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

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* operation === "quote"
          ? discounts.quote(input)
          : discounts
              .affirm({
                ...input,
                acceptedDiscountIds: [
                  discountId("calendar"),
                  discountId("customer"),
                  discountId("code"),
                ],
              })
              .pipe(Effect.map(({ quote }) => quote));
      }),
      providers,
      DiscountReleaseGateServiceMock({ evaluate: evaluateGates })
    );

    expect(evaluateGates).toHaveBeenCalledTimes(1);
    expect(evaluateGates).toHaveBeenCalledWith({ operation });
    expect(calendarQuote).toHaveBeenCalledTimes(
      operation === "quote" && gates.calendarSales ? 1 : 0
    );
    expect(calendarRevalidate).toHaveBeenCalledTimes(
      operation === "affirm" && gates.calendarSales ? 1 : 0
    );
    expect(customerResolve).toHaveBeenCalledTimes(
      gates.customerDiscounts ? 1 : 0
    );
    expect(codeQuote).toHaveBeenCalledTimes(
      operation === "quote" && gates.discountCodes ? 1 : 0
    );
    expect(codeRevalidate).toHaveBeenCalledTimes(
      operation === "affirm" && gates.discountCodes ? 1 : 0
    );
    expect(result.discounts.map(({ discount }) => discount.id)).toEqual(
      [
        gates.calendarSales ? "calendar" : undefined,
        gates.customerDiscounts ? "customer" : undefined,
        gates.discountCodes ? "code" : undefined,
      ].filter((id): id is string => id !== undefined)
    );
  });

  test("observes a release gate being disabled between quote and affirmation", async () => {
    const evaluateGates = mock(({ operation }: { operation: string }) =>
      Effect.succeed({
        calendarSales: operation === "quote",
        customerDiscounts: false,
        discountCodes: false,
      })
    );
    const calendarQuote = mock(() =>
      Effect.succeed([percentage("calendar", 1000, "calendar")])
    );
    const calendarRevalidate = mock(() =>
      Effect.succeed([percentage("calendar", 1000, "calendar")])
    );
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({
        quote: calendarQuote,
        revalidate: calendarRevalidate,
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
        const quote = yield* discounts.quote(input);
        const affirmation = yield* discounts.affirm({
          ...input,
          acceptedDiscountIds: quote.discounts.map(
            ({ discount }) => discount.id
          ),
        });
        return { quote, affirmation };
      }),
      providers,
      DiscountReleaseGateServiceMock({ evaluate: evaluateGates })
    );

    expect(result.quote.discounts).toHaveLength(1);
    expect(result.affirmation.quote.discounts).toEqual([]);
    expect(calendarQuote).toHaveBeenCalledTimes(1);
    expect(calendarRevalidate).not.toHaveBeenCalled();
  });

  test("continues undiscounted without provider calls when gate evaluation fails", async () => {
    const calendarQuote = mock(() => Effect.succeed([]));
    const customerResolve = mock(() => Effect.succeed([]));
    const codeQuote = mock(() => Effect.succeed([]));
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({ quote: calendarQuote }),
      CustomerDiscountProviderMock({ resolve: customerResolve }),
      CodeDiscountProviderMock({ quote: codeQuote })
    );
    const failingEvaluator = DiscountReleaseGateEvaluator.from({
      evaluate: () =>
        Effect.fail(
          new PostHogFeatureFlagEvaluationError({
            message: "Evaluation failed.",
            cause: new Error("provider unavailable"),
          })
        ),
    });
    const failClosedReleaseGates = DiscountReleaseGateService.Live.pipe(
      Layer.provide(failingEvaluator)
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.quote(input);
      }).pipe(Effect.provide(Logger.layer([]))),
      providers,
      failClosedReleaseGates
    );

    expect(result.discounts).toEqual([]);
    expect(result.discountedSubtotal).toEqual(input.discountableSubtotal);
    expect(calendarQuote).not.toHaveBeenCalled();
    expect(customerResolve).not.toHaveBeenCalled();
    expect(codeQuote).not.toHaveBeenCalled();
  });

  test("affirms accepted discounts with fresh provider data and creates an opaque commitment", async () => {
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
        dotyposCustomerId: input.dotyposCustomerId,
        product,
      },
    };
    const calendarQuote = mock(() => Effect.die("quote must not be used"));
    const calendarRevalidate = mock(() => Effect.succeed([]));
    const customerResolve = mock(() => Effect.succeed([]));
    const codeQuote = mock(() => Effect.die("quote must not be used"));
    const codeRevalidate = mock(() => Effect.succeed([codeCandidate]));
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

    const affirmationInput = {
      ...input,
      acceptedDiscountIds: [storedDiscountId],
    };
    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.affirm(affirmationInput);
      }),
      providers
    );
    expect(calendarRevalidate).toHaveBeenCalledWith(affirmationInput);
    expect(customerResolve).toHaveBeenCalledWith(
      expect.objectContaining(affirmationInput)
    );
    expect(codeRevalidate).toHaveBeenCalledWith(
      expect.objectContaining(affirmationInput)
    );
    expect(calendarQuote).not.toHaveBeenCalled();
    expect(codeQuote).not.toHaveBeenCalled();
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
    expect(JSON.stringify(result.quote)).not.toContain(input.submittedCode);
  });

  test("omits unapplied code claims from the commitment", async () => {
    const codeCandidate: DiscountCandidate = {
      ...percentage("code", 5000, "code"),
      claim: {
        kind: "discount_code",
        codeId: Schema.decodeUnknownSync(discountCodeIdSchema)("code-1"),
        storedDiscountId: Schema.decodeUnknownSync(storedDiscountIdSchema)(
          "019bfe6e-8ef0-7def-8b16-55cfbc82edb7"
        ),
        dotyposCustomerId: input.dotyposCustomerId,
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
        return yield* discounts.affirm({
          ...input,
          acceptedDiscountIds: [discountId("full"), discountId("code")],
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

  test("does not introduce newly available discounts during affirmation", async () => {
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({
        revalidate: () =>
          Effect.succeed([
            percentage("accepted", 1000, "calendar"),
            percentage("newly-available", 5000, "calendar"),
          ]),
      }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      CodeDiscountProviderMock({ revalidate: () => Effect.succeed([]) })
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.affirm({
          ...input,
          acceptedDiscountIds: [discountId("accepted")],
        });
      }),
      providers
    );

    expect(result.quote.discounts.map(({ discount }) => discount.id)).toEqual([
      "accepted",
    ]);
  });

  test("omits an accepted discount that cannot be affirmed", async () => {
    const failure = new DiscountProviderError({
      reason: "provider_failure",
      message: "Calendar failed.",
    });
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({
        revalidate: () => Effect.fail(failure),
      }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      CodeDiscountProviderMock({ revalidate: () => Effect.succeed([]) })
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.affirm({
          ...input,
          acceptedDiscountIds: [discountId("accepted")],
        });
      }),
      providers
    );

    expect(result.quote.discounts).toEqual([]);
    expect(result.commitment).toEqual({ applications: [] });
  });

  test("keeps successful provider discounts when another provider fails", async () => {
    const cause = new Error("calendar unavailable");
    const failure = new DiscountProviderError({
      reason: "provider_failure",
      message: "Calendar failed.",
      cause,
    });
    const customerResolve = mock(() =>
      Effect.succeed([percentage("customer", 1000, "customer")])
    );
    const codeQuote = mock(() =>
      Effect.succeed([percentage("code", 2000, "code")])
    );
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
      CalendarDiscountProviderMock({ quote: () => Effect.fail(failure) }),
      CustomerDiscountProviderMock({ resolve: customerResolve }),
      CodeDiscountProviderMock({ quote: codeQuote })
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.quote(input);
      }).pipe(Effect.provide(Logger.layer([logger]))),
      providers
    );

    expect(result.discounts.map(({ discount }) => discount.id)).toEqual([
      "customer",
      "code",
    ]);
    expect(customerResolve).toHaveBeenCalledWith(
      expect.objectContaining(input)
    );
    expect(codeQuote).toHaveBeenCalledWith(expect.objectContaining(input));
    expect(logRecords).toContainEqual({
      level: "Error",
      annotations: expect.objectContaining({
        discountBoundary: "resolution",
        discountProvider: "calendar",
        discountOperation: "quote",
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
      CalendarDiscountProviderMock({ quote: () => failureEffect }),
      CustomerDiscountProviderMock({ resolve: () => Effect.succeed([]) }),
      CodeDiscountProviderMock({ quote: () => Effect.succeed([]) })
    );

    const exit = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.quote(input);
      }).pipe(Effect.exit),
      providers
    );

    expect(exit._tag).toBe("Failure");
  });
});
