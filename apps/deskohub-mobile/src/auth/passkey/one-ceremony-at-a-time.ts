import { Effect, Option, Semaphore } from "effect";
import { withSessionWriteLock } from "../session-write-lock";
import type { PasskeyCeremonyApi } from "./passkey-ceremony";
import { PasskeyCeremonyBusy, type PasskeyFailure } from "./passkey-failure";

/**
 * Runs the ceremonies one at a time. Every options request replaces the one
 * challenge cookie the server verifies against, and the platform shows one
 * passkey prompt at a time, so a ceremony that starts while another runs
 * fails as `PasskeyCeremonyBusy` without sending anything. A ceremony's
 * requests store cookies in the app's session (its challenge, and the
 * session a sign-in opens), so each holds the session write lock: it waits
 * for a sign-out in flight, and a sign-out waits for it.
 */
export const oneCeremonyAtATime = (
  ceremonies: PasskeyCeremonyApi
): PasskeyCeremonyApi => {
  const permit = Semaphore.makeUnsafe(1);
  const exclusive = <A>(
    ceremony: Effect.Effect<A, PasskeyFailure>
  ): Effect.Effect<A, PasskeyFailure> =>
    permit
      .withPermitsIfAvailable(1)(withSessionWriteLock(ceremony))
      .pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(new PasskeyCeremonyBusy()),
            onSome: Effect.succeed,
          })
        )
      );
  return {
    isSupported: ceremonies.isSupported,
    signIn: exclusive(ceremonies.signIn),
    addPasskey: (input) => exclusive(ceremonies.addPasskey(input)),
  };
};
