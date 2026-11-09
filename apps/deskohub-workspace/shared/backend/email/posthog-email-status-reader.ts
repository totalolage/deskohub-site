import "server-only";

import type { EmailDeliveryId } from "@deskohub/email";
import {
  Context,
  Duration,
  type Effect,
  Layer,
  Option,
  Redacted,
} from "effect";
import { env } from "@/env";
import { byStage } from "@/shared/deployment/deployment-stage";
import {
  fetchPostHogEmailStatus,
  type PostHogEmailStatusClientConfig,
  type PostHogEmailStatusError,
  type PostHogEmailStatusLookup,
} from "./posthog-email-status-client";

interface IPostHogEmailStatusReader {
  /** None when this deployment has no PostHog email secret key. */
  readonly read: Option.Option<
    (
      messageId: EmailDeliveryId
    ) => Effect.Effect<PostHogEmailStatusLookup, PostHogEmailStatusError>
  >;
}

/** Reads PostHog's status of a tracked email. */
export class PostHogEmailStatusReader extends Context.Service<
  PostHogEmailStatusReader,
  IPostHogEmailStatusReader
>()("@deskohub/workspace/PostHogEmailStatusReader") {
  static Live = Layer.sync(
    this,
    (): IPostHogEmailStatusReader => ({
      read: Option.map(
        getPostHogEmailStatusClientConfig(env),
        (config) => (messageId) => fetchPostHogEmailStatus(config, messageId)
      ),
    })
  );
}

type PostHogEmailStatusEnvironment = Pick<
  typeof env,
  "POSTHOG_API_HOST" | "POSTHOG_EMAIL_SECRET_KEY" | "VERCEL_ENV"
>;

/**
 * The status client's settings; none without an email secret key. Like the
 * other provider timeouts, a read waits briefly in production and generously
 * elsewhere.
 */
export const getPostHogEmailStatusClientConfig = (
  environment: PostHogEmailStatusEnvironment
): Option.Option<PostHogEmailStatusClientConfig> =>
  Option.fromUndefinedOr(environment.POSTHOG_EMAIL_SECRET_KEY).pipe(
    Option.filter((secretKey) => secretKey.trim() !== ""),
    Option.map((secretKey) => ({
      secretKey: Redacted.make(secretKey),
      host: environment.POSTHOG_API_HOST,
      timeout: byStage(environment.VERCEL_ENV, {
        production: Duration.seconds(5),
        otherwise: Duration.seconds(30),
      }),
    }))
  );
