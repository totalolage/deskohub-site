import { Context, Effect, Semaphore } from "effect";

/**
 * Lets one change to the app's stored session run at a time: a sign-out, a
 * sign-in's acceptance, or a passkey ceremony. Better Auth's Expo client
 * clears the stored session before it sends a sign-out
 * (`@better-auth/expo/dist/client.js:448`) and again when the answer arrives
 * (`client.js:374`), and on the web the answer's cookie expires the session
 * cookie. A sign-in that stored its session in between would be wiped, so a
 * sign-in can't start or finish storing its session while a sign-out is in
 * flight, and a sign-out waits for a sign-in that is storing one. Each
 * holder must settle its storage writes before it ends, even when it is
 * interrupted (see `abortableRequest`).
 *
 * A Reference, so every runtime (the native auth runtime, the passkey
 * runtime and the standalone one) shares the one default lock without
 * wiring; tests provide their own.
 */
export const SessionWriteLock = Context.Reference<Semaphore.Semaphore>(
  "deskohub-mobile/SessionWriteLock",
  { defaultValue: () => Semaphore.makeUnsafe(1) }
);

/** Runs `change` once it holds the app's session write lock. */
export const withSessionWriteLock = <A, E, R>(
  change: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.flatMap(Effect.service(SessionWriteLock), (lock) =>
    lock.withPermit(change)
  );
