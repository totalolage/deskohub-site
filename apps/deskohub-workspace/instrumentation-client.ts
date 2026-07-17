import "./shared/polyfills/temporal";

import { initBotId } from "botid/client/core";
import { initializeWorkspaceBotId } from "./shared/bot-protection/bot-protection.policy.js";

initializeWorkspaceBotId(
  process.env.NEXT_PUBLIC_WORKSPACE_BOTID_VERCEL_ENV,
  () =>
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
