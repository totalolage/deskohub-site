import { expoClient } from "@better-auth/expo/client";
import type { BetterFetchOption } from "better-auth/client";
import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type * as SecureStore from "expo-secure-store";
import { type PreviewAccess, previewAccessHeaders } from "./preview-access";

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
  /** A development build's access to a deployment-protected preview. */
  readonly previewAccess?: PreviewAccess;
}

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
  previewAccess,
}: NativeAuthClientOptions) =>
  createAuthClient({
    baseURL: `${origin}/api/auth`,
    fetchOptions: {
      headers: previewAccessHeaders(previewAccess),
      ...(fetch === undefined ? {} : { customFetchImpl: fetch }),
    },
    plugins: [
      expoClient({ scheme: "deskohub", storagePrefix: "deskohub", storage }),
      magicLinkClient(),
    ],
  });

export type NativeAuthClient = ReturnType<typeof createNativeAuthClient>;
