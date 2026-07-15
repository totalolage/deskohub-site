import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { type DotyposService, ExternalAPIError } from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { Effect } from "effect";
import { calculateDiscounts } from "./calculator";
import { CustomerDiscountProvider } from "./customer-discount-provider.service";

const input = {
  dotyposCustomerId: "customer-id",
  locale: "en-US",
  product: { kind: "cowork", tier: "basic" },
} as const;

const group = (discountPercent: unknown, discountGroupId = "group-id") => ({
  discountGroupId,
  discountPercent,
});

const runWithProvider = <A, E>(
  effect: Effect.Effect<A, E, CustomerDiscountProvider>,
  getCustomerDiscountGroup: typeof DotyposService.Service.getCustomerDiscountGroup
) =>
  effect.pipe(
    Effect.provide(CustomerDiscountProvider.Live),
    Effect.provide(DotyposServiceMock({ getCustomerDiscountGroup })),
    Effect.runPromise
  );

const quote = (overrides: Partial<typeof input> = {}) =>
  Effect.gen(function* () {
    const provider = yield* CustomerDiscountProvider;
    return yield* provider.quote({ ...input, ...overrides });
  });

describe("CustomerDiscountProvider", () => {
  test("returns no candidate when the customer has no discount group", async () => {
    const result = await runWithProvider(
      quote(),
      mock(() => Effect.succeed(undefined))
    );

    expect(result).toEqual([]);
  });

  test.each([
    [10, 1000],
    ["12.5", 1250],
    ["12.34", 1234],
    [0.07, 7],
    ["100.000", 10_000],
  ] as const)("converts an exact percentage %p to %i basis points", async (discountPercent, basisPoints) => {
    const result = await runWithProvider(
      quote(),
      mock(() => Effect.succeed(group(discountPercent)))
    );

    expect(result[0]?.discount.adjustment).toEqual({
      kind: "percentage",
      basisPoints,
    });
  });

  test.each([
    0,
    -1,
    101,
    "not-a-percentage",
    null,
    undefined,
    "12.345",
  ])("fails closed for malformed percentage %p", async (discountPercent) => {
    const error = await runWithProvider(
      quote().pipe(Effect.flip),
      mock(() => Effect.succeed(group(discountPercent)))
    );

    expect(error).toMatchObject({
      reason: "malformed_configuration",
      cause: {
        _tag: "CustomerDiscountConfigurationError",
        discountGroupId: "group-id",
        discountPercent,
      },
    });
  });

  test("preserves Dotypos failures as provider failures", async () => {
    const cause = new ExternalAPIError({
      service: "Dotypos",
      operation: "getDiscountGroup",
      statusCode: 503,
      message: "Unavailable",
    });
    const error = await runWithProvider(
      quote().pipe(Effect.flip),
      mock(() => Effect.fail(cause))
    );

    expect(error).toMatchObject({
      reason: "provider_failure",
      cause,
    });
  });

  test("uses a localized generic label and keeps provenance private", async () => {
    const getCustomerDiscountGroup = mock(() => Effect.succeed(group("50")));
    const result = await runWithProvider(
      Effect.gen(function* () {
        const provider = yield* CustomerDiscountProvider;
        return yield* Effect.all([
          provider.quote(input),
          provider.quote({ ...input, locale: "cs-CZ" }),
        ]);
      }),
      getCustomerDiscountGroup
    );

    expect(result[0][0]?.discount.label).toBe("Customer discount");
    expect(result[1][0]?.discount.label).toBe("Zákaznická sleva");
    expect(result[0][0]?.discount).not.toHaveProperty("expiresAt");
    expect(result[0][0]?.discount).not.toHaveProperty("countdownStartsAt");
    expect(JSON.stringify(result[0][0]?.discount)).not.toContain("group-id");
    expect(JSON.stringify(result[0][0]?.discount)).not.toContain("customer-id");
    expect(result[0][0]?.provenance.details).toEqual({
      discountGroupId: "group-id",
      dotyposCustomerId: "customer-id",
    });
  });

  test("derives stable opaque IDs and revalidates current group state", async () => {
    let call = 0;
    const getCustomerDiscountGroup = mock(() => {
      call += 1;
      return Effect.succeed(
        call === 1 ? group(10, "first-group") : group(20, "second-group")
      );
    });
    const result = await runWithProvider(
      Effect.gen(function* () {
        const provider = yield* CustomerDiscountProvider;
        const quoted = yield* provider.quote(input);
        const revalidated = yield* provider.revalidate(input);
        const repeated = yield* provider.revalidate(input);
        return { quoted, revalidated, repeated };
      }),
      getCustomerDiscountGroup
    );

    expect(getCustomerDiscountGroup).toHaveBeenCalledTimes(3);
    expect(result.quoted[0]?.discount.id).not.toBe(
      result.revalidated[0]?.discount.id
    );
    expect(result.revalidated[0]?.discount.id).toBe(
      result.repeated[0]?.discount.id
    );
    expect(result.revalidated[0]?.discount.adjustment).toEqual({
      kind: "percentage",
      basisPoints: 2000,
    });
  });

  test("discounts only the cowork subtotal and leaves paid coffee outside", async () => {
    const candidates = await runWithProvider(
      quote(),
      mock(() => Effect.succeed(group(50)))
    );
    const result = await Effect.runPromise(
      calculateDiscounts({
        product: input.product,
        discountableSubtotal: {
          value: 35_000,
          exponent: 2,
          currency: "CZK",
        },
        candidates,
      })
    );

    expect(result.quote.discountedSubtotal.value + 5000).toBe(22_500);
  });
});
