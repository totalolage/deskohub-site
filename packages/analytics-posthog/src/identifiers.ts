import { Schema } from "effect";

export const PostHogProjectId = Schema.NonEmptyString.pipe(
  Schema.brand("PostHogProjectId")
).annotate({
  identifier: "PostHogProjectId",
  description: "Opaque identifier for a PostHog project.",
});
export type PostHogProjectId = typeof PostHogProjectId.Type;

export const PostHogDistinctId = Schema.NonEmptyString.pipe(
  Schema.brand("PostHogDistinctId")
).annotate({
  identifier: "PostHogDistinctId",
  description:
    "Identifier used by PostHog to distinguish an analytics subject.",
});
export type PostHogDistinctId = typeof PostHogDistinctId.Type;

export const PostHogSessionId = Schema.NonEmptyString.pipe(
  Schema.brand("PostHogSessionId")
).annotate({
  identifier: "PostHogSessionId",
  description: "Opaque identifier for a PostHog analytics session.",
});
export type PostHogSessionId = typeof PostHogSessionId.Type;

export const PostHogEventId = Schema.NonEmptyString.pipe(
  Schema.brand("PostHogEventId")
).annotate({
  identifier: "PostHogEventId",
  description: "Opaque identifier for an event stored by PostHog.",
});
export type PostHogEventId = typeof PostHogEventId.Type;
