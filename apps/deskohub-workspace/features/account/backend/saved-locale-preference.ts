import { Effect } from "effect";
import { CustomerAccountAccessError } from "../customer-account";
import { CustomerAuthentication } from "./customer-authentication.service";

/**
 * The saved locale preference of the signed-in customer behind the current
 * request, read from the authoritative Better Auth session, which loads the
 * session, its user, and the user's locale in one query. Guests, unverified
 * accounts, and accounts without a saved preference have none. A
 * deletion-pending account keeps its preference until deletion completes. A failed read is logged and resolves to no preference, so the
 * guest locale chain still serves the page.
 */
export const findSavedLocalePreference = Effect.flatMap(
  CustomerAuthentication,
  (authentication) => authentication.currentUser
).pipe(
  Effect.map((session) => session?.localePreference),
  // Only an unavailable session read is a failure. No live session, an
  // unverified email, or unconfigured authentication means a guest.
  Effect.catchIf(
    (error) =>
      error instanceof CustomerAccountAccessError &&
      error.reason !== "unavailable",
    () => Effect.succeed(undefined)
  ),
  Effect.tapError(() =>
    Effect.logWarning(
      "The saved language preference could not be read; using the guest locale chain.",
      { code: "account.locale-preference.read" }
    )
  ),
  Effect.orElseSucceed(() => undefined),
  Effect.withSpan("SavedLocalePreference.find")
);
