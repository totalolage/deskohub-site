import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Clock, Context, Effect, Layer, Match, Option } from "effect";
import {
  getWorkspaceProductKey,
  type WorkspaceProductIdentity,
} from "@/features/checkout/product-identity";
import { workspaceMoneyWithValue } from "@/features/checkout/workspace-money";
import { workspaceProductTargetMatches } from "@/features/discounts/product-target";
import { m } from "@/features/i18n";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import type { CanonicalPromotionCode, DiscountQuoteInput } from "./contracts";
import type { DiscountDefinition } from "./discount-definition";
import { DiscountDefinitionRepository } from "./discount-definition.repository";
import { toDiscountDefinitionProviderError } from "./discount-definition-provider-error";
import {
  DiscountCalculationError,
  DiscountProviderError,
  PromotionCodeUnavailableError,
} from "./errors";
import { deriveOpaqueDiscountId } from "./opaque-discount-id";
import {
  type DiscountCodeAvailability,
  type DiscountCodeConfiguration,
  getPromotionTiming,
  type PromotionCodeConfigurationError,
  type SubmittedPromotionConfiguration,
  type VoucherAvailability,
} from "./promotion-code";
import { PromotionCodeRepository } from "./promotion-code.repository";
import type { DiscountCandidate } from "./provider";

export type PromotionCodeProviderInput = Pick<
  DiscountQuoteInput,
  | "discountableSubtotal"
  | "dotyposCustomerId"
  | "locale"
  | "product"
  | "submittedCode"
>;

type PromotionCodeProviderError =
  | PromotionCodeUnavailableError
  | DiscountProviderError;

export interface IPromotionCodeProvider {
  readonly revalidate: (
    input: PromotionCodeProviderInput
  ) => Effect.Effect<readonly DiscountCandidate[], PromotionCodeProviderError>;
}

export class PromotionCodeProvider extends Context.Service<
  PromotionCodeProvider,
  IPromotionCodeProvider
>()("@deskohub-workspace/discounts/PromotionCodeProvider") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const promotions = yield* PromotionCodeRepository;
      const definitions = yield* DiscountDefinitionRepository;

      const loadCodeConfiguration = Effect.fn(
        "PromotionCodeProvider.loadCodeConfiguration"
      )((input: { readonly code: CanonicalPromotionCode }) =>
        promotions
          .findByCode({ code: input.code })
          .pipe(
            Effect.mapError(toPromotionCodeProviderError),
            Effect.flatMap(requirePromotionConfiguration)
          )
      );

      const loadDiscountDefinition = Effect.fn(
        "PromotionCodeProvider.loadDiscountDefinition"
      )((input: { readonly configuration: DiscountCodeConfiguration }) =>
        definitions
          .loadById({ discountId: input.configuration.discountId })
          .pipe(Effect.mapError(toDiscountDefinitionProviderError))
      );

      const resolveConfiguredCode = Effect.fn(
        "PromotionCodeProvider.resolveConfiguredCode"
      )(
        (
          input: PromotionCodeProviderInput & {
            readonly configuration: SubmittedPromotionConfiguration;
          }
        ) =>
          Match.value(input.configuration).pipe(
            Match.discriminatorsExhaustive("kind")({
              discount: (configuration) =>
                promotions
                  .loadDiscountCodeAvailability({
                    promotionCodeId: configuration.promotionCodeId,
                    codeId: configuration.id,
                    dotyposCustomerId: input.dotyposCustomerId,
                  })
                  .pipe(
                    Effect.mapError(toPromotionCodeProviderError),
                    Effect.map((availability) => ({
                      ...input,
                      availability,
                      configuration,
                    })),
                    Effect.tap(validateCustomerAllowed),
                    Effect.tap(validateUsageAvailable),
                    Effect.tap(validateCustomerUsageAvailable),
                    Effect.bind("definition", loadDiscountDefinition),
                    Effect.tap(validateDiscountCodeProduct),
                    Effect.tap(validateFixedAdjustmentCompatibility),
                    Effect.map(toDiscountCodeCandidate)
                  ),
              voucher: (configuration) =>
                promotions
                  .loadVoucherAvailability({
                    promotionCodeId: configuration.promotionCodeId,
                    voucherId: configuration.id,
                    dotyposCustomerId: input.dotyposCustomerId,
                  })
                  .pipe(
                    Effect.mapError(toPromotionCodeProviderError),
                    Effect.map((availability) => ({
                      ...input,
                      availability,
                      configuration,
                    })),
                    Effect.tap(validateCustomerNotReserved),
                    Effect.tap(validateCustomerAllowed),
                    Effect.flatMap(toVoucherCandidate)
                  ),
            })
          )
      );

      const resolveCode = Effect.fn("PromotionCodeProvider.resolveCode")(
        (
          input: PromotionCodeProviderInput & {
            readonly code: CanonicalPromotionCode;
          }
        ) =>
          Effect.succeed(input).pipe(
            Effect.bind("at", () =>
              Clock.currentTimeMillis.pipe(
                Effect.map(Temporal.Instant.fromEpochMilliseconds)
              )
            ),
            Effect.bind("configuration", loadCodeConfiguration),
            Effect.tap(validatePromotionEnabled),
            Effect.tap(validatePromotionStarted),
            Effect.tap(validateDiscountCodeUnexpired),
            Effect.flatMap(resolveConfiguredCode)
          )
      );

      const resolveSubmittedCode = Effect.fn(
        "PromotionCodeProvider.resolveSubmittedCode"
      )(
        (
          input: PromotionCodeProviderInput & {
            readonly code: Option.Option<CanonicalPromotionCode>;
          }
        ) =>
          input.code.pipe(
            Option.map((code) => resolveCode({ ...input, code })),
            Effect.transposeOption
          )
      );

      const resolve = Effect.fn("PromotionCodeProvider.resolve")(
        (input: PromotionCodeProviderInput) =>
          Effect.succeed(input).pipe(
            Effect.let("code", ({ submittedCode }) =>
              Option.fromNullishOr(submittedCode)
            ),
            Effect.bind("candidate", resolveSubmittedCode),
            Effect.map(({ candidate }) => Option.toArray(candidate))
          )
      );

      const revalidate = Effect.fn("PromotionCodeProvider.revalidate")(
        (input: PromotionCodeProviderInput) => resolve(input),
        withProviderAnnotations("revalidate")
      );

      return { revalidate } satisfies IPromotionCodeProvider;
    })
  );
}

