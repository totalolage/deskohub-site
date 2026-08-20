import { Schema } from "effect";

export const cliAuthenticationRequestIdSchema = Schema.String.check(
  Schema.isPattern(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  )
)
  .pipe(Schema.brand("CliAuthenticationRequestId"))
  .annotate({
    identifier: "CliAuthenticationRequestId",
    description: "Database identifier for one CLI authentication request.",
  });

export type CliAuthenticationRequestId =
  typeof cliAuthenticationRequestIdSchema.Type;
