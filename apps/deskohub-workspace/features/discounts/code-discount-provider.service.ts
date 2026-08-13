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
import type { CanonicalDiscountCode, DiscountQuoteInput } from "./contracts";
import {
  type CodeConfiguration,
  type DiscountCodeAvailability,
  type DiscountCodeConfiguration,
  type DiscountCodeConfigurationError,
  getDiscountCodeTiming,
} from "./discount-code";
import { DiscountCodeRepository } from "./discount-code.repository";
import type { DiscountDefinition } from "./discount-definition";
import { DiscountDefinitionRepository } from "./discount-definition.repository";
import { toDiscountDefinitionProviderError } from "./discount-definition-provider-error";
import {
  DiscountCalculationError,
  DiscountCodeUnavailableError,
  DiscountProviderError,
} from "./errors";
import { deriveOpaqueDiscountId } from "./opaque-discount-id";
import type { DiscountCandidate } from "./provider";

export type CodeDiscountProviderInput = Pick<
  DiscountQuoteInput,
  | "discountableSubtotal"
  | "dotyposCustomerId"
  | "locale"
  | "product"
  | "submittedCode"
>;

type CodeDiscountProviderError =
  | DiscountCodeUnavailableError
  | DiscountProviderError;

export interface ICodeDiscountProvider {
  readonly revalidate: (
    input: CodeDiscountProviderInput
  ) => Effect.Effect<readonly DiscountCandidate[], CodeDiscountProviderError>;
}

export class CodeDiscountProvider extends Context.Service<
  CodeDiscountProvider,
  ICodeDiscountProvider
>()("@deskohub-workspace/discounts/CodeDiscountProvider") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const codes = yield* DiscountCodeRepository;
      const definitions = yield* DiscountDefinitionRepository;

      const loadCodeConfiguration = Effect.fn(
        "CodeDiscountProvider.loadCodeConfiguration"
      )((input: { readonly code: CanonicalDiscountCode }) =>
        codes
          .findByCode({ code: input.code })
          .pipe(
            Effect.mapError(toDiscountCodeProviderError),
            Effect.flatMap(requireDiscountCodeConfiguration)
          )
      );

      const loadCodeAvailability = Effect.fn(
        "CodeDiscountProvider.loadCodeAvailability"
      )(
        (input: {
          readonly configuration: CodeConfiguration;
          readonly dotyposCustomerId: DotyposCustomerId;
        }) =>
          codes
            .loadAvailability({
              codeId: input.configuration.id,
              dotyposCustomerId: input.dotyposCustomerId,
            })
            .pipe(Effect.mapError(toDiscountCodeProviderError))
      );

      const loadDiscountDefinition = Effect.fn(
        "CodeDiscountProvider.loadDiscountDefinition"
      )((input: { readonly configuration: DiscountCodeConfiguration }) =>
        definitions
          .loadById({ discountId: input.configuration.discountId })
          .pipe(Effect.mapError(toDiscountDefinitionProviderError))
      );

      const resolveConfiguredCode = Effect.fn(
        "CodeDiscountProvider.resolveConfiguredCode"
      )(
        (
          input: CodeDiscountProviderInput & {
            readonly configuration: CodeConfiguration;
            readonly availability: DiscountCodeAvailability;
          }
        ) =>
          Match.value(input.configuration).pipe(
            Match.discriminatorsExhaustive("kind")({
              discount: (configuration) =>
                Effect.succeed({ ...input, configuration }).pipe(
                  Effect.tap(validateCustomerNotRedeemed),
                  Effect.tap(validateUsageAvailable),
                  Effect.bind("definition", loadDiscountDefinition),
                  Effect.tap(validateDiscountCodeProduct),
                  Effect.tap(validateFixedAdjustmentCompatibility),
                  Effect.map(toDiscountCodeCandidate)
                ),
              voucher: (configuration) =>
                toVoucherCandidate({ ...input, configuration }),
            })
          )
      );

      const resolveCode = Effect.fn("CodeDiscountProvider.resolveCode")(
        (
          input: CodeDiscountProviderInput & {
            readonly code: CanonicalDiscountCode;
          }
        ) =>
          Effect.succeed(input).pipe(
            Effect.bind("at", () =>
              Clock.currentTimeMillis.pipe(
                Effect.map(Temporal.Instant.fromEpochMilliseconds)
              )
            ),
            Effect.bind("configuration", loadCodeConfiguration),
            Effect.tap(validateDiscountCodeEnabled),
            Effect.tap(validateDiscountCodeStarted),
            Effect.tap(validateDiscountCodeUnexpired),
            Effect.bind("availability", loadCodeAvailability),
            Effect.tap(validateCustomerNotReserved),
            Effect.tap(validateCustomerAllowed),
            Effect.flatMap(resolveConfiguredCode)
          )
      );

      const resolveSubmittedCode = Effect.fn(
        "CodeDiscountProvider.resolveSubmittedCode"
      )(
        (
          input: CodeDiscountProviderInput & {
            readonly code: Option.Option<CanonicalDiscountCode>;
          }
        ) =>
          input.code.pipe(
            Option.map((code) => resolveCode({ ...input, code })),
            Effect.transposeOption
          )
      );

      const resolve = Effect.fn("CodeDiscountProvider.resolve")(
        (input: CodeDiscountProviderInput) =>
          Effect.succeed(input).pipe(
            Effect.let("code", ({ submittedCode }) =>
              Option.fromNullishOr(submittedCode)
            ),
            Effect.bind("candidate", resolveSubmittedCode),
            Effect.map(({ candidate }) => Option.toArray(candidate))
          )
      );

      const revalidate = Effect.fn("CodeDiscountProvider.revalidate")(
        (input: CodeDiscountProviderInput) => resolve(input),
        withProviderAnnotations("revalidate")
      );

      return { revalidate } satisfies ICodeDiscountProvider;
    })
  );
}

