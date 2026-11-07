import { expoClient, storageAdapter } from "@better-auth/expo/client";
import type { BetterFetchOption } from "better-auth/client";
import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type * as SecureStore from "expo-secure-store";

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
}

const storagePrefix = "deskohub";
/** Where the Expo plugin keeps the session cookie and the cached session. */
const sessionCookieKey = `${storagePrefix}_cookie`;
const sessionCacheKey = `${storagePrefix}_session_data`;

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
}: NativeAuthClientOptions) =>
  createAuthClient({
    baseURL: `${origin}/api/auth`,
    ...(fetch === undefined
      ? {}
      : { fetchOptions: { customFetchImpl: fetch } }),
    plugins: [
      expoClient({ scheme: "deskohub", storagePrefix, storage }),
      magicLinkClient(),
    ],
  });

export type NativeAuthClient = ReturnType<typeof createNativeAuthClient>;

/**
 * Makes the session stored in `from` the one in `into`. The cached session
 * is cleared before the cookie is written and filled after it, so a move cut
 * short never pairs one account's cookie with another's cached session. The
 * plugin's own adapter reads and writes the values, chunks included.
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
