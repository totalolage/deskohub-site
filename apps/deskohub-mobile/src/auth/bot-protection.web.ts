import { initBotId } from "botid/client/core";
import {
  botProtectedAuthRequests,
  isBotProtectionEnforced,
} from "./bot-protection-policy";

/**
 * Loads Vercel BotID for the sign-in email and code requests on the
 * production deployment, so the server's check passes for a real browser.
 */
export const initializeBotProtection = (): void => {
  if (
    isBotProtectionEnforced(
      process.env.EXPO_PUBLIC_VERCEL_ENV,
      globalThis.location?.origin
    )
  ) {
    initBotId({
      protect: botProtectedAuthRequests.map((rule) => ({ ...rule })),
    });
  }
};
