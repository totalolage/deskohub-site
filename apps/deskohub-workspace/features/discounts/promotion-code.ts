import { Data, Effect, Option, Schema } from "effect";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import {
  TemporalInstantSchema,
  temporalInstantToIsoString,
} from "@/shared/utils";
import { canonicalPromotionCodeSchema, type Discount } from "./contracts";
import { PromotionCodeUnavailableError } from "./errors";
import {
  type DiscountCodeId,
  discountCodeIdSchema,
  type PromotionCodeId,
  promotionCodeIdSchema,
  type StoredDiscountId,
  storedDiscountIdSchema,
  type VoucherId,
  voucherIdSchema,
} from "./persistence-contracts";

type PromotionConfiguration = {
  readonly promotionCodeId: PromotionCodeId;
  readonly enabled: boolean;
  readonly validFrom: Temporal.Instant | null;
  readonly validUntil: Temporal.Instant | null;
};

export type DiscountCodeConfiguration = PromotionConfiguration & {
  readonly kind: "discount";
  readonly id: DiscountCodeId;
  readonly discountId: StoredDiscountId;
  readonly maxUses: number | null;
  readonly maxUsesPerCustomer: number | null;
};

export type VoucherConfiguration = PromotionConfiguration & {
  readonly kind: "voucher";
  readonly id: VoucherId;
  readonly amount: WorkspaceMoney;
};

export type SubmittedPromotionConfiguration =
  | DiscountCodeConfiguration
  | VoucherConfiguration;

export type PromotionAudienceAvailability = {
  readonly allowlistSize: number;
  readonly customerAllowed: boolean;
};

export type DiscountCodeAvailability = PromotionAudienceAvailability & {
  readonly activeUseCount: number;
  readonly customerActiveUseCount: number;
};

export type VoucherAvailability = PromotionAudienceAvailability & {
  readonly customerHasReserved: boolean;
  readonly usedValue: number;
};

export class PromotionCodeConfigurationError extends Data.TaggedError(
  "PromotionCodeConfigurationError"
)<{
  readonly promotionCodeId: PromotionCodeId;
  readonly message: string;
  readonly cause: unknown;
}> {}

export const getPromotionTiming = (
  validUntil: Temporal.Instant | null
): Pick<Discount, "expiresAt" | "countdownStartsAt"> => {
  if (validUntil === null) return {};
  return {
    expiresAt: temporalInstantToIsoString(validUntil),
    countdownStartsAt: temporalInstantToIsoString(
      validUntil.subtract({ hours: 1 })
    ),
  };
};

export const normalizeSubmittedPromotionCode = Effect.fn(
  "PromotionCode.normalizeSubmitted"
)((input: { readonly submittedCode: string | undefined }) =>
  Option.fromNullishOr(input.submittedCode).pipe(
    Option.map((submittedCode) => uppercaseAscii(submittedCode.trim())),
    Option.filter((normalizedCode) => normalizedCode.length > 0),
    Option.map((normalizedCode) =>
      Schema.is(canonicalPromotionCodeSchema)(normalizedCode)
        ? Effect.succeed(normalizedCode)
        : Effect.fail(
            new PromotionCodeUnavailableError({
              reason: "invalid_syntax",
              message: "The submitted promotion code has invalid syntax.",
            })
          )
    ),
    Effect.transposeOption
  )
);

export const generatePromotionCode = () => {
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

export type PromotionConfigurationRow = {
  readonly promotionCodeId: PromotionCodeId;
  readonly kind: "discount" | "voucher";
  readonly code: string;
  readonly enabled: boolean;
  readonly validFrom: Temporal.Instant | null;
  readonly validUntil: Temporal.Instant | null;
  readonly discountCodeId: DiscountCodeId | null;
  readonly discountId: StoredDiscountId | null;
  readonly maxUses: number | null;
  readonly maxUsesPerCustomer: number | null;
  readonly voucherId: VoucherId | null;
  readonly issuedAmountValue: number | null;
  readonly issuedAmountExponent: number | null;
  readonly issuedAmountCurrency: string | null;
};

export const decodePromotionConfiguration = Effect.fn(
  "PromotionCode.decodeConfiguration"
)((input: { readonly row: PromotionConfigurationRow }) =>
  Schema.decodeUnknownEffect(promotionConfigurationSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(input.row).pipe(
    Effect.map(
      (configuration): SubmittedPromotionConfiguration =>
        configuration.kind === "discount"
          ? {
              kind: "discount",
              id: configuration.discountCodeId,
              promotionCodeId: configuration.promotionCodeId,
              discountId: configuration.discountId,
              enabled: configuration.enabled,
              validFrom: configuration.validFrom,
              validUntil: configuration.validUntil,
              maxUses: configuration.maxUses,
              maxUsesPerCustomer: configuration.maxUsesPerCustomer,
            }
          : {
              kind: "voucher",
              id: configuration.voucherId,
              promotionCodeId: configuration.promotionCodeId,
              enabled: configuration.enabled,
              validFrom: configuration.validFrom,
              validUntil: configuration.validUntil,
              amount: {
                value: configuration.issuedAmountValue,
                exponent: configuration.issuedAmountExponent,
                currency: configuration.issuedAmountCurrency,
              },
            }
    ),
    Effect.mapError(
      (cause) =>
        new PromotionCodeConfigurationError({
          promotionCodeId: input.row.promotionCodeId,
          message: "Stored promotion configuration is malformed.",
          cause,
        })
    )
  )
);

const promotionConfigurationBase = Schema.Struct({
  promotionCodeId: promotionCodeIdSchema,
  code: canonicalPromotionCodeSchema,
  enabled: Schema.Boolean,
  validFrom: Schema.NullOr(TemporalInstantSchema),
  validUntil: Schema.NullOr(TemporalInstantSchema),
});

const promotionConfigurationSchema = Schema.Union([
  Schema.Struct({
    ...promotionConfigurationBase.fields,
    kind: Schema.Literal("discount"),
    discountCodeId: discountCodeIdSchema,
    discountId: storedDiscountIdSchema,
    maxUses: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
    maxUsesPerCustomer: Schema.NullOr(
      Schema.Int.check(Schema.isGreaterThan(0))
    ),
    voucherId: Schema.Null,
    issuedAmountValue: Schema.Null,
    issuedAmountExponent: Schema.Null,
    issuedAmountCurrency: Schema.Null,
  }),
  Schema.Struct({
    ...promotionConfigurationBase.fields,
    kind: Schema.Literal("voucher"),
    discountCodeId: Schema.Null,
    discountId: Schema.Null,
    maxUses: Schema.Null,
    maxUsesPerCustomer: Schema.Null,
    voucherId: voucherIdSchema,
    issuedAmountValue: Schema.Int.check(Schema.isGreaterThan(0)),
    issuedAmountExponent: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    issuedAmountCurrency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
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

const generatedDiscountCodeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

const uppercaseAscii = (value: string) =>
  value.replace(/[a-z]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 32)
  );
