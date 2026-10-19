"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/client";
import { emailOTPClient, magicLinkClient } from "better-auth/client/plugins";
import { reportPasskeySignInOptions } from "./passkey-sign-in-options";

/**
 * The same-origin Better Auth browser client. It only performs magic-link,
 * sign-in code, and passkey requests, session refreshes, and current-device
 * sign-outs; every page and Server Action re-reads the authoritative server
 * session.
 */
export const authClient = createAuthClient({
  fetchOptions: {
    onResponse: (context) => {
      reportPasskeySignInOptions(context);
    },
  },
  plugins: [magicLinkClient(), emailOTPClient(), passkeyClient()],
});
