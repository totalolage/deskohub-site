import { Effect, Option, Semaphore } from "effect";
import { PasskeyCeremonyBusy, type PasskeyFailure } from "./passkey-failure";

/** The passkey a registration ceremony saved to the account. */
export type AddedPasskey = {
  readonly id: string;
  readonly name: string | undefined;
};

/**
 * The passkey ceremonies of one platform. Native runs them through the
 * native passkey module and the Expo auth client, web through Better Auth's
 * browser passkey client.
 */
export type PasskeyCeremonies = {
  /** Whether this device or browser can run a passkey ceremony at all. */
  readonly isSupported: () => boolean;
  /**
   * Signs in with a passkey saved for the app's sign-in. On success the
   * session exists and the auth client has started refreshing it.
   */
  readonly signIn: Effect.Effect<void, PasskeyFailure>;
  /**
   * Saves a new passkey to the signed-in account. Needs a recent sign-in:
   * a stale one fails as `PasskeyRejected` with `needsReauthentication`.
   */
  readonly addPasskey: (input?: {
    readonly name?: string;
  }) => Effect.Effect<AddedPasskey, PasskeyFailure>;
};

/**
 * Runs the ceremonies one at a time. Every options request replaces the one
 * challenge cookie the server verifies against, and the platform shows one
 * passkey prompt at a time, so a ceremony that starts while another runs
 * fails as `PasskeyCeremonyBusy` without sending anything.
 */
export const oneCeremonyAtATime = (
  ceremonies: PasskeyCeremonies
): PasskeyCeremonies => {
  const permit = Semaphore.makeUnsafe(1);
  const exclusive = <A>(
    ceremony: Effect.Effect<A, PasskeyFailure>
  ): Effect.Effect<A, PasskeyFailure> =>
    permit
      .withPermitsIfAvailable(1)(ceremony)
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
