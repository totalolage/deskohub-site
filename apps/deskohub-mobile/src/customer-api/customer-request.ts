import { Cause, Data, Duration, Effect, Exit, Option, Predicate } from "effect";
import type { Atom } from "effect/unstable/reactivity";
import { CustomerSessionCheck } from "./customer-api.service";
import { DotyposReadBudget } from "./dotypos-read-budget";

/**
 * How long one customer request may take. Dotypos-backed answers can be slow,
 * so this is generous; the server keeps running a mutation the app gave up
 * on, which is why a write that times out is unconfirmed, not failed.
 */
export const customerRequestTimeout = Duration.seconds(15);

/** A read got no answer in time. Nothing changed; it can be tried again. */
export class CustomerRequestTimedOut extends Data.TaggedError(
  "CustomerRequestTimedOut"
) {}

/**
 * A write may have been applied: it timed out, its connection broke, or its
 * answer was unreadable. Read the server state again before acting on it.
 */
export class CustomerWriteUnconfirmed extends Data.TaggedError(
  "CustomerWriteUnconfirmed"
)<{ readonly cause?: unknown }> {}

/**
 * On 401 the data layer asks the auth state to read the session again; the
 * sign-in guard redirects only if it is really gone.
 */
const recheckSessionWhenRequired = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.tapError(effect, (error) =>
    Predicate.isTagged(error, "CustomerSessionRequired")
      ? Effect.flatMap(
          Effect.service(CustomerSessionCheck),
          (session) => session.recheck
        )
      : Effect.void
  );

export interface CustomerReadOptions {
  /**
   * Whether the endpoint reads Dotypos (history, status, access, invoice,
   * account, marketing, referrals): it then spends the account's advisory
   * read budget.
   */
  readonly dotyposBacked: boolean;
}

/**
 * Runs one customer API read the way every screen should: bounded by the
 * request timeout, counted against the read budget when Dotypos-backed, and
 * re-checking the session on 401. Transient transport failures were already
 * retried once by the client.
 */
export const customerRead =
  ({ dotyposBacked }: CustomerReadOptions) =>
  <A, E, R>(request: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      if (dotyposBacked) yield* (yield* DotyposReadBudget).spend;
      return yield* request.pipe(
        Effect.timeoutOrElse({
          duration: customerRequestTimeout,
          orElse: () => Effect.fail(new CustomerRequestTimedOut()),
        })
      );
    }).pipe(recheckSessionWhenRequired);

// No answer, or an answer that couldn't be read: the server may have applied
// the write either way.
const isUnansweredWrite = (error: unknown) =>
  (Predicate.isTagged(error, "HttpClientError") &&
    Predicate.hasProperty(error, "reason") &&
    Predicate.isTagged(error.reason, "TransportError")) ||
  Predicate.isTagged(error, "SchemaError");

/**
 * Runs one customer API write: bounded by the request timeout, never retried,
 * and failing with `CustomerWriteUnconfirmed` when the outcome is unknown.
 */
export const customerWrite = <A, E, R>(request: Effect.Effect<A, E, R>) =>
  request.pipe(
    Effect.timeoutOrElse({
      duration: customerRequestTimeout,
      orElse: () => Effect.fail(new CustomerWriteUnconfirmed({})),
    }),
    Effect.catchIf(isUnansweredWrite, (cause) =>
      Effect.fail(new CustomerWriteUnconfirmed({ cause }))
    ),
    recheckSessionWhenRequired
  );

/** What a mutation atom can refresh: the `get` its function receives. */
export interface AtomRefresher {
  readonly refresh: <A>(atom: Atom.Atom<A>) => void;
}

/**
 * Refreshes the atoms a write changes once the server may hold a new state:
 * after success and after an unconfirmed write, so the screen shows what was
 * really saved. A refused write changed nothing and refreshes nothing.
 */
export const refreshAfterWrite =
  (get: AtomRefresher, atoms: ReadonlyArray<Atom.Atom<unknown>>) =>
  <A, E, R>(write: Effect.Effect<A, E, R>) =>
    Effect.onExit(write, (exit) =>
      Effect.sync(() => {
        if (writeMayHaveApplied(exit))
          for (const atom of atoms) get.refresh(atom);
      })
    );

const writeMayHaveApplied = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.match(exit, {
    onSuccess: () => true,
    onFailure: (cause) =>
      Option.exists(Cause.findErrorOption(cause), (error) =>
        Predicate.isTagged(error, "CustomerWriteUnconfirmed")
      ),
  });
