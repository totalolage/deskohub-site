"use client";

import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/client";
import { emailOTPClient, magicLinkClient } from "better-auth/client/plugins";

/**
 * The same-origin Better Auth browser client. It only performs magic-link,
 * sign-in code, and passkey requests, session refreshes, current-device
 * sign-outs, and the customer's answer on the AI assistant consent page; every
 * page and Server Action re-reads the authoritative server session. The OAuth
 * provider plugin adds the consent page's signed authorization request to
 * that answer.
 */
export const authClient = createAuthClient({
  plugins: [
    magicLinkClient(),
    emailOTPClient(),
    passkeyClient(),
    oauthProviderClient(),
  ],
});
