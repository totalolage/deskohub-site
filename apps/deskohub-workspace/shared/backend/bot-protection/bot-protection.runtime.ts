import { env } from "@/env";
import { getBotIdCheckOptionsForEnvironment } from "./bot-protection.options";

export const getBotIdCheckOptions = () =>
  getBotIdCheckOptionsForEnvironment({
    e2eBypass: env.WORKSPACE_E2E_BOTID_BYPASS,
    vercelEnvironment: env.VERCEL_ENV,
  });
