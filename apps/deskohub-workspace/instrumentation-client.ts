import "./shared/polyfills/temporal";

import { initBotId } from "botid/client/core";
import { env } from "./env";
import { initializeWorkspaceBotId } from "./shared/bot-protection/bot-protection.policy.js";

initializeWorkspaceBotId(env.NEXT_PUBLIC_VERCEL_ENV, () =>
  initBotId({
    protect: [
      {
        path: "/*/contact",
        method: "POST",
      },
      {
        path: "/*/checkout/order",
        method: "POST",
      },
      {
        path: "/*/checkout/pay",
        method: "POST",
      },
    ],
  })
);