const requirePromotionConfiguration = (
  configuration: Option.Option<SubmittedPromotionConfiguration>
) =>
  Option.match(configuration, {
    onNone: () =>
      Effect.fail(
        new PromotionCodeUnavailableError({
          reason: "unknown_code",
          message: "The submitted promotion code does not exist.",
        })
      ),
    onSome: Effect.succeed,
  });

const validatePromotionEnabled = (input: {
  readonly configuration: SubmittedPromotionConfiguration;
}) =>
  input.configuration.enabled
    ? Effect.void
    : unavailable(input.configuration, "inactive");

const validatePromotionStarted = (input: {
  readonly at: Temporal.Instant;
  readonly configuration: SubmittedPromotionConfiguration;
}) =>
  input.configuration.validFrom === null ||
  Temporal.Instant.compare(input.at, input.configuration.validFrom) >= 0
    ? Effect.void
    : unavailable(input.configuration, "not_started");

const validateDiscountCodeUnexpired = (input: {
  readonly at: Temporal.Instant;
  readonly configuration: SubmittedPromotionConfiguration;
}) =>
  input.configuration.validUntil === null ||
  Temporal.Instant.compare(input.at, input.configuration.validUntil) < 0
    ? Effect.void
    : unavailable(input.configuration, "expired");

const validateCustomerNotReserved = (input: {
  readonly availability: { readonly customerHasReserved: boolean };
  readonly configuration: SubmittedPromotionConfiguration;
}) =>
  input.availability.customerHasReserved
    ? unavailable(input.configuration, "claim_conflict")
    : Effect.void;

const validateUsageAvailable = (input: {
  readonly availability: DiscountCodeAvailability;
  readonly configuration: DiscountCodeConfiguration;
}) =>
  input.configuration.maxUses !== null &&
  input.availability.activeUseCount >= input.configuration.maxUses
    ? unavailable(input.configuration, "usage_limit_reached")
    : Effect.void;

const validateCustomerUsageAvailable = (input: {
  readonly availability: DiscountCodeAvailability;
  readonly configuration: DiscountCodeConfiguration;
}) =>
  input.configuration.maxUsesPerCustomer !== null &&
  input.availability.customerActiveUseCount >=
    input.configuration.maxUsesPerCustomer
    ? unavailable(input.configuration, "usage_limit_reached")
    : Effect.void;

const validateCustomerAllowed = (input: {
  readonly availability: {
    readonly allowlistSize: number;
    readonly customerAllowed: boolean;
  };
  readonly configuration: SubmittedPromotionConfiguration;
}) =>
  input.availability.allowlistSize > 0 && !input.availability.customerAllowed
    ? unavailable(input.configuration, "customer_ineligible")
    : Effect.void;

const validateDiscountCodeProduct = (input: {
  readonly configuration: DiscountCodeConfiguration;
  readonly definition: DiscountDefinition;
  readonly product: WorkspaceProductIdentity;
}) =>
  input.definition.products.some((product) =>
    workspaceProductTargetMatches(product, input.product)
  )
    ? Effect.void
    : unavailable(input.configuration, "product_ineligible");

