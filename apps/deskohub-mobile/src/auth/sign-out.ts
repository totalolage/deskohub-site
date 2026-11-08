import { Data, Effect } from "effect";
import { authClient } from "./auth-client";

/** The sign-out request failed; on native the stored cookie is gone anyway. */
export class SignOutFailure extends Data.TaggedError("SignOutFailure") {}

/** Ends the session; on native the Expo client also clears SecureStore. */
export const signOut = Effect.tryPromise({
  try: (signal) => authClient.signOut({ fetchOptions: { signal } }),
  catch: () => new SignOutFailure(),
}).pipe(
  Effect.flatMap(({ error }) =>
    error === null ? Effect.void : Effect.fail(new SignOutFailure())
  ),
  Effect.withSpan("Auth.signOut")
);
