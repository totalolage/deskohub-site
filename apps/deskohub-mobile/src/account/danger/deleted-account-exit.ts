import { Duration, Effect, Latch } from "effect";

/**
 * How long the sign-out request may run. The server already removed every
 * session and the native client clears the local one before it sends the
 * request, so the request adds nothing worth waiting for, and the
 * deleted-account screen's sign-in action never waits longer than this.
 */
export const deletedAccountSignOutBound = Duration.seconds(5);

export interface DeletedAccountExit {
  /**
   * After the server deleted the account: leave the signed-in screens for
   * the deleted-account screen, then end the local session. Leaving comes
   * first: the native sign-out clears the session before its request, so
   * the guard would show sign-in for the whole request, while the
   * deleted-account screen sits outside the guard. The sign-out runs however
   * the leaving ends, and its failure changes nothing for the customer. Run
   * it outside the account's data runtime: that registry ends with the
   * screens this leaves.
   */
  readonly leave: <E, R>(steps: {
    readonly leave: Effect.Effect<void>;
    readonly signOut: Effect.Effect<void, E, R>;
  }) => Effect.Effect<void, never, R>;
  /**
   * Waits until no exit's sign-out is in flight. A sign-out's answer clears
   * the stored session again, so a new sign-in waits for it first, or the
   * old answer would wipe the new session.
   *
   * Known limitation, shared with every sign-out (only src/auth can fix it):
   * @better-auth/expo clears the stored session before it sends /sign-out
   * (node_modules/@better-auth/expo/dist/client.js:448) and again when the
   * answer arrives (client.js:374). This latch only holds the
   * deleted-account screen's sign-in action. A sign-in that completes
   * elsewhere (such as a magic-link callback) while the request is in
   * flight, or an answer whose success hook is still writing when the bound
   * aborts the request, can still wipe the new session.
   */
  readonly settled: Effect.Effect<void>;
}

export const makeDeletedAccountExit = (): DeletedAccountExit => {
  // Open while no sign-out is in flight.
  const signedOut = Latch.makeUnsafe(true);
  return {
    leave: ({ leave, signOut }) =>
      signedOut.close.pipe(
        Effect.andThen(leave),
        Effect.ensuring(
          signOut.pipe(
            Effect.timeout(deletedAccountSignOutBound),
            Effect.ignoreCause
          )
        ),
        Effect.ensuring(signedOut.open),
        Effect.withSpan("Account.leaveDeletedAccount")
      ),
    settled: signedOut.await,
  };
};

/** The app's one deleted-account exit: the danger zone runs it, the deleted-account screen waits for it. */
export const deletedAccountExit = makeDeletedAccountExit();
