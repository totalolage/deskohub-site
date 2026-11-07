import { expoClient } from "@better-auth/expo/client";
import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { resolveApiOrigin } from "./api-origin";

export const apiOrigin = resolveApiOrigin(
  process.env.EXPO_PUBLIC_API_ORIGIN,
  undefined
);

/**
 * The native Better Auth client. The Expo plugin keeps the session cookie in
 * SecureStore, sends it on every request with the `expo-origin` header the
 * server trusts, and restores the session on the next launch. Email sign-in
 * starts on the web bundle (BotID), so the native client only verifies tokens,
 * runs the passkey ceremonies, reads the session and signs out.
 */
export const authClient = createAuthClient({
  baseURL: `${apiOrigin}/api/auth`,
  plugins: [
    expoClient({
      scheme: "deskohub",
      storagePrefix: "deskohub",
      storage: SecureStore,
    }),
    magicLinkClient(),
  ],
});
