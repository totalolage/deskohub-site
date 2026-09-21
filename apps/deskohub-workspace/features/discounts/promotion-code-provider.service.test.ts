import "@/shared/testing/workspace-test-env";
import "@/shared/polyfills/temporal";
import { describe, expect, mock, test } from "bun:test";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect, Layer, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { canonicalPromotionCodeSchema } from "./contracts";
import type { DiscountDefinition } from "./discount-definition";
import {
  DiscountDefinitionNotFoundError,
  type IDiscountDefinitionRepository,
} from "./discount-definition.repository";
import { DiscountDefinitionRepositoryMock } from "./discount-definition.repository.mock";
import {
  discountCodeIdSchema,
  promotionCodeIdSchema,
  storedDiscountIdSchema,
  voucherIdSchema,
} from "./persistence-contracts";
import {
  type DiscountCodeAvailability,
  type DiscountCodeConfiguration,
  PromotionCodeConfigurationError,
  type VoucherAvailability,
  type VoucherConfiguration,
} from "./promotion-code";
import type { IPromotionCodeRepository } from "./promotion-code.repository";
import { PromotionCodeRepositoryMock } from "./promotion-code.repository.mock";
import {
  type PromotionCodePreviewInput,
  PromotionCodeProvider,
  type PromotionCodeProviderInput,
} from "./promotion-code-provider.service";

const nowInstant = Temporal.Instant.from("2026-07-15T12:00:00.000Z");
const now = nowInstant.epochMilliseconds;
const codeId = Schema.decodeUnknownSync(discountCodeIdSchema)(
  "019bfe6e-8ef0-7def-8b16-55cfbc82eda1"
);
const promotionCodeId = promotionCodeIdSchema.make(
  "019bfe6e-8ef0-7def-8b16-55cfbc82ed9"
);
const voucherId = voucherIdSchema.make("019bfe6e-8ef0-7def-8b16-55cfbc82eda3");
const secondCodeId = Schema.decodeUnknownSync(discountCodeIdSchema)(
  "019bfe6e-8ef0-7def-8b16-55cfbc82eda2"
);
const discountId = Schema.decodeUnknownSync(storedDiscountIdSchema)(
  "019bfe6e-8ef0-7def-8b16-55cfbc82edb7"
);
const canonicalCode = Schema.decodeUnknownSync(canonicalPromotionCodeSchema)(
  "SUMMER50"
);
const product = { kind: "cowork", tier: "basic" } as const;

const input: PromotionCodeProviderInput = {
  submittedCode: canonicalCode,
  dotyposCustomerId: "customer-1",
  locale: "en-US",
  product,
  discountableSubtotal: { value: 35_000, exponent: 2, currency: "CZK" },
  reservationDate: "2026-07-15",
};

const configuration = (
  overrides: Partial<DiscountCodeConfiguration> = {}
): DiscountCodeConfiguration => ({
  id: codeId,
  promotionCodeId,
  kind: "discount",
  discountId,
  enabled: true,
  validFrom: null,
  validUntil: null,
  serviceDateFrom: null,
  serviceDateUntil: null,
  maxUses: null,
  maxUsesPerCustomer: null,
  ...overrides,
});

const voucherConfiguration = (
  overrides: Partial<VoucherConfiguration> = {}
): VoucherConfiguration => ({
  id: voucherId,
  promotionCodeId,
  kind: "voucher",
  amount: { value: 10_000, exponent: 2, currency: "CZK" },
  enabled: true,
  validFrom: null,
  validUntil: null,
  ...overrides,
});

const availability = (
  overrides: Partial<DiscountCodeAvailability> = {}
): DiscountCodeAvailability => ({
  allowlistSize: 0,
  customerAllowed: false,
  activeUseCount: 0,
  customerActiveUseCount: 0,
  ...overrides,
});

const voucherAvailability = (
  overrides: Partial<VoucherAvailability> = {}
): VoucherAvailability => ({
  allowlistSize: 0,
  customerAllowed: false,
  customerHasReserved: false,
  usedValue: 0,
  ...overrides,
});

