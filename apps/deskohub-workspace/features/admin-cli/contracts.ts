import { CliClientName, CliSessionId } from "@deskohub/workspace-admin-api";
import { Schema } from "effect";

export const renameCliSessionSchema = Schema.Struct({
  sessionId: CliSessionId,
  clientName: CliClientName,
});

export const renameCliSessionStandardSchema = Schema.toStandardSchemaV1(
  renameCliSessionSchema,
  {
    parseOptions: {
      errors: "all",
      onExcessProperty: "error",
    },
  }
);

export const cliSessionLifetimeUnits = [
  "hours",
  "days",
  "weeks",
  "months",
  "years",
] as const;

export const cliSessionLifetimeAmountLimits = {
  minimum: 1,
  maximum: 999,
} as const;

const cliSessionLifetimeAmountSchema = Schema.Int.check(
  Schema.isBetween(cliSessionLifetimeAmountLimits)
);

export const cliSessionLifetimeUnitSchema = Schema.Literals(
  cliSessionLifetimeUnits
);

/**
 * How long an approved CLI session stays valid. Calendar units are applied in
 * the site time zone, so a month or year follows the local calendar.
 */
export const cliSessionLifetimeSchema = Schema.TaggedUnion({
  Never: {},
  Duration: {
    amount: cliSessionLifetimeAmountSchema,
    unit: cliSessionLifetimeUnitSchema,
  },
});

export type CliSessionLifetime = typeof cliSessionLifetimeSchema.Type;

/** The duration amount as typed into the approval form. */
export const cliSessionLifetimeAmountFieldSchema = Schema.FiniteFromString.pipe(
  Schema.decodeTo(cliSessionLifetimeAmountSchema)
);

/** The duration fields as submitted by the approval form. */
export const cliSessionDurationFieldsSchema = Schema.Struct({
  amount: cliSessionLifetimeAmountFieldSchema,
  unit: cliSessionLifetimeUnitSchema,
});
