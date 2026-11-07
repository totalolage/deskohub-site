import { passkeyClient } from "@better-auth/passkey/client";
import { emailOTPClient, magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { resolveApiOrigin } from "./api-origin";
import { magicLinkSessionRefresh } from "./magic-link-session-refresh";

export const apiOrigin = resolveApiOrigin(
  process.env.EXPO_PUBLIC_API_ORIGIN,
  globalThis.location?.origin
);

/**
 * The web bundle's Better Auth client, served under `/app/` by the Workspace
 * itself, so the session is the site's own same-origin cookie. It mirrors the
 * site's browser client: magic link, sign-in code and passkeys.
 */
export const authClient = createAuthClient({
  baseURL: `${apiOrigin}/api/auth`,
  plugins: [
    magicLinkClient(),
    magicLinkSessionRefresh(),
    emailOTPClient(),
    passkeyClient(),
  ],
});
