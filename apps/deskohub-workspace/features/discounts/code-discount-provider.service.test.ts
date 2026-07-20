import "@/shared/testing/workspace-test-env";
import "@/shared/polyfills/temporal";
import { describe, expect, mock, test } from "bun:test";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect, Layer, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import {
  CodeDiscountProvider,
  type CodeDiscountProviderInput,
} from "./code-discount-provider.service";
import { canonicalDiscountCodeSchema } from "./contracts";
import {
  type DiscountCodeAvailability,
  type DiscountCodeConfiguration,
  DiscountCodeConfigurationError,
} from "./discount-code";
import type { IDiscountCodeRepository } from "./discount-code.repository";
import { DiscountCodeRepositoryMock } from "./discount-code.repository.mock";
import type { DiscountDefinition } from "./discount-definition";
import {
  DiscountDefinitionNotFoundError,
  type IDiscountDefinitionRepository,
} from "./discount-definition.repository";
import { DiscountDefinitionRepositoryMock } from "./discount-definition.repository.mock";
import {
  discountCodeIdSchema,
  storedDiscountIdSchema,
} from "./persistence-contracts";

const nowInstant = Temporal.Instant.from("2026-07-15T12:00:00.000Z");
const now = nowInstant.epochMilliseconds;
const codeId = Schema.decodeUnknownSync(discountCodeIdSchema)(
  "019bfe6e-8ef0-7def-8b16-55cfbc82eda1"
);
const secondCodeId = Schema.decodeUnknownSync(discountCodeIdSchema)(
  "019bfe6e-8ef0-7def-8b16-55cfbc82eda2"
);
const discountId = Schema.decodeUnknownSync(storedDiscountIdSchema)(
  "019bfe6e-8ef0-7def-8b16-55cfbc82edb7"
);
const canonicalCode = Schema.decodeUnknownSync(canonicalDiscountCodeSchema)(
  "SUMMER50"
);
const product = { kind: "cowork", tier: "basic" } as const;

const input: CodeDiscountProviderInput = {
  submittedCode: canonicalCode,
  dotyposCustomerId: "customer-1",
  locale: "en-US",
  product,
  discountableSubtotal: { value: 35_000, exponent: 2, currency: "CZK" },
};

const configuration = (
  overrides: Partial<DiscountCodeConfiguration> = {}
): DiscountCodeConfiguration => ({
  id: codeId,
  discountId,
  enabled: true,
  validFrom: null,
  validUntil: null,
  maxUses: null,
  ...overrides,
});

const availability = (
  overrides: Partial<DiscountCodeAvailability> = {}
): DiscountCodeAvailability => ({
  allowlistSize: 0,
  customerAllowed: false,
  activeUseCount: 0,
  customerHasRedeemed: false,
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
  products: [product],
  ...overrides,
});

const defaultFindByCode: IDiscountCodeRepository["findByCode"] = () =>
  Effect.succeed(Option.some(configuration()));
const defaultLoadAvailability: IDiscountCodeRepository["loadAvailability"] =
  () => Effect.succeed(availability());
const defaultLoadDefinition: IDiscountDefinitionRepository["loadById"] = () =>
  Effect.succeed(definition());

const runWithProvider = <A, E>(
  effect: Effect.Effect<A, E, CodeDiscountProvider>,
  options: {
    readonly findByCode?: IDiscountCodeRepository["findByCode"];
    readonly loadAvailability?: IDiscountCodeRepository["loadAvailability"];
    readonly loadDefinition?: IDiscountDefinitionRepository["loadById"];
  } = {}
) =>
  effect.pipe(
    Effect.provide(
      Layer.mergeAll(
        CodeDiscountProvider.Live.pipe(
          Layer.provide(
            Layer.mergeAll(
              DiscountCodeRepositoryMock({
                findByCode: options.findByCode ?? defaultFindByCode,
                loadAvailability:
                  options.loadAvailability ?? defaultLoadAvailability,
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

const resolve = (
  operation: "quote" | "revalidate" = "quote",
  overrides: Partial<CodeDiscountProviderInput> = {}
) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(now);
    const provider = yield* CodeDiscountProvider;
    return yield* provider[operation]({ ...input, ...overrides });
  });

describe("CodeDiscountProvider", () => {
  test("returns no candidates and performs no reads when no code is submitted", async () => {
    const findByCode = mock(defaultFindByCode);
    const loadAvailability = mock(defaultLoadAvailability);
    const loadDefinition = mock(defaultLoadDefinition);

    const result = await runWithProvider(
      resolve("quote", { submittedCode: undefined }),
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
      codeId,
      dotyposCustomerId: "customer-1",
      at: nowInstant,
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
    const result = await runWithProvider(resolve("quote", { locale }));

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

  test.each([
    ["inactive", configuration({ enabled: false }), availability()],
    [
      "not_started",
      configuration({ validFrom: nowInstant.add({ milliseconds: 1 }) }),
      availability(),
    ],
    ["expired", configuration({ validUntil: nowInstant }), availability()],
    [
      "already_redeemed",
      configuration(),
      availability({ customerHasRedeemed: true }),
    ],
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

  test("allows unrestricted and unlimited codes regardless of usage count", async () => {
    const result = await runWithProvider(resolve(), {
      loadAvailability: () =>
        Effect.succeed(
          availability({ activeUseCount: 10_000, customerAllowed: false })
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
      resolve("quote", {
        submittedCode: Schema.decodeUnknownSync(canonicalDiscountCodeSchema)(
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

  test("leaves a live same-customer reservation for atomic admission", async () => {
    const result = await runWithProvider(resolve(), {
      loadAvailability: () =>
        Effect.succeed(
          availability({ activeUseCount: 1, customerHasRedeemed: false })
        ),
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.claim?.codeId).toBe(codeId);
  });

  test("fails explicitly when the product is not targeted", async () => {
    const result = await runWithProvider(resolve().pipe(Effect.result), {
      loadDefinition: () =>
        Effect.succeed(
          definition({ products: [{ kind: "cowork", tier: "plus" }] })
        ),
    });

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { reason: "product_ineligible", codeId },
    });
  });

  test.each([
    ["currency_mismatch", { value: 10_000, exponent: 2, currency: "EUR" }],
    ["exponent_mismatch", { value: 10_000, exponent: 0, currency: "CZK" }],
  ] as const)("fails malformed configuration for fixed %s", async (reason, amount) => {
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
  });

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
    const cause = new DiscountCodeConfigurationError({
      codeId,
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

  test("quote and revalidate both perform fresh reads", async () => {
    const findByCode = mock(defaultFindByCode);
    const loadAvailability = mock(defaultLoadAvailability);
    const loadDefinition = mock(defaultLoadDefinition);

    await runWithProvider(
      Effect.gen(function* () {
        yield* TestClock.setTime(now);
        const provider = yield* CodeDiscountProvider;
        yield* provider.quote(input);
        yield* provider.revalidate(input);
      }),
      { findByCode, loadAvailability, loadDefinition }
    );

    expect(findByCode).toHaveBeenCalledTimes(2);
    expect(loadAvailability).toHaveBeenCalledTimes(2);
    expect(loadDefinition).toHaveBeenCalledTimes(2);
  });
});
