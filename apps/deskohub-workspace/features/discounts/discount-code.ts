import { Data, Effect, Option, Schema } from "effect";
import type { DiscountCode } from "@/db/schema";
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

export type DiscountCodeConfiguration = {
  readonly id: DiscountCodeId;
  readonly discountId: StoredDiscountId;
  readonly enabled: boolean;
  readonly validFrom: Temporal.Instant | null;
  readonly validUntil: Temporal.Instant | null;
  readonly maxUses: number | null;
};

export type DiscountCodeAvailability = {
  readonly allowlistSize: number;
  readonly customerAllowed: boolean;
  readonly activeUseCount: number;
  readonly customerHasRedeemed: boolean;
  readonly customerHasReserved: boolean;
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
  validFrom: Schema.NullOr(TemporalInstantSchema),
  validUntil: Schema.NullOr(TemporalInstantSchema),
  maxUses: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
}).check(
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
});

const generatedDiscountCodeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

const uppercaseAscii = (value: string) =>
  value.replace(/[a-z]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 32)
  );
