import { Clock, Context, Effect, Layer, Option } from "effect";
import type { DatabaseError } from "@/db/database.service";
import { temporalInstantToIsoString } from "@/shared/utils";
import type {
  CanonicalDiscountCode,
  DiscountProductIdentity,
  DiscountQuoteInput,
} from "./contracts";
import type {
  DiscountCodeAvailability,
  DiscountCodeConfiguration,
  DiscountCodeConfigurationError,
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
import type { DiscountCandidate } from "./provider";

export type CodeDiscountProviderInput = Pick<
  DiscountQuoteInput,
  "discountableSubtotal" | "dotyposCustomerId" | "product" | "submittedCode"
>;

type CodeDiscountProviderError =
  | DiscountCodeUnavailableError
  | DiscountProviderError;

export interface ICodeDiscountProvider {
  readonly quote: (
    input: CodeDiscountProviderInput
  ) => Effect.Effect<readonly DiscountCandidate[], CodeDiscountProviderError>;
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
          readonly at: Date;
          readonly configuration: DiscountCodeConfiguration;
          readonly dotyposCustomerId: string;
        }) =>
          codes
            .loadAvailability({
              codeId: input.configuration.id,
              dotyposCustomerId: input.dotyposCustomerId,
              at: input.at,
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

      const resolveCode = Effect.fn("CodeDiscountProvider.resolveCode")(
        (
          input: CodeDiscountProviderInput & {
            readonly code: CanonicalDiscountCode;
          }
        ) =>
          Effect.succeed(input).pipe(
            Effect.bind("now", () => Clock.currentTimeMillis),
            Effect.let("at", ({ now }) => new Date(now)),
            Effect.bind("configuration", loadCodeConfiguration),
            Effect.tap(validateDiscountCodeEnabled),
            Effect.tap(validateDiscountCodeStarted),
            Effect.tap(validateDiscountCodeUnexpired),
            Effect.bind("availability", loadCodeAvailability),
            Effect.tap(validateCustomerNotRedeemed),
            Effect.tap(validateUsageAvailable),
            Effect.tap(validateCustomerAllowed),
            Effect.bind("definition", loadDiscountDefinition),
            Effect.tap(validateDiscountCodeProduct),
            Effect.tap(validateFixedAdjustmentCompatibility),
            Effect.map(toDiscountCodeCandidate),
            Effect.annotateLogs({ discountCode: input.code })
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
            Effect.map(({ candidate }) => Option.toArray(candidate)),
            Effect.tapError(logDiscountCodeError)
          )
      );

      const quote = Effect.fn("CodeDiscountProvider.quote")(
        (input: CodeDiscountProviderInput) => resolve(input),
        withProviderAnnotations("quote")
      );

      const revalidate = Effect.fn("CodeDiscountProvider.revalidate")(
        (input: CodeDiscountProviderInput) => resolve(input),
        withProviderAnnotations("revalidate")
      );

      return { quote, revalidate } satisfies ICodeDiscountProvider;
    })
  );
}

const requireDiscountCodeConfiguration = (
  configuration: Option.Option<DiscountCodeConfiguration>
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
  readonly configuration: DiscountCodeConfiguration;
}) =>
  input.configuration.enabled
    ? Effect.void
    : unavailable(input.configuration, "inactive");

const validateDiscountCodeStarted = (input: {
  readonly at: Date;
  readonly configuration: DiscountCodeConfiguration;
}) =>
  input.configuration.validFrom === null ||
  input.at.getTime() >= input.configuration.validFrom.getTime()
    ? Effect.void
    : unavailable(input.configuration, "not_started");

const validateDiscountCodeUnexpired = (input: {
  readonly at: Date;
  readonly configuration: DiscountCodeConfiguration;
}) =>
  input.configuration.validUntil === null ||
  input.at.getTime() < input.configuration.validUntil.getTime()
    ? Effect.void
    : unavailable(input.configuration, "expired");

