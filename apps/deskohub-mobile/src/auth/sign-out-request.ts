import { Data, Duration, Effect } from "effect";
import { abortableRequest } from "./abortable-request";
import { withSessionWriteLock } from "./session-write-lock";

/** The sign-out request failed; on native the stored cookie is gone anyway. */
export class SignOutFailure extends Data.TaggedError("SignOutFailure") {}

/**
 * How long a sign-out request may run before it is aborted. The native
 * client clears the stored session before it sends the request, so the
 * request only ends the session on the server, and every sign-in waits for
 * it: a sign-out that outlasts this leaves the server session to expire,
 * as a failed one does. This bounds the request, not the sign-out: an
 * abort can't stop a response already being stored, which is waited out
 * however long its writes take.
 */
export const signOutRequestBound = Duration.seconds(10);

/** The client call a sign-out sends, native or web. */
export interface SignOutClient {
  readonly signOut: (options: {
    readonly fetchOptions: { readonly signal: AbortSignal };
  }) => Promise<{ readonly error: unknown }>;
}

/**
 * Ends `client`'s session while it holds the app's session write lock, so no
 * sign-in stores a session that the sign-out's answer would then clear.
 */
export const signOutOf = (client: SignOutClient) =>
  withSessionWriteLock(
    abortableRequest(
      (signal) => client.signOut({ fetchOptions: { signal } }),
      () => new SignOutFailure()
    ).pipe(
      Effect.timeoutOrElse({
        duration: signOutRequestBound,
        orElse: () => Effect.fail(new SignOutFailure()),
      })
    )
  ).pipe(
    Effect.flatMap(({ error }) =>
      error === null ? Effect.void : Effect.fail(new SignOutFailure())
    ),
    Effect.withSpan("Auth.signOut")
  );
