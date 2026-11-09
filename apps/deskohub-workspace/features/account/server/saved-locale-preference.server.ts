import "server-only";

import { Effect } from "effect";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { findSavedLocalePreference } from "@/features/account/backend/saved-locale-preference";

/**
 * The signed-in customer's saved locale preference, wired to the production
 * session read. The session read takes the request headers the caller
 * provides as `CurrentWorkspaceRequestHeaders`.
 */
export const savedLocalePreference = findSavedLocalePreference.pipe(
  Effect.provide(CustomerAuthentication.Default)
);
