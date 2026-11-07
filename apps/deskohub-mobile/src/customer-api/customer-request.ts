import {
  Cause,
  Data,
  Duration,
  Effect,
  Exit,
  Option,
  Predicate,
  Ref,
} from "effect";
import type { Atom } from "effect/unstable/reactivity";
import { CustomerSessionCheck } from "./customer-api.service";
import { CustomerRequestDispatch } from "./customer-request-dispatch";
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

// The customer API answers 401 with `CustomerSessionRequired`; Better Auth's
// own endpoints with `CustomerAuthRejected` "unauthorized".
const isSessionGone = (error: unknown) =>
  Predicate.isTagged(error, "CustomerSessionRequired") ||
  (Predicate.isTagged(error, "CustomerAuthRejected") &&
    Predicate.hasProperty(error, "reason") &&
    error.reason === "unauthorized");

/**
 * On 401 the data layer asks the auth state to read the session again; the
 * sign-in guard redirects only if it is really gone.
 */
const recheckSessionWhenRequired = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.tapError(effect, (error) =>
    isSessionGone(error)
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
 * request timeout, each attempt counted against the read budget when
 * Dotypos-backed, and re-checking the session on 401. Transient transport
 * failures were already retried once by the client.
 */
export const customerRead =
  ({ dotyposBacked }: CustomerReadOptions) =>
  <A, E, R>(request: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const budget = yield* DotyposReadBudget;
      return yield* request.pipe(
        Effect.provideService(CustomerRequestDispatch, {
          onSend: dotyposBacked ? budget.spend : Effect.void,
        }),
        Effect.timeoutOrElse({
          duration: customerRequestTimeout,
          orElse: () => Effect.fail(new CustomerRequestTimedOut()),
        })
      );
    }).pipe(recheckSessionWhenRequired);

const unansweredReasons = new Set([
  "TransportError",
  // The answer's body couldn't be read.
  "DecodeError",
  "EmptyBodyError",
  // An answer the contract doesn't declare, such as a gateway 502 or 504.
  "StatusCodeError",
]);

// No answer, or one that couldn't be read. Once the request left the device,
// the server may have applied the write either way; a `SchemaError` then comes
// from decoding the answer (an invalid payload fails before sending).
const isUnanswered = (error: unknown) =>
  (Predicate.isTagged(error, "HttpClientError") &&
    Predicate.hasProperty(error, "reason") &&
    Predicate.hasProperty(error.reason, "_tag") &&
    typeof error.reason._tag === "string" &&
    unansweredReasons.has(error.reason._tag)) ||
  Predicate.isTagged(error, "SchemaError");

/**
 * Runs one customer API write: bounded by the request timeout, never retried,
 * and failing with `CustomerWriteUnconfirmed` when it was sent but its outcome
 * is unknown. A write that never left the device keeps its own failure (or
 * `CustomerRequestTimedOut`): nothing was applied.
 */
export const customerWrite = <A, E, R>(request: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const sent = yield* Ref.make(false);
    const unconfirmedOnceSent = <F>(
      failure: F,
      cause?: unknown
    ): Effect.Effect<never, F | CustomerWriteUnconfirmed> =>
      Effect.flatMap(
        Ref.get(sent),
        (wasSent): Effect.Effect<never, F | CustomerWriteUnconfirmed> =>
          wasSent
            ? Effect.fail(new CustomerWriteUnconfirmed({ cause }))
            : Effect.fail(failure)
      );
    return yield* request.pipe(
      Effect.provideService(CustomerRequestDispatch, {
        onSend: Ref.set(sent, true),
      }),
      Effect.timeoutOrElse({
        duration: customerRequestTimeout,
        orElse: () => unconfirmedOnceSent(new CustomerRequestTimedOut()),
      }),
      Effect.catchIf(isUnanswered, (failure) =>
        unconfirmedOnceSent(failure, failure)
      )
    );
  }).pipe(recheckSessionWhenRequired);

/**
 * Refreshes the atoms a write changes once the server may hold a new state:
 * after success and after an unconfirmed write, so the screen shows what was
 * really saved. A refused write changed nothing and refreshes nothing.
 */
export const refreshAfterWrite =
  // biome-ignore lint/suspicious/noExplicitAny: any atom's value type
    (get: Atom.FnContext, atoms: ReadonlyArray<Atom.Atom<any>>) =>
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