const validateFixedAdjustmentCompatibility = (input: {
  readonly configuration: DiscountCodeConfiguration;
  readonly definition: DiscountDefinition;
  readonly discountableSubtotal: DiscountQuoteInput["discountableSubtotal"];
}) => {
  const { adjustment } = input.definition;

  return Match.value(adjustment).pipe(
    Match.discriminatorsExhaustive("kind")({
      percentage: () => Effect.void,
      fixed: (fixedAdjustment) =>
        Option.liftPredicate(
          fixedAdjustment.amount,
          (amount) =>
            amount.currency !== input.discountableSubtotal.currency ||
            amount.exponent !== input.discountableSubtotal.exponent
        ).pipe(
          Option.map(
            (amount) =>
              new DiscountProviderError({
                reason: "malformed_configuration",
                message:
                  "The discount code fixed adjustment is incompatible with the requested subtotal.",
                cause: new DiscountCalculationError({
                  reason:
                    amount.currency !== input.discountableSubtotal.currency
                      ? "currency_mismatch"
                      : "exponent_mismatch",
                  message:
                    "Fixed discount currency and exponent must match the discountable subtotal.",
                  discountId: input.definition.id,
                }),
              })
          ),
          Option.map(Effect.fail),
          Effect.transposeOption,
          Effect.asVoid
        ),
    })
  );
};

const toDiscountCodeCandidate = (input: {
  readonly configuration: DiscountCodeConfiguration;
  readonly definition: DiscountDefinition;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: PromotionCodeProviderInput["locale"];
  readonly product: WorkspaceProductIdentity;
}): DiscountCandidate => {
  const timing = getPromotionTiming(input.configuration.validUntil);

  return {
    discount: {
      id: input.definition.id,
      label: input.definition.labels[input.locale],
      adjustment: input.definition.adjustment,
      ...timing,
    },
    provenance: {
      providerNamespace: "database-discount-code",
      providerReference: input.configuration.id,
      details: {
        discountCodeId: input.configuration.id,
        storedDiscountId: input.definition.id,
      },
    },
    claim: {
      kind: "discount_code",
      codeId: input.configuration.id,
      storedDiscountId: input.definition.id,
      dotyposCustomerId: input.dotyposCustomerId,
      product: input.product,
    },
  };
};

const toVoucherCandidate = (input: {
  readonly availability: VoucherAvailability;
  readonly configuration: Extract<
    SubmittedPromotionConfiguration,
    { readonly kind: "voucher" }
  >;
  readonly discountableSubtotal: DiscountQuoteInput["discountableSubtotal"];
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: PromotionCodeProviderInput["locale"];
}): Effect.Effect<
  DiscountCandidate,
  PromotionCodeUnavailableError | DiscountProviderError
> => {
  const availableAmount = workspaceMoneyWithValue(
    input.configuration.amount.value - input.availability.usedValue,
    input.configuration.amount
  );
  if (availableAmount.value <= 0) {
    return unavailable(input.configuration, "usage_limit_reached");
  }
  if (
    availableAmount.currency !== input.discountableSubtotal.currency ||
    availableAmount.exponent !== input.discountableSubtotal.exponent
  ) {
    return Effect.fail(
      new DiscountProviderError({
        reason: "malformed_configuration",
        message:
          "The voucher credit is incompatible with the requested subtotal.",
        cause: new DiscountCalculationError({
          reason:
            availableAmount.currency !== input.discountableSubtotal.currency
              ? "currency_mismatch"
              : "exponent_mismatch",
          message:
            "Voucher currency and exponent must match the discountable subtotal.",
        }),
      })
    );
  }

  const id = deriveOpaqueDiscountId({
    providerNamespace: "database-voucher",
    providerReference: input.configuration.id,
  });
  return Effect.succeed({
    discount: {
      id,
      label: m.checkoutVoucherLabel({}, { locale: input.locale }),
      adjustment: { kind: "fixed", amount: availableAmount },
      ...getPromotionTiming(input.configuration.validUntil),
    },
    provenance: {
      providerNamespace: "database-voucher",
      providerReference: input.configuration.id,
      details: { voucherId: input.configuration.id },
    },
    claim: {
      kind: "voucher",
      voucherId: input.configuration.id,
      availableAmount,
      dotyposCustomerId: input.dotyposCustomerId,
    },
  });
};

const unavailable = (
  configuration: SubmittedPromotionConfiguration,
  reason: PromotionCodeUnavailableError["reason"]
) =>
  Effect.fail(
    new PromotionCodeUnavailableError({
      reason,
      message: "The submitted promotion code is unavailable.",
      codeId: configuration.id,
    })
  );

const toPromotionCodeProviderError = (
  cause: EffectDrizzleQueryError | PromotionCodeConfigurationError
) =>
  new DiscountProviderError({
    reason:
      cause._tag === "EffectDrizzleQueryError"
        ? "provider_failure"
        : "malformed_configuration",
    message:
      cause._tag === "EffectDrizzleQueryError"
        ? "Stored promotion codes could not be loaded."
        : "A stored promotion code is malformed.",
    cause,
  });

const withProviderAnnotations =
  (operation: "revalidate") =>
  <A, E>(effect: Effect.Effect<A, E>, input: PromotionCodeProviderInput) =>
    effect.pipe(
      Effect.annotateLogs({
        discountOperation: operation,
        discountProductKind: input.product.kind,
        discountProductKey: getWorkspaceProductKey(input.product),
      })
    );
