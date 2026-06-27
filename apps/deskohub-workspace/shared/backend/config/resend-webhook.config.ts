import { Layer } from "effect";
import { env } from "@/env";
import {
  ResendWebhookRuntimeConfig,
  type ResendWebhookRuntimeConfigObj,
} from "@/features/checkout/backend/resend-webhook.config";

export const ResendWebhookRuntimeConfigLive = Layer.succeed(
  ResendWebhookRuntimeConfig,
  {
    apiKey: env.EMAIL_API_KEY,
    deploymentEnvironment: env.VERCEL_ENV,
    webhookSecret: env.RESEND_WEBHOOK_SECRET,
  } satisfies ResendWebhookRuntimeConfigObj
);