const requireDiscountCodeConfiguration = (
  configuration: Option.Option<CodeConfiguration>
) =>
  Option.match(configuration, {
    onNone: () =>
      Effect.fail(
        new DiscountCodeUnavailableError({
          reason: "unknown_code",
          message: "The submitted discount code does not exist.",
        })
      ),
    onSome: Effect.succeed,
  });

const validateDiscountCodeEnabled = (input: {
  readonly configuration: CodeConfiguration;
}) =>
  input.configuration.enabled
    ? Effect.void
    : unavailable(input.configuration, "inactive");

const validateDiscountCodeStarted = (input: {
  readonly at: Temporal.Instant;
  readonly configuration: CodeConfiguration;
}) =>
  input.configuration.validFrom === null ||
  Temporal.Instant.compare(input.at, input.configuration.validFrom) >= 0
    ? Effect.void
    : unavailable(input.configuration, "not_started");

const validateDiscountCodeUnexpired = (input: {
  readonly at: Temporal.Instant;
  readonly configuration: CodeConfiguration;
}) =>
  input.configuration.validUntil === null ||
  Temporal.Instant.compare(input.at, input.configuration.validUntil) < 0
    ? Effect.void
    : unavailable(input.configuration, "expired");

const validateCustomerNotRedeemed = (input: {
  readonly availability: DiscountCodeAvailability;
  readonly configuration: DiscountCodeConfiguration;
}) =>
  input.availability.customerHasRedeemed
    ? unavailable(input.configuration, "already_redeemed")
    : Effect.void;

const validateCustomerNotReserved = (input: {
  readonly availability: DiscountCodeAvailability;
  readonly configuration: CodeConfiguration;
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

const validateCustomerAllowed = (input: {
  readonly availability: DiscountCodeAvailability;
  readonly configuration: CodeConfiguration;
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
  readonly locale: CodeDiscountProviderInput["locale"];
  readonly product: WorkspaceProductIdentity;
}): DiscountCandidate => {
  const timing = getDiscountCodeTiming(input.configuration.validUntil);

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
  readonly availability: DiscountCodeAvailability;
  readonly configuration: Extract<
    CodeConfiguration,
    { readonly kind: "voucher" }
  >;
  readonly discountableSubtotal: DiscountQuoteInput["discountableSubtotal"];
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: CodeDiscountProviderInput["locale"];
}): Effect.Effect<
  DiscountCandidate,
  DiscountCodeUnavailableError | DiscountProviderError
> => {
  const availableAmount = workspaceMoneyWithValue(
    input.configuration.amount.value - input.availability.voucherUsedValue,
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
      ...getDiscountCodeTiming(input.configuration.validUntil),
    },
    provenance: {
      providerNamespace: "database-voucher",
      providerReference: input.configuration.id,
      details: { voucherCodeId: input.configuration.id },
    },
    claim: {
      kind: "voucher",
      codeId: input.configuration.id,
      availableAmount,
      dotyposCustomerId: input.dotyposCustomerId,
    },
  });
};

const unavailable = (
  configuration: CodeConfiguration,
  reason: DiscountCodeUnavailableError["reason"]
) =>
  Effect.fail(
    new DiscountCodeUnavailableError({
      reason,
      message: "The submitted discount code is unavailable.",
      codeId: configuration.id,
    })
  );

const toDiscountCodeProviderError = (
  cause: EffectDrizzleQueryError | DiscountCodeConfigurationError
) =>
  new DiscountProviderError({
    reason:
      cause._tag === "EffectDrizzleQueryError"
        ? "provider_failure"
        : "malformed_configuration",
    message:
      cause._tag === "EffectDrizzleQueryError"
        ? "Stored discount codes could not be loaded."
        : "A stored discount code is malformed.",
    cause,
  });

const withProviderAnnotations =
  (operation: "revalidate") =>
  <A, E>(effect: Effect.Effect<A, E>, input: CodeDiscountProviderInput) =>
    effect.pipe(
      Effect.annotateLogs({
        discountOperation: operation,
        discountProductKind: input.product.kind,
        discountProductKey: getWorkspaceProductKey(input.product),
      })
    );
