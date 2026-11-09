import "./shared/polyfills/temporal-installed";

import { initBotId } from "botid/client/core";
import { getClientEnv } from "./client-env";
import { initializeWorkspaceBotId } from "./shared/bot-protection/bot-protection.policy.js";

initializeWorkspaceBotId(getClientEnv().NEXT_PUBLIC_VERCEL_ENV, () =>
  initBotId({
    protect: [
      {
        path: "/*/contact",
        method: "POST",
      },
      {
        path: "/*/reservation/cowork",
        method: "POST",
      },
      {
        path: "/*/reservation/meeting-room",
        method: "POST",
      },
      {
        path: "/*/reservation/office",
        method: "POST",
      },
      {
        path: "/*/checkout/pay",
        method: "POST",
      },
      {
        path: "/*/reservation/invoice/*",
        method: "POST",
      },
      // Verified in the Better Auth guard for every sign-in email, code
      // sign-in, and review login password sign-in.
      {
        path: "/api/auth/sign-in/magic-link",
        method: "POST",
      },
      {
        path: "/api/auth/sign-in/email-otp",
        method: "POST",
      },
      {
        path: "/api/auth/sign-in/email",
        method: "POST",
      },
    ],
  })
);
