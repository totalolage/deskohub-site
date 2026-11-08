import { Duration, Effect } from "effect";

/**
 * How long the sign-out request may run. The server already removed every
 * session and the native client clears the local one before it sends the
 * request, so the request adds nothing worth waiting for; a late answer
 * would only clear the session cache again, after a new sign-in.
 */
export const deletedAccountSignOutBound = Duration.seconds(5);

/**
 * After the server deleted the account: leave the signed-in screens for the
 * deleted-account screen, then end the local session. Leaving comes first:
 * the native sign-out clears the session before its request, so the guard
 * would show sign-in for the whole request, while the deleted-account screen
 * sits outside the guard. The sign-out runs however the leaving ends, and
 * its failure changes nothing for the customer. Run this outside the
 * account's data runtime: that registry ends with the screens this leaves.
 */
export const leaveDeletedAccount = <E, R>({
  leave,
  signOut,
}: {
  readonly leave: Effect.Effect<void>;
  readonly signOut: Effect.Effect<void, E, R>;
}) =>
  leave.pipe(
    Effect.ensuring(
      signOut.pipe(
        Effect.timeout(deletedAccountSignOutBound),
        Effect.ignoreCause
      )
    ),
    Effect.withSpan("Account.leaveDeletedAccount")
  );
