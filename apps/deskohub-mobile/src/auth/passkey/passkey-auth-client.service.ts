import { Context, Effect, Layer } from "effect";
import { PasskeyCeremonyFailed } from "./passkey-failure";

/** Better Auth's `{ data, error }` result of a `$fetch` with `throw: false`. */
export type AuthFetchResult =
  | { readonly data: unknown; readonly error: null }
  | {
      readonly data: unknown;
      readonly error: { readonly status: number; readonly code?: string };
    };

/** The parts of the native Better Auth client the passkey ceremonies use. */
export type PasskeyAuthClientSource = {
  readonly $fetch: (
    path: string,
    options: {
      readonly method: "GET" | "POST";
      readonly body?: unknown;
      readonly signal: AbortSignal;
      readonly throw: false;
    }
  ) => Promise<AuthFetchResult>;
  readonly $store: { readonly notify: (signal: "$sessionSignal") => void };
};

interface IPasskeyAuthClient {
  /**
   * One request to the auth API, relative to its `/api/auth` base URL. The
   * Expo client sends and stores its cookies, so the challenge cookie of an
   * options response returns with the verification.
   */
  readonly request: (
    path: string,
    options: { readonly method: "GET" | "POST"; readonly body?: unknown }
  ) => Effect.Effect<AuthFetchResult, PasskeyCeremonyFailed>;
  /** Tells the auth client its session changed. */
  readonly refreshSession: Effect.Effect<void>;
}

/** The native Better Auth client, as the passkey ceremonies reach it. */
export class PasskeyAuthClient extends Context.Service<
  PasskeyAuthClient,
  IPasskeyAuthClient
>()("deskohub-mobile/PasskeyAuthClient") {
  static fromClient = (client: PasskeyAuthClientSource) =>
    Layer.succeed(this, {
      request: (path, { method, body }) =>
        abortable((signal) =>
          client.$fetch(path, { method, body, signal, throw: false })
        ),
      refreshSession: Effect.sync(() => client.$store.notify("$sessionSignal")),
    });
}

/**
 * Sends a request that an interruption aborts and then waits out. The Expo
 * client may already be writing a response's cookies to SecureStore when the
 * abort comes, and `$fetch` settles only once that write is done, so the next
 * ceremony can't start before a stale challenge cookie lands.
 */
const abortable = (send: (signal: AbortSignal) => Promise<AuthFetchResult>) =>
  Effect.suspend(() => {
    const controller = new AbortController();
    const response = send(controller.signal);
    return Effect.tryPromise({
      try: () => response,
      catch: (cause) => new PasskeyCeremonyFailed({ step: "request", cause }),
    }).pipe(
      Effect.onInterrupt(() =>
        Effect.promise(() => {
          controller.abort();
          return response.then(
            () => undefined,
            () => undefined
          );
        })
      )
    );
  });
