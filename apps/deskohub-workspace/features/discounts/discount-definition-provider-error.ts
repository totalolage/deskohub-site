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
      (error) =>
        new DiscountProviderError({
          reason: "provider_failure",
          message: "Stored discount definitions could not be loaded.",
          cause: error,
        })
    ),
    Match.tag(
      "DiscountDefinitionNotFoundError",
      (error) =>
        new DiscountProviderError({
          reason: "malformed_configuration",
          message: "A referenced discount definition is unavailable.",
          cause: error,
        })
    ),
    Match.tag(
      "DiscountDefinitionMalformedError",
      (error) =>
        new DiscountProviderError({
          reason: "malformed_configuration",
          message: "A referenced discount definition is unavailable.",
          cause: error,
        })
    ),
    Match.exhaustive
  );