const definition = (
  overrides: Partial<DiscountDefinition> = {}
): DiscountDefinition => ({
  id: discountId,
  labels: {
    "en-US": "Summer database sale",
    "cs-CZ": "Letní databázová sleva",
  },
  adjustment: { kind: "percentage", basisPoints: 5000 },
  products: [{ kind: "cowork" }],
  ...overrides,
});

const defaultFindByCode: IPromotionCodeRepository["findByCode"] = () =>
  Effect.succeed(Option.some(configuration()));
const defaultLoadAvailability: IPromotionCodeRepository["loadDiscountCodeAvailability"] =
  () => Effect.succeed(availability());
const defaultLoadPreviewAvailability: IPromotionCodeRepository["loadDiscountCodePreviewAvailability"] =
  () => Effect.succeed({ activeUseCount: 0 });
const defaultLoadVoucherAvailability: IPromotionCodeRepository["loadVoucherAvailability"] =
  () => Effect.succeed(voucherAvailability());
const defaultLoadDefinition: IDiscountDefinitionRepository["loadById"] = () =>
  Effect.succeed(definition());

const runWithProvider = <A, E>(
  effect: Effect.Effect<A, E, PromotionCodeProvider>,
  options: {
    readonly findByCode?: IPromotionCodeRepository["findByCode"];
    readonly loadAvailability?: IPromotionCodeRepository["loadDiscountCodeAvailability"];
    readonly loadPreviewAvailability?: IPromotionCodeRepository["loadDiscountCodePreviewAvailability"];
    readonly loadVoucherAvailability?: IPromotionCodeRepository["loadVoucherAvailability"];
    readonly loadDefinition?: IDiscountDefinitionRepository["loadById"];
  } = {}
) =>
  effect.pipe(
    Effect.provide(
      Layer.mergeAll(
        PromotionCodeProvider.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              PromotionCodeRepositoryMock({
                findByCode: options.findByCode ?? defaultFindByCode,
                loadDiscountCodeAvailability:
                  options.loadAvailability ?? defaultLoadAvailability,
                loadDiscountCodePreviewAvailability:
                  options.loadPreviewAvailability ??
                  defaultLoadPreviewAvailability,
                loadVoucherAvailability:
                  options.loadVoucherAvailability ??
                  defaultLoadVoucherAvailability,
              }),
              DiscountDefinitionRepositoryMock({
                loadById: options.loadDefinition ?? defaultLoadDefinition,
              })
            )
          )
        ),
        TestClock.layer()
      )
    ),
    Effect.runPromise
  );

const resolve = (overrides: Partial<PromotionCodeProviderInput> = {}) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(now);
    const provider = yield* PromotionCodeProvider;
    return yield* provider.revalidate({ ...input, ...overrides });
  });

const previewInput: PromotionCodePreviewInput = {
  submittedCode: canonicalCode,
  locale: input.locale,
  product,
  discountableSubtotal: input.discountableSubtotal,
  reservationDate: input.reservationDate,
};

