import { env } from "@/env";
import { isWorkspaceBotIdEnforced } from "@/shared/bot-protection/bot-protection.policy.js";

export const isWorkspaceBotIdEnforcedAtRuntime = () =>
  isWorkspaceBotIdEnforced(env.VERCEL_ENV);
