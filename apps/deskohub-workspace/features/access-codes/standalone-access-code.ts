import { Schema } from "effect";

export const standaloneAccessCodeAttemptEventIdSchema =
  Schema.NonEmptyString.pipe(
    Schema.brand("StandaloneAccessCodeAttemptEventId")
  ).annotate({
    identifier: "StandaloneAccessCodeAttemptEventId",
    description:
      "Opaque identifier of one append-only standalone access-code attempt event.",
  });
export type StandaloneAccessCodeAttemptEventId =
  typeof standaloneAccessCodeAttemptEventIdSchema.Type;

export const standaloneAccessCodeAttemptEventKinds = [
  "started",
  "created",
  "rejected",
  "ambiguous",
  "reconciled",
] as const;
export type StandaloneAccessCodeAttemptEventKind =
  (typeof standaloneAccessCodeAttemptEventKinds)[number];

export const standaloneAccessCodeTerminalEventKinds = [
  "created",
  "rejected",
  "ambiguous",
] as const;
export type StandaloneAccessCodeTerminalEventKind =
  (typeof standaloneAccessCodeTerminalEventKinds)[number];

export type StandaloneAccessCodeProviderVariance = 2 | 3;

export const standaloneAccessCodeProviderVariances = [
  2, 3,
] satisfies readonly StandaloneAccessCodeProviderVariance[];

export const standaloneAccessCodeSources = ["admin-ui", "dhw-cli"] as const;
export type StandaloneAccessCodeSource =
  (typeof standaloneAccessCodeSources)[number];

export const standaloneAccessCodeFailureCodes = [
  "standalone_provider_rejected",
  "standalone_provider_ambiguous",
  "standalone_attempt_stale",
] as const;
export type StandaloneAccessCodeFailureCode =
  (typeof standaloneAccessCodeFailureCodes)[number];

export const standaloneAccessCodeAttemptStaleAfterMilliseconds = 60_000;

export type StandaloneAccessCodeCreationOutcome =
  | "rejected"
  | "ambiguous"
  | "in-progress"
  | "unavailable"
  | "cleanup-required"
  | "reconciled";
