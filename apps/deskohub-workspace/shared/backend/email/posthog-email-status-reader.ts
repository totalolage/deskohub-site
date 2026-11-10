import "server-only";

import type { EmailDeliveryId } from "@deskohub/email";
import {
  fetchPostHogEmailStatus,
  type PostHogEmailStatusError,
  type PostHogEmailStatusLookup,
} from "@deskohub/email-posthog";
import { Context, Effect, Layer, Option } from "effect";
import { configuredPostHogEmailConnection } from "@/shared/backend/config/posthog-email.config";

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
  /** Reads through the project that sends campaign email, when there is one. */
  static Live = Layer.effect(
    this,
    configuredPostHogEmailConnection.pipe(
      Effect.map(
        (connection): IPostHogEmailStatusReader => ({
          read: Option.map(
            connection,
            (configured) => (messageId) =>
              fetchPostHogEmailStatus(configured, messageId)
          ),
        })
      )
    )
  );
}
