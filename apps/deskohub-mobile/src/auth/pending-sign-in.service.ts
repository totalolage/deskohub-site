import { Context, Data, Effect, Layer, Option, Schema } from "effect";
import type * as SecureStore from "expo-secure-store";

/**
 * A native email sign-in the app started and hasn't finished: the PKCE
 * verifier only the app knows, the state the handoff must echo, and the
 * return URI the code was minted for. It lives in SecureStore so a callback
 * that cold-starts the app after the OS killed it can still finish.
 */
export interface PendingSignIn {
  readonly verifier: string;
  readonly state: string;
  readonly returnUri: string;
  readonly startedAt: number;
  /** Set for a reauthentication: the account the new session must match. */
  readonly expectedUserId?: string;
}

/** SecureStore couldn't read or write the pending sign-in. */
export class PendingSignInStorageFailure extends Data.TaggedError(
  "PendingSignInStorageFailure"
)<{ readonly cause: unknown }> {}

/** The SecureStore calls the pending sign-in needs. */
export type PendingSignInStore = Pick<
  typeof SecureStore,
  "getItemAsync" | "setItemAsync" | "deleteItemAsync"
>;

interface IPendingSignIns {
  readonly load: Effect.Effect<
    Option.Option<PendingSignIn>,
    PendingSignInStorageFailure
  >;
  readonly save: (
    pending: PendingSignIn
  ) => Effect.Effect<void, PendingSignInStorageFailure>;
  readonly clear: Effect.Effect<void, PendingSignInStorageFailure>;
}

export class PendingSignIns extends Context.Service<
  PendingSignIns,
  IPendingSignIns
>()("deskohub-mobile/PendingSignIns") {
  static fromStore(store: PendingSignInStore) {
    return Layer.succeed(PendingSignIns, makePendingSignIns(store));
  }
}

/** One attempt at a time: a new sign-in replaces an unfinished one. */
export const pendingSignInKey = "deskohub_pending_sign_in";

const pendingSignInSchema = Schema.fromJsonString(
  Schema.Struct({
    verifier: Schema.String,
    state: Schema.String,
    returnUri: Schema.String,
    startedAt: Schema.Finite,
    expectedUserId: Schema.optional(Schema.String),
  })
);
const decodePendingSignIn = Schema.decodeUnknownOption(pendingSignInSchema);

const storage = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new PendingSignInStorageFailure({ cause }),
  });

const makePendingSignIns = (store: PendingSignInStore): IPendingSignIns => ({
  load: storage(() => store.getItemAsync(pendingSignInKey)).pipe(
    // A value that no longer decodes is as good as none.
    Effect.map((raw) =>
      Option.fromNullishOr(raw).pipe(Option.flatMap(decodePendingSignIn))
    )
  ),
  save: (pending) =>
    storage(() =>
      store.setItemAsync(pendingSignInKey, JSON.stringify(pending))
    ),
  clear: storage(() => store.deleteItemAsync(pendingSignInKey)),
});
