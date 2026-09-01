import "server-only";

import { Context, Layer } from "effect";
import { env } from "@/env";

export interface ResendWebhookRuntimeConfigObj {
  readonly apiKey?: string;
  readonly deploymentEnvironment: string;
  readonly webhookSecret: string;
}

export class ResendWebhookRuntimeConfig extends Context.Service<
  ResendWebhookRuntimeConfig,
  ResendWebhookRuntimeConfigObj
>()("@deskohub/workspace/ResendWebhookRuntimeConfig") {
  static Default = Layer.succeed(this, {
    apiKey: env.EMAIL_API_KEY,
    deploymentEnvironment: env.VERCEL_ENV,
    webhookSecret: env.RESEND_WEBHOOK_SECRET,
  } satisfies ResendWebhookRuntimeConfigObj);
}
