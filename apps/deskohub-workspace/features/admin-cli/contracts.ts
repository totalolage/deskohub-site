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

/**
 * How long an approved CLI session stays valid. Calendar units are applied in
 * the site time zone, so a month or year follows the local calendar.
 */
export const cliSessionLifetimeSchema = Schema.TaggedUnion({
  Never: {},
  Duration: {
    amount: Schema.FiniteFromString.pipe(
      Schema.decodeTo(
        Schema.Int.check(Schema.isBetween(cliSessionLifetimeAmountLimits))
      )
    ),
    unit: Schema.Literals(cliSessionLifetimeUnits),
  },
});

export type CliSessionLifetime = typeof cliSessionLifetimeSchema.Type;
