import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { Deferred, Effect, Layer, Schema } from "effect";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import { CalendarDiscountProviderMock } from "./calendar-discount-provider.service.mock";
import { CodeDiscountProviderMock } from "./code-discount-provider.service.mock";
import {
  canonicalDiscountCodeSchema,
  type Discount,
  type DiscountProductIdentity,
  type DiscountQuoteInput,
  discountIdSchema,
} from "./contracts";
import { CustomerDiscountProviderMock } from "./customer-discount-provider.service.mock";
import { DiscountService } from "./discount.service";
import { DiscountProviderError } from "./errors";
import {
  discountCodeIdSchema,
  storedDiscountIdSchema,
} from "./persistence-contracts";
import type { DiscountCandidate } from "./provider";

const product = {
  kind: "cowork",
  tier: "basic",
} satisfies DiscountProductIdentity;

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
  >
) =>
  effect.pipe(
    Effect.provide(DiscountService.Live),
    Effect.provide(providers),
    Effect.runPromise
  );

describe("DiscountService", () => {
  test.each([
    "quote",
    "revalidate",
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
        return yield* discounts[operation](input);
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

  test("revalidates fresh provider data and creates an opaque commitment", async () => {
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

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.revalidate(input);
      }),
      providers
    );
    expect(calendarRevalidate).toHaveBeenCalledWith(input);
    expect(customerResolve).toHaveBeenCalledWith(
      expect.objectContaining(input)
    );
    expect(codeRevalidate).toHaveBeenCalledWith(expect.objectContaining(input));
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
        return yield* discounts.revalidate(input);
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

  test("preserves provider errors while resolving concurrently", async () => {
    const cause = new Error("calendar unavailable");
    const failure = new DiscountProviderError({
      reason: "provider_failure",
      message: "Calendar failed.",
      cause,
    });
    const customerResolve = mock(() => Effect.succeed([]));
    const codeQuote = mock(() => Effect.succeed([]));
    const providers = Layer.mergeAll(
      CalendarDiscountProviderMock({ quote: () => Effect.fail(failure) }),
      CustomerDiscountProviderMock({ resolve: customerResolve }),
      CodeDiscountProviderMock({ quote: codeQuote })
    );

    const result = await runWithProviders(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* Effect.flip(discounts.quote(input));
      }),
      providers
    );

    expect(result).toBe(failure);
    expect(result.cause).toBe(cause);
    expect(customerResolve).toHaveBeenCalledWith(
      expect.objectContaining(input)
    );
    expect(codeQuote).toHaveBeenCalledWith(expect.objectContaining(input));
  });
});
