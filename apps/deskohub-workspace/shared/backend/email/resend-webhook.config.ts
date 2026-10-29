import "server-only";

import { Context, Layer } from "effect";
import { env } from "@/env";

export class ResendWebhookConfig extends Context.Service<
  ResendWebhookConfig,
  {
    readonly apiKey?: string;
    readonly deploymentEnvironment: string;
    readonly webhookSecret: string;
  }
>()("@deskohub/workspace/ResendWebhookConfig") {
  static Default = Layer.sync(this, () => ({
    apiKey: env.EMAIL_API_KEY,
    deploymentEnvironment: env.VERCEL_ENV,
    webhookSecret: env.RESEND_WEBHOOK_SECRET,
  }));
}