const validateCustomerNotRedeemed = (input: {
  readonly availability: DiscountCodeAvailability;
  readonly configuration: DiscountCodeConfiguration;
}) =>
  input.availability.customerHasRedeemed
    ? unavailable(input.configuration, "already_redeemed")
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
  readonly configuration: DiscountCodeConfiguration;
}) =>
  input.availability.allowlistSize > 0 && !input.availability.customerAllowed
    ? unavailable(input.configuration, "customer_ineligible")
    : Effect.void;

const validateDiscountCodeProduct = (input: {
  readonly configuration: DiscountCodeConfiguration;
  readonly definition: DiscountDefinition;
  readonly product: DiscountProductIdentity;
}) =>
  input.definition.products.some((product) =>
    isSameProduct(product, input.product)
  )
    ? Effect.void
    : unavailable(input.configuration, "product_ineligible");

const validateFixedAdjustmentCompatibility = (input: {
  readonly configuration: DiscountCodeConfiguration;
  readonly definition: DiscountDefinition;
  readonly discountableSubtotal: DiscountQuoteInput["discountableSubtotal"];
}) => {
  const { adjustment } = input.definition;

  if (adjustment.kind === "percentage") {
    return Effect.void;
  }

  const reason =
    adjustment.amount.currency !== input.discountableSubtotal.currency
      ? "currency_mismatch"
      : adjustment.amount.exponent !== input.discountableSubtotal.exponent
        ? "exponent_mismatch"
        : undefined;

  return reason === undefined
    ? Effect.void
    : Effect.fail(
        new DiscountProviderError({
          reason: "malformed_configuration",
          message:
            "The discount code fixed adjustment is incompatible with the requested subtotal.",
          cause: new DiscountCalculationError({
            reason,
            message:
              "Fixed discount currency and exponent must match the discountable subtotal.",
            discountId: input.definition.id,
          }),
        })
      );
};

const toDiscountCodeCandidate = (input: {
  readonly configuration: DiscountCodeConfiguration;
  readonly definition: DiscountDefinition;
  readonly dotyposCustomerId: string;
  readonly product: DiscountProductIdentity;
}): DiscountCandidate => {
  const timing = getDiscountCodeTiming(input.configuration.validUntil);

  return {
    discount: {
      id: input.definition.id,
      label: input.definition.label,
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

const getDiscountCodeTiming = (
  validUntil: Date | null
): Pick<DiscountCandidate["discount"], "expiresAt" | "countdownStartsAt"> => {
  if (validUntil === null) {
    return {};
  }

  const expiresAt = Temporal.Instant.fromEpochMilliseconds(
    validUntil.getTime()
  );

  return {
    expiresAt: temporalInstantToIsoString(expiresAt),
    countdownStartsAt: temporalInstantToIsoString(
      expiresAt.subtract({ hours: 1 })
    ),
  };
};

const isSameProduct = (
  left: DiscountProductIdentity,
  right: DiscountProductIdentity
) => left.kind === right.kind && left.tier === right.tier;

const unavailable = (
  configuration: DiscountCodeConfiguration,
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
  cause: DatabaseError | DiscountCodeConfigurationError
) =>
  new DiscountProviderError({
    reason:
      cause._tag === "DatabaseError"
        ? "provider_failure"
        : "malformed_configuration",
    message:
      cause._tag === "DatabaseError"
        ? "Stored discount codes could not be loaded."
        : "A stored discount code is malformed.",
    cause,
  });

const logDiscountCodeError = (
  cause: DiscountCodeUnavailableError | DiscountProviderError
) =>
  (cause._tag === "DiscountProviderError"
    ? Effect.logError
    : Effect.logWarning)("Discount code resolution failed", {
    reason: cause.reason,
    ...("codeId" in cause &&
      cause.codeId !== undefined && { discountCodeId: cause.codeId }),
  });

const withProviderAnnotations =
  (operation: "quote" | "revalidate") =>
  <A, E>(effect: Effect.Effect<A, E>, input: CodeDiscountProviderInput) =>
    effect.pipe(
      Effect.annotateLogs({
        operation,
        dotyposCustomerId: input.dotyposCustomerId,
        product: input.product,
      })
    );
