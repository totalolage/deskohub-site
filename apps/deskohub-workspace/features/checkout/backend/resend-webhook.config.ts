import { Context } from "effect";

export interface ResendWebhookRuntimeConfigObj {
  readonly apiKey?: string;
  readonly deploymentEnvironment: string;
  readonly webhookSecret?: string;
}

export class ResendWebhookRuntimeConfig extends Context.Service<
  ResendWebhookRuntimeConfig,
  ResendWebhookRuntimeConfigObj
>()("@deskohub/workspace/ResendWebhookRuntimeConfig") {}
