import { initBotId } from "botid/client/core";

// Initialize BotID protection for Next.js server actions
initBotId({
  protect: [
    // Protect all POST requests (Next.js server actions use POST)
    {
      path: "/*",
      method: "POST",
    },
  ],
});
