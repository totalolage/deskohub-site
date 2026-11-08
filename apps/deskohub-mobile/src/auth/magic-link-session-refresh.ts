import type { BetterAuthClientPlugin } from "better-auth/client";

/**
 * Better Auth's magic-link client leaves the session alone after a verify,
 * while a browser keeps the verify's cookie itself. Refreshing the session
 * lets the web callback page carry on signed in, as the code sign-in does.
 */
export const magicLinkSessionRefresh = () =>
  ({
    id: "magic-link-session-refresh",
    atomListeners: [
      {
        matcher: (path) => path === "/magic-link/verify",
        signal: "$sessionSignal",
      },
    ],
  }) satisfies BetterAuthClientPlugin;
