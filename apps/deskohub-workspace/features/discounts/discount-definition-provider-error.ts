import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Match } from "effect";
import type { DiscountDefinitionMalformedError } from "./discount-definition";
import type { DiscountDefinitionNotFoundError } from "./discount-definition.repository";
import { DiscountProviderError } from "./errors";

export type DiscountDefinitionError =
  | EffectDrizzleQueryError
  | DiscountDefinitionNotFoundError
  | DiscountDefinitionMalformedError;

export const toDiscountDefinitionProviderError = (
  cause: DiscountDefinitionError
) =>
  Match.value(cause).pipe(
    Match.tag(
      "EffectDrizzleQueryError",
      DiscountProviderError.fromCause({
        reason: "provider_failure",
        message: "Stored discount definitions could not be loaded.",
      })
    ),
    Match.tag(
      "DiscountDefinitionNotFoundError",
      DiscountProviderError.fromCause({
        reason: "malformed_configuration",
        message: "A referenced discount definition is unavailable.",
      })
    ),
    Match.tag(
      "DiscountDefinitionMalformedError",
      DiscountProviderError.fromCause({
        reason: "malformed_configuration",
        message: "A referenced discount definition is unavailable.",
      })
    ),
    Match.exhaustive
  );
