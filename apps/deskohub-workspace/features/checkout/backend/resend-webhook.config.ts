import { Context, Layer } from "effect";

export interface ResendWebhookRuntimeConfigObj {
  readonly apiKey?: string;
  readonly webhookSecret?: string;
}

export class ResendWebhookRuntimeConfig extends Context.Tag(
  "@deskohub/workspace/ResendWebhookRuntimeConfig"
)<ResendWebhookRuntimeConfig, ResendWebhookRuntimeConfigObj>() {}

export const makeResendWebhookRuntimeConfigLayer = (
  config: ResendWebhookRuntimeConfigObj
) => Layer.succeed(ResendWebhookRuntimeConfig, config);
