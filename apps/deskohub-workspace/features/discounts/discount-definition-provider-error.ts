import type { DatabaseError } from "@/db/database.service";
import type { DiscountDefinitionMalformedError } from "./discount-definition";
import type { DiscountDefinitionNotFoundError } from "./discount-definition.repository";
import { DiscountProviderError } from "./errors";

export type DiscountDefinitionError =
  | DatabaseError
  | DiscountDefinitionNotFoundError
  | DiscountDefinitionMalformedError;

export const toDiscountDefinitionProviderError = (
  cause: DiscountDefinitionError
) =>
  new DiscountProviderError({
    reason:
      cause._tag === "DatabaseError"
        ? "provider_failure"
        : "malformed_configuration",
    message:
      cause._tag === "DatabaseError"
        ? "Stored discount definitions could not be loaded."
        : "A referenced discount definition is unavailable.",
    cause,
  });
