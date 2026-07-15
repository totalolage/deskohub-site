import "./shared/polyfills/temporal";

import { initBotId } from "botid/client/core";

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
});
