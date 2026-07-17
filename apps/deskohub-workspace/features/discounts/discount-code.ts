import { Data, Effect, Option, Schema } from "effect";
import type { DiscountCode } from "@/db/schema";
import { canonicalDiscountCodeSchema } from "./contracts";
import { DiscountCodeUnavailableError } from "./errors";
import {
  type DiscountCodeId,
  discountCodeIdSchema,
  type StoredDiscountId,
  storedDiscountIdSchema,
} from "./persistence-contracts";

export type DiscountCodeConfiguration = {
  readonly id: DiscountCodeId;
  readonly discountId: StoredDiscountId;
  readonly enabled: boolean;
  readonly validFrom: Date | null;
  readonly validUntil: Date | null;
  readonly maxUses: number | null;
};

export type DiscountCodeAvailability = {
  readonly allowlistSize: number;
  readonly customerAllowed: boolean;
  readonly activeUseCount: number;
  readonly customerHasRedeemed: boolean;
};

export class DiscountCodeConfigurationError extends Data.TaggedError(
  "DiscountCodeConfigurationError"
)<{
  readonly codeId: DiscountCodeId;
  readonly message: string;
  readonly cause: unknown;
}> {}

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

export const decodeDiscountCodeConfiguration = Effect.fn(
  "DiscountCode.decodeConfiguration"
)((input: { readonly row: DiscountCode }) =>
  Schema.decodeUnknownEffect(discountCodeConfigurationSchema, {
    errors: "all",
    onExcessProperty: "error",
  })({
    id: input.row.id,
    discountId: input.row.discountId,
    code: input.row.code,
    enabled: input.row.enabled,
    validFrom: input.row.validFrom,
    validUntil: input.row.validUntil,
    maxUses: input.row.maxUses,
  }).pipe(
    Effect.map(({ code: _code, ...configuration }) => configuration),
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

const discountCodeConfigurationSchema = Schema.Struct({
  id: discountCodeIdSchema,
  discountId: storedDiscountIdSchema,
  code: canonicalDiscountCodeSchema,
  enabled: Schema.Boolean,
  validFrom: Schema.NullOr(Schema.DateValid),
  validUntil: Schema.NullOr(Schema.DateValid),
  maxUses: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
}).check(
  Schema.makeFilter(
    ({ validFrom, validUntil }) =>
      validFrom === null ||
      validUntil === null ||
      validUntil.getTime() > validFrom.getTime() || {
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
});

const uppercaseAscii = (value: string) =>
  value.replace(/[a-z]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 32)
  );
