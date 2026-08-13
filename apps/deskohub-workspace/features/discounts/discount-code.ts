import { Data, Effect, Option, Schema } from "effect";
import type { DiscountCode } from "@/db/schema";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import {
  TemporalInstantSchema,
  temporalInstantToIsoString,
} from "@/shared/utils";
import { canonicalDiscountCodeSchema, type Discount } from "./contracts";
import { DiscountCodeUnavailableError } from "./errors";
import {
  type DiscountCodeId,
  discountCodeIdSchema,
  type StoredDiscountId,
  storedDiscountIdSchema,
} from "./persistence-contracts";

type DiscountCodeConfigurationBase = {
  readonly id: DiscountCodeId;
  readonly enabled: boolean;
  readonly validFrom: Temporal.Instant | null;
  readonly validUntil: Temporal.Instant | null;
};

export type DiscountCodeConfiguration = DiscountCodeConfigurationBase & {
  readonly kind: "discount";
  readonly discountId: StoredDiscountId;
  readonly maxUses: number | null;
};

export type VoucherConfiguration = DiscountCodeConfigurationBase & {
  readonly kind: "voucher";
  readonly amount: WorkspaceMoney;
};

export type CodeConfiguration =
  | DiscountCodeConfiguration
  | VoucherConfiguration;

export type DiscountCodeAvailability = {
  readonly allowlistSize: number;
  readonly customerAllowed: boolean;
  readonly activeUseCount: number;
  readonly customerHasRedeemed: boolean;
  readonly customerHasReserved: boolean;
  readonly voucherUsedValue: number;
};

export class DiscountCodeConfigurationError extends Data.TaggedError(
  "DiscountCodeConfigurationError"
)<{
  readonly codeId: DiscountCodeId;
  readonly message: string;
  readonly cause: unknown;
}> {}

export const getDiscountCodeTiming = (
  validUntil: Temporal.Instant | null
): Pick<Discount, "expiresAt" | "countdownStartsAt"> => {
  if (validUntil === null) {
    return {};
  }

  return {
    expiresAt: temporalInstantToIsoString(validUntil),
    countdownStartsAt: temporalInstantToIsoString(
      validUntil.subtract({ hours: 1 })
    ),
  };
};

export const normalizeSubmittedDiscountCode = Effect.fn(
  "DiscountCode.normalizeSubmitted"
)((input: { readonly submittedCode: string | undefined }) =>
  Option.fromNullishOr(input.submittedCode).pipe(
    Option.map((submittedCode) => uppercaseAscii(submittedCode.trim())),
    Option.filter((normalizedCode) => normalizedCode.length > 0),
    Option.map((normalizedCode) =>
      Schema.is(canonicalDiscountCodeSchema)(normalizedCode)
        ? Effect.succeed(normalizedCode)
        : Effect.fail(
            new DiscountCodeUnavailableError({
              reason: "invalid_syntax",
              message: "The submitted discount code has invalid syntax.",
            })
          )
    ),
    Effect.transposeOption
  )
);

export const generateDiscountCode = () => {
  const randomValues = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const characters = Array.from(
    randomValues,
    (value) =>
      generatedDiscountCodeAlphabet[
        value % generatedDiscountCodeAlphabet.length
      ]
  ).join("");

  return `${characters.slice(0, 6)}-${characters.slice(6)}`;
};

export const decodeDiscountCodeConfiguration = Effect.fn(
  "DiscountCode.decodeConfiguration"
)((input: { readonly row: DiscountCode }) =>
  Schema.decodeUnknownEffect(discountCodeConfigurationSchema, {
    errors: "all",
    onExcessProperty: "error",
  })({
    id: input.row.id,
    kind: input.row.kind,
    discountId: input.row.discountId,
    code: input.row.code,
    enabled: input.row.enabled,
    validFrom: input.row.validFrom,
    validUntil: input.row.validUntil,
    maxUses: input.row.maxUses,
    voucherAmountValue: input.row.voucherAmountValue,
    voucherAmountExponent: input.row.voucherAmountExponent,
    voucherAmountCurrency: input.row.voucherAmountCurrency,
  }).pipe(
    Effect.map(
      ({ code: _code, ...configuration }): CodeConfiguration =>
        configuration.kind === "discount"
          ? {
              kind: configuration.kind,
              id: configuration.id,
              discountId: configuration.discountId,
              enabled: configuration.enabled,
              validFrom: configuration.validFrom,
              validUntil: configuration.validUntil,
              maxUses: configuration.maxUses,
            }
          : {
              kind: configuration.kind,
              id: configuration.id,
              enabled: configuration.enabled,
              validFrom: configuration.validFrom,
              validUntil: configuration.validUntil,
              amount: {
                value: configuration.voucherAmountValue,
                exponent: configuration.voucherAmountExponent,
                currency: configuration.voucherAmountCurrency,
              },
            }
    ),
    Effect.mapError(
      (cause) =>
        new DiscountCodeConfigurationError({
          codeId: input.row.id,
          message: "Stored discount code configuration is malformed.",
          cause,
        })
    )
  )
);

export const decodeDiscountCodeAvailability = Effect.fn(
  "DiscountCode.decodeAvailability"
)(
  (input: {
    readonly codeId: DiscountCodeId;
    readonly availability: DiscountCodeAvailability;
  }) =>
    Schema.decodeUnknownEffect(discountCodeAvailabilitySchema, {
      errors: "all",
      onExcessProperty: "error",
    })(input.availability).pipe(
      Effect.mapError(
        (cause) =>
          new DiscountCodeConfigurationError({
            codeId: input.codeId,
            message: "Stored discount code availability is malformed.",
            cause,
          })
      )
    )
);

const discountCodeConfigurationBase = Schema.Struct({
  id: discountCodeIdSchema,
  code: canonicalDiscountCodeSchema,
  enabled: Schema.Boolean,
  validFrom: Schema.NullOr(TemporalInstantSchema),
  validUntil: Schema.NullOr(TemporalInstantSchema),
});

const discountCodeConfigurationSchema = Schema.Union([
  Schema.Struct({
    ...discountCodeConfigurationBase.fields,
    kind: Schema.Literal("discount"),
    discountId: storedDiscountIdSchema,
    maxUses: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
    voucherAmountValue: Schema.Null,
    voucherAmountExponent: Schema.Null,
    voucherAmountCurrency: Schema.Null,
  }),
  Schema.Struct({
    ...discountCodeConfigurationBase.fields,
    kind: Schema.Literal("voucher"),
    discountId: Schema.Null,
    maxUses: Schema.Null,
    voucherAmountValue: Schema.Int.check(Schema.isGreaterThan(0)),
    voucherAmountExponent: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    voucherAmountCurrency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  }),
]).check(
  Schema.makeFilter(
    ({ validFrom, validUntil }) =>
      validFrom === null ||
      validUntil === null ||
      Temporal.Instant.compare(validUntil, validFrom) > 0 || {
        path: ["validUntil"],
        issue: "validUntil must be later than validFrom",
      }
  )
);

const discountCodeAvailabilitySchema = Schema.Struct({
  allowlistSize: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  customerAllowed: Schema.Boolean,
  activeUseCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  customerHasRedeemed: Schema.Boolean,
  customerHasReserved: Schema.Boolean,
  voucherUsedValue: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

const generatedDiscountCodeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

const uppercaseAscii = (value: string) =>
  value.replace(/[a-z]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 32)
  );
