import "server-only";

import { Context, Layer, Redacted } from "effect";
import { env } from "@/env";

/**
 * The secret PostHog's realtime webhook destination signs email status
 * signals with; absent until PostHog email is set up, and outside production.
 */
export class PostHogEmailWebhookConfig extends Context.Service<
  PostHogEmailWebhookConfig,
  {
    readonly signingSecret: Redacted.Redacted<string> | undefined;
  }
>()("@deskohub/workspace/PostHogEmailWebhookConfig") {
  static Default = Layer.sync(this, () => {
    const signingSecret = env.POSTHOG_EMAIL_WEBHOOK_SIGNING_SECRET?.trim();
    return {
      signingSecret: signingSecret ? Redacted.make(signingSecret) : undefined,
    };
  });
}