describe("PromotionCodeProvider", () => {
  test("previews an ordinary code without creating a customer claim", async () => {
    const loadPreviewAvailability = mock(defaultLoadPreviewAvailability);

    const result = await runWithProvider(
      Effect.gen(function* () {
        yield* TestClock.setTime(now);
        const provider = yield* PromotionCodeProvider;
        return yield* provider.preview(previewInput);
      }),
      { loadPreviewAvailability }
    );

    expect(loadPreviewAvailability).toHaveBeenCalledWith({
      promotionCodeId,
      codeId,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty("claim");
    expect(result[0]?.discount.label).toBe("Summer database sale");
  });

  test("returns no candidates and performs no reads when no code is submitted", async () => {
    const findByCode = mock(defaultFindByCode);
    const loadAvailability = mock(defaultLoadAvailability);
    const loadDefinition = mock(defaultLoadDefinition);

    const result = await runWithProvider(
      Effect.gen(function* () {
        const provider = yield* PromotionCodeProvider;
        return yield* provider.revalidate({
          ...input,
          submittedCode: undefined,
        });
      }),
      {
        findByCode,
        loadAvailability,
        loadDefinition,
      }
    );

    expect(result).toEqual([]);
    expect(findByCode).not.toHaveBeenCalled();
    expect(loadAvailability).not.toHaveBeenCalled();
    expect(loadDefinition).not.toHaveBeenCalled();
  });

  test("resolves a canonical code to a source-neutral candidate with a private claim", async () => {
    const findByCode = mock(defaultFindByCode);
    const loadAvailability = mock(defaultLoadAvailability);
    const validUntil = Temporal.Instant.from("2026-08-01T10:00:00.000Z");

    const result = await runWithProvider(resolve(), {
      findByCode,
      loadAvailability,
      loadDefinition: () => Effect.succeed(definition()),
    });

    expect(findByCode).toHaveBeenCalledWith({ code: canonicalCode });
    expect(loadAvailability).toHaveBeenCalledWith({
      promotionCodeId,
      codeId,
      dotyposCustomerId: "customer-1",
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      discount: {
        id: discountId,
        label: "Summer database sale",
        adjustment: { kind: "percentage", basisPoints: 5000 },
      },
      provenance: {
        providerNamespace: "database-discount-code",
        providerReference: codeId,
        details: { discountCodeId: codeId, storedDiscountId: discountId },
      },
      claim: {
        kind: "discount_code",
        codeId,
        storedDiscountId: discountId,
        dotyposCustomerId: "customer-1",
        product,
      },
    });
    expect(JSON.stringify(result[0]?.discount)).not.toContain(canonicalCode);
    expect(JSON.stringify(result[0]?.discount)).not.toContain(codeId);

    const timedResult = await runWithProvider(resolve(), {
      findByCode: () =>
        Effect.succeed(Option.some(configuration({ validUntil }))),
    });

    expect(timedResult[0]?.discount.expiresAt).toBe("2026-08-01T10:00:00.000Z");
    expect(timedResult[0]?.discount.countdownStartsAt).toBe(
      "2026-08-01T09:00:00.000Z"
    );
  });

  test.each([
    ["en-US", "Summer database sale"],
    ["cs-CZ", "Letní databázová sleva"],
  ] as const)("resolves the stored label for %s", async (locale, label) => {
    const result = await runWithProvider(resolve({ locale }));

    expect(result[0]?.discount.label).toBe(label);
  });

  test("supports fixed adjustments and omits timing without an end", async () => {
    const result = await runWithProvider(resolve(), {
      loadDefinition: () =>
        Effect.succeed(
          definition({
            adjustment: {
              kind: "fixed",
              amount: { value: 10_000, exponent: 2, currency: "CZK" },
            },
          })
        ),
    });

    expect(result[0]?.discount.adjustment).toEqual({
      kind: "fixed",
      amount: { value: 10_000, exponent: 2, currency: "CZK" },
    });
    expect(result[0]?.discount).not.toHaveProperty("expiresAt");
    expect(result[0]?.discount).not.toHaveProperty("countdownStartsAt");
  });

  test("spends only the remaining voucher credit without loading a discount", async () => {
    const loadDefinition = mock(defaultLoadDefinition);
    const result = await runWithProvider(resolve(), {
      findByCode: () => Effect.succeed(Option.some(voucherConfiguration())),
      loadVoucherAvailability: () =>
        Effect.succeed(voucherAvailability({ usedValue: 4_000 })),
      loadDefinition,
    });

    expect(result[0]).toMatchObject({
      discount: {
        label: "Voucher",
        adjustment: {
          kind: "fixed",
          amount: { value: 6_000, exponent: 2, currency: "CZK" },
        },
      },
      provenance: {
        providerNamespace: "database-voucher",
        providerReference: voucherId,
        details: { voucherId },
      },
      claim: {
        kind: "voucher",
        voucherId,
        availableAmount: { value: 6_000, exponent: 2, currency: "CZK" },
      },
    });
    expect(result[0]?.discount.id).not.toBe(voucherId);
    expect(loadDefinition).not.toHaveBeenCalled();
  });

  test("rejects an exhausted voucher", async () => {
    const result = await runWithProvider(resolve().pipe(Effect.result), {
      findByCode: () => Effect.succeed(Option.some(voucherConfiguration())),
      loadVoucherAvailability: () =>
        Effect.succeed(voucherAvailability({ usedValue: 10_000 })),
    });

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { reason: "usage_limit_reached", codeId: voucherId },
    });
  });

  test.each([
    ["inactive", configuration({ enabled: false }), availability()],
    [
      "not_started",
      configuration({ validFrom: nowInstant.add({ milliseconds: 1 }) }),
      availability(),
    ],
    ["expired", configuration({ validUntil: nowInstant }), availability()],
    [
      "usage_limit_reached",
      configuration({ maxUses: 2 }),
      availability({ activeUseCount: 2 }),
    ],
    [
      "customer_ineligible",
      configuration(),
      availability({ allowlistSize: 1, customerAllowed: false }),
    ],
  ] as const)("retains the %s reason", async (reason, config, state) => {
    const result = await runWithProvider(resolve().pipe(Effect.result), {
      findByCode: () => Effect.succeed(Option.some(config)),
      loadAvailability: () => Effect.succeed(state),
    });

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { reason, codeId },
    });
  });

  test("uses half-open time bounds", async () => {
    const result = await runWithProvider(resolve(), {
      findByCode: () =>
        Effect.succeed(
          Option.some(
            configuration({
              validFrom: nowInstant,
              validUntil: nowInstant.add({ milliseconds: 1 }),
            })
          )
        ),
    });

    expect(result).toHaveLength(1);
  });

  test("rejects a reservation date outside the service window at a frozen redemption instant", async () => {
    const result = await runWithProvider(resolve().pipe(Effect.result), {
      findByCode: () =>
        Effect.succeed(
          Option.some(
            configuration({
              serviceDateFrom: "2026-07-16",
              serviceDateUntil: "2026-07-18",
            })
          )
        ),
      loadAvailability: mock(defaultLoadAvailability),
      loadDefinition: mock(defaultLoadDefinition),
    });

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { reason: "service_date_ineligible", codeId },
    });
  });

  test("resolves the same frozen redemption instant inside the service window", async () => {
    const result = await runWithProvider(
      resolve({ reservationDate: "2026-07-16" }),
      {
        findByCode: () =>
          Effect.succeed(
            Option.some(
              configuration({
                serviceDateFrom: "2026-07-16",
                serviceDateUntil: "2026-07-18",
              })
            )
          ),
      }
    );

    expect(result[0]?.claim?.codeId).toBe(codeId);
  });

  test.each([
    ["before the window", "2026-07-14"],
    ["on the exclusive end date", "2026-07-18"],
    ["after the window", "2026-07-19"],
  ] as const)(
    "rejects a reservation date %s",
    async (_label, reservationDate) => {
      const result = await runWithProvider(
        resolve({ reservationDate }).pipe(Effect.result),
        {
          findByCode: () =>
            Effect.succeed(
              Option.some(
                configuration({
                  serviceDateFrom: "2026-07-15",
                  serviceDateUntil: "2026-07-18",
                })
              )
            ),
        }
      );

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { reason: "service_date_ineligible", codeId },
      });
    }
  );

  test("includes the first service date and the day before the end date", async () => {
    for (const reservationDate of ["2026-07-15", "2026-07-17"]) {
      const result = await runWithProvider(resolve({ reservationDate }), {
        findByCode: () =>
          Effect.succeed(
            Option.some(
              configuration({
                serviceDateFrom: "2026-07-15",
                serviceDateUntil: "2026-07-18",
              })
            )
          ),
      });

      expect(result).toHaveLength(1);
    }
  });

  test("keeps legacy codes without a service window eligible", async () => {
    const result = await runWithProvider(resolve(), {
      findByCode: () =>
        Effect.succeed(
          Option.some(
            configuration({
              serviceDateFrom: null,
              serviceDateUntil: null,
            })
          )
        ),
    });

    expect(result).toHaveLength(1);
  });

  test("resolves vouchers without a service window constraint", async () => {
    const result = await runWithProvider(
      resolve({ reservationDate: "2027-01-01" }),
      {
        findByCode: () => Effect.succeed(Option.some(voucherConfiguration())),
        loadVoucherAvailability: () => Effect.succeed(voucherAvailability()),
      }
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.claim).toMatchObject({ kind: "voucher", voucherId });
  });

  test("composes the service date gate with expiry, audience, and usage gates", async () => {
    const serviceWindow = {
      serviceDateFrom: "2026-07-15",
      serviceDateUntil: "2026-07-18",
    };

    const expired = await runWithProvider(resolve().pipe(Effect.result), {
      findByCode: () =>
        Effect.succeed(
          Option.some(
            configuration({ ...serviceWindow, validUntil: nowInstant })
          )
        ),
    });
    expect(expired).toMatchObject({
      _tag: "Failure",
      failure: { reason: "expired" },
    });

    const notAllowed = await runWithProvider(resolve().pipe(Effect.result), {
      findByCode: () =>
        Effect.succeed(Option.some(configuration({ ...serviceWindow }))),
      loadAvailability: () =>
        Effect.succeed(
          availability({ allowlistSize: 1, customerAllowed: false })
        ),
    });
    expect(notAllowed).toMatchObject({
      _tag: "Failure",
      failure: { reason: "customer_ineligible" },
    });

    const exhausted = await runWithProvider(resolve().pipe(Effect.result), {
      findByCode: () =>
        Effect.succeed(
          Option.some(configuration({ ...serviceWindow, maxUses: 2 }))
        ),
      loadAvailability: () =>
        Effect.succeed(
          availability({ activeUseCount: 2, customerActiveUseCount: 2 })
        ),
    });
    expect(exhausted).toMatchObject({
      _tag: "Failure",
      failure: { reason: "usage_limit_reached" },
    });

    const eligible = await runWithProvider(resolve(), {
      findByCode: () =>
        Effect.succeed(Option.some(configuration({ ...serviceWindow }))),
      loadAvailability: () =>
        Effect.succeed(
          availability({ allowlistSize: 2, customerAllowed: true })
        ),
    });
    expect(eligible).toHaveLength(1);
  });

  test("rejects an anonymous preview outside the service window", async () => {
    const result = await runWithProvider(
      Effect.gen(function* () {
        yield* TestClock.setTime(now);
        const provider = yield* PromotionCodeProvider;
        return yield* provider.preview({
          ...previewInput,
          reservationDate: "2026-07-14",
        });
      }).pipe(Effect.result),
      {
        findByCode: () =>
          Effect.succeed(
            Option.some(
              configuration({
                serviceDateFrom: "2026-07-15",
                serviceDateUntil: "2026-07-18",
              })
            )
          ),
      }
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { reason: "service_date_ineligible", codeId },
    });
  });

  test("allows unrestricted and unlimited codes regardless of usage count", async () => {
    const result = await runWithProvider(resolve(), {
      loadAvailability: () =>
        Effect.succeed(
          availability({
            activeUseCount: 10_000,
            customerActiveUseCount: 10_000,
            customerAllowed: false,
          })
        ),
    });

    expect(result).toHaveLength(1);
  });

  test("allows a customer included in a non-empty allowlist", async () => {
    const result = await runWithProvider(resolve(), {
      loadAvailability: () =>
        Effect.succeed(
          availability({ allowlistSize: 2, customerAllowed: true })
        ),
    });

    expect(result).toHaveLength(1);
  });

  test("keeps codes that share one definition independently attributable", async () => {
    const findByCode = mock(({ code }) =>
      Effect.succeed(
        Option.some(
          configuration({ id: code === canonicalCode ? codeId : secondCodeId })
        )
      )
    );
    const first = await runWithProvider(resolve(), { findByCode });
    const second = await runWithProvider(
      resolve({
        submittedCode: Schema.decodeUnknownSync(canonicalPromotionCodeSchema)(
          "WINTER50"
        ),
      }),
      { findByCode }
    );

    expect(first[0]?.discount.id).toBe(discountId);
    expect(second[0]?.discount.id).toBe(discountId);
    expect(first[0]?.claim?.codeId).toBe(codeId);
    expect(second[0]?.claim?.codeId).toBe(secondCodeId);
  });

  test("enforces the configured per-customer use limit", async () => {
    const result = await runWithProvider(resolve().pipe(Effect.result), {
      findByCode: () =>
        Effect.succeed(Option.some(configuration({ maxUsesPerCustomer: 2 }))),
      loadAvailability: () =>
        Effect.succeed(availability({ customerActiveUseCount: 2 })),
    });

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { reason: "usage_limit_reached", codeId },
    });
  });

  test("fails explicitly when the product is not targeted", async () => {
    const result = await runWithProvider(resolve().pipe(Effect.result), {
      loadDefinition: () =>
        Effect.succeed(definition({ products: [{ kind: "meeting-room" }] })),
    });

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { reason: "product_ineligible", codeId },
    });
  });

  test.each([
    ["currency_mismatch", { value: 10_000, exponent: 2, currency: "EUR" }],
    ["exponent_mismatch", { value: 10_000, exponent: 0, currency: "CZK" }],
  ] as const)(
    "fails malformed configuration for fixed %s",
    async (reason, amount) => {
      const result = await runWithProvider(resolve().pipe(Effect.result), {
        loadDefinition: () =>
          Effect.succeed(definition({ adjustment: { kind: "fixed", amount } })),
      });

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          reason: "malformed_configuration",
          cause: { _tag: "DiscountCalculationError", reason },
        },
      });
    }
  );

  test("retains unknown-code, repository, and definition failure causes", async () => {
    const unknown = await runWithProvider(resolve().pipe(Effect.result), {
      findByCode: () => Effect.succeed(Option.none()),
    });
    expect(unknown).toMatchObject({
      _tag: "Failure",
      failure: { reason: "unknown_code" },
    });

    const databaseCause = new EffectDrizzleQueryError({
      query: "select discount code",
      params: [],
      cause: new Error("database unavailable"),
    });
    const database = await runWithProvider(resolve().pipe(Effect.result), {
      findByCode: () => Effect.fail(databaseCause),
    });
    expect(database).toMatchObject({
      _tag: "Failure",
      failure: { reason: "provider_failure", cause: databaseCause },
    });

    const definitionCause = new DiscountDefinitionNotFoundError({
      discountId,
      message: "Not found",
    });
    const missingDefinition = await runWithProvider(
      resolve().pipe(Effect.result),
      { loadDefinition: () => Effect.fail(definitionCause) }
    );
    expect(missingDefinition).toMatchObject({
      _tag: "Failure",
      failure: { reason: "malformed_configuration", cause: definitionCause },
    });
  });

  test("maps malformed persisted availability to configuration failure", async () => {
    const cause = new PromotionCodeConfigurationError({
      promotionCodeId,
      message: "Malformed",
      cause: new Error("negative count"),
    });
    const result = await runWithProvider(resolve().pipe(Effect.result), {
      loadAvailability: () => Effect.fail(cause),
    });

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { reason: "malformed_configuration", cause },
    });
  });

  test("revalidation performs fresh reads", async () => {
    const findByCode = mock(defaultFindByCode);
    const loadAvailability = mock(defaultLoadAvailability);
    const loadDefinition = mock(defaultLoadDefinition);

    await runWithProvider(
      Effect.gen(function* () {
        yield* TestClock.setTime(now);
        const provider = yield* PromotionCodeProvider;
        yield* provider.revalidate(input);
        yield* provider.revalidate(input);
      }),
      { findByCode, loadAvailability, loadDefinition }
    );

    expect(findByCode).toHaveBeenCalledTimes(2);
    expect(loadAvailability).toHaveBeenCalledTimes(2);
    expect(loadDefinition).toHaveBeenCalledTimes(2);
  });
});
