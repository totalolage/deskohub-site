import { Effect } from "effect";

/**
 * After the server deleted the account: end the local session, then leave
 * the signed-in screens for the deleted-account screen. It leaves however
 * the sign-out ends, failed or broken, since the server already removed
 * every session. Run it outside the account's data runtime: that registry ends
 * with the signed-in screens this leaves.
 */
export const leaveDeletedAccount = <E, R>({
  signOut,
  leave,
}: {
  readonly signOut: Effect.Effect<void, E, R>;
  readonly leave: Effect.Effect<void>;
}) =>
  signOut.pipe(
    Effect.ignoreCause,
    Effect.andThen(leave),
    Effect.withSpan("Account.leaveDeletedAccount")
  );
