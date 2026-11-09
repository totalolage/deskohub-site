import {
  expoClient,
  getCookie,
  storageAdapter,
} from "@better-auth/expo/client";
import type { BetterFetchOption } from "better-auth/client";
import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { Effect, type Semaphore } from "effect";
import type * as SecureStore from "expo-secure-store";
import { appSessionWriteLock } from "./session-write-lock";

/** The SecureStore calls the Expo plugin uses to keep the session cookie. */
export type SessionCookieStore = Pick<
  typeof SecureStore,
  "getItem" | "getItemAsync" | "setItem" | "setItemAsync"
>;

export interface NativeAuthClientOptions {
  readonly origin: string;
  readonly storage: SessionCookieStore;
  /** Replaces the network for tests; production uses the platform fetch. */
  readonly fetch?: BetterFetchOption["customFetchImpl"];
  /**
   * The lock every write to `storage` takes (see `SessionWriteLock`); the
   * app's own unless a test or a client over storage of its own passes one.
   */
  readonly sessionWriteLock?: Semaphore.Semaphore;
}

const storagePrefix = "deskohub";
/** Where the Expo plugin keeps the session cookie and the cached session. */
const sessionCookieKey = `${storagePrefix}_cookie`;
const sessionCacheKey = `${storagePrefix}_session_data`;

type ExpoPlugin = ReturnType<typeof expoClient>;
type StoreAnswer = ExpoPlugin["fetchPlugins"][number]["hooks"]["onSuccess"];

/**
 * Has the Expo plugin store a session read's answer only for the session the
 * read was sent with, and while no other change to the stored session runs.
 * The plugin caches every `/get-session` answer and merges its cookies into
 * storage, so an answer that arrives after a sign-out or a new sign-in
 * would bring back, or expire, a session the app no longer has. Better Auth
 * calls off superseded reads of its session atom, but `getSession` calls run
 * to the end.
 *
 * The answer is stored under the session write lock, so another change
 * waits for its writes. While another change holds the lock, the answer may
 * already be out of date and is not stored. The read still returns it, and
 * a later read answered outside a change stores the session as it is then.
 * Reads never wait for a change, so a holder of the lock may read the
 * session.
 */
const storingCurrentSessionReads = (
  plugin: ExpoPlugin,
  storage: SessionCookieStore,
  lock: Semaphore.Semaphore
): ExpoPlugin => {
  const cookies = storageAdapter(storage);
  return {
    ...plugin,
    fetchPlugins: plugin.fetchPlugins.map((fetchPlugin) => {
      const storeAnswer = fetchPlugin.hooks.onSuccess;
      const storeIfCurrent = (context: Parameters<StoreAnswer>[0]) =>
        Effect.promise(async () => {
          const sent = context.request.headers.get("cookie") ?? "";
          const stored = getCookie(
            await cookies.getItemAsync(sessionCookieKey)
          );
          if (stored === sent) await storeAnswer(context);
        });
      const storeCurrentAnswer: StoreAnswer = (context) =>
        new URL(context.request.url).pathname.endsWith("/get-session")
          ? Effect.runPromise(
              lock
                .withPermitsIfAvailable(1)(storeIfCurrent(context))
                .pipe(Effect.asVoid)
            )
          : storeAnswer(context);
      return {
        ...fetchPlugin,
        hooks: { ...fetchPlugin.hooks, onSuccess: storeCurrentAnswer },
      };
    }),
  };
};

/**
 * Builds the native Better Auth client. The Expo plugin keeps the session
 * cookie in `storage` under the `deskohub` prefix, sends it on every request
 * with the `expo-origin` header the server trusts, and restores the session
 * on the next launch.
 */
export const createNativeAuthClient = ({
  origin,
  storage,
  fetch,
  sessionWriteLock = appSessionWriteLock,
}: NativeAuthClientOptions) =>
  createAuthClient({
    baseURL: `${origin}/api/auth`,
    ...(fetch === undefined
      ? {}
      : { fetchOptions: { customFetchImpl: fetch } }),
    plugins: [
      storingCurrentSessionReads(
        expoClient({ scheme: "deskohub", storagePrefix, storage }),
        storage,
        sessionWriteLock
      ),
      magicLinkClient(),
    ],
  });

export type NativeAuthClient = ReturnType<typeof createNativeAuthClient>;

/**
 * Makes the session stored in `from` the one in `into`. The cached session
 * is cleared before the cookie is written and filled after it, so a move cut
 * short by the app closing doesn't pair one account's cookie with another's
 * cached session. The plugin's own adapter reads and writes the values,
 * chunks included, and like the plugin logs a failed write instead of
 * failing.
 */
export const moveSession = async (
  from: SessionCookieStore,
  into: SessionCookieStore
) => {
  const source = storageAdapter(from);
  const target = storageAdapter(into);
  const cookie = (await source.getItemAsync(sessionCookieKey)) ?? "{}";
  const cache = (await source.getItemAsync(sessionCacheKey)) ?? "{}";
  await target.setItemAsync(sessionCacheKey, "{}");
  await target.setItemAsync(sessionCookieKey, cookie);
  await target.setItemAsync(sessionCacheKey, cache);
};
