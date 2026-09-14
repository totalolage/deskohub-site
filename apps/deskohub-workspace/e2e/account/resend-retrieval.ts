import { Effect, Schema } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/unstable/http";
import {
  toWorkspaceE2EError,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import { addRedaction } from "../runtime";
import type { WorkspaceE2EAccountConfig } from "./config";
import { workspaceE2EAuthCorrelationTags } from "./config";

const resendApiOrigin = "https://api.resend.com";
const listPageSize = 100;
/** Resend timestamps drift slightly; widen the window on the start boundary. */
const startedAtSkewMs = 2 * 60 * 1000;
const defaultPollIntervalMs = 5_000;

const listResponseSchema = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      created_at: Schema.String,
      id: Schema.String,
      to: Schema.Array(Schema.String),
    })
  ),
});

const retrievedEmailSchema = Schema.Struct({
  html: Schema.NullOr(Schema.String),
  tags: Schema.Array(
    Schema.Struct({ name: Schema.String, value: Schema.String })
  ),
  text: Schema.NullOr(Schema.String),
});

export type WorkspaceE2ERetrievedMessage = {
  readonly html: string | null;
  readonly tags: readonly { readonly name: string; readonly value: string }[];
  readonly text: string | null;
};

export type WorkspaceE2EMagicLinkRequest = {
  /** Message ids observed before this run's request; retrieval ignores them. */
  readonly excludeMessageIds?: readonly string[];
  readonly callbackPath: string;
  readonly recipient: string;
  readonly startedAt: Date;
  /** Test-only override; the runner always uses the checked-in timeout. */
  readonly pollIntervalMs?: number;
  /** Test-only override; the runner always uses the checked-in timeout. */
  readonly deadlineAfterMs?: number;
};

/**
 * Bounded Resend list/retrieve polling for one synthetic magic link. The
 * message is matched by exact recipient, the run's start window, and the
 * fixed correlation tags; exactly one match is tolerated. The bearer link is
 * parsed in memory, validated against the exact immutable preview origin and
 * callback, and registered with the redactor before it is returned. The
 * recipient, message body, URL, and token never reach logs or artifacts.
 */
export const retrieveWorkspaceE2EMagicLink = (
  config: WorkspaceE2EAccountConfig,
  request: WorkspaceE2EMagicLinkRequest
): Effect.Effect<string, WorkspaceE2EError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const deadline =
      Date.now() + (request.deadlineAfterMs ?? config.timeouts.authDelivery);
    const pollIntervalMs = request.pollIntervalMs ?? defaultPollIntervalMs;
    const minimumCreatedAt = request.startedAt.getTime() - startedAtSkewMs;

    const messageId = yield* pollForListMatch(config, {
      deadline,
      excludedMessageIds: request.excludeMessageIds ?? [],
      minimumCreatedAt,
      pollIntervalMs,
      recipient: request.recipient,
    });

    const retrieved = yield* retrieveMessage(config, messageId);
    yield* assertCorrelationTags(retrieved.tags);

    return yield* tryWorkspaceE2ESync("extract Resend magic link", () => {
      const link = extractAuthLink(config, retrieved, {
        callbackPath: request.callbackPath,
      });
      addRedaction(link);
      addRedaction(new URL(link).searchParams.get("token") ?? "");
      return link;
    });
  });

/**
 * Lists the ids of every synthetic message Resend currently holds for one
 * exact recipient. Cases capture this baseline before requesting a new link
 * so retrieval matches only the newly delivered message regardless of
 * provider clock drift.
 */
export const listSyntheticMessageIds = (
  config: WorkspaceE2EAccountConfig,
  recipient: string
): Effect.Effect<readonly string[], WorkspaceE2EError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const response = yield* resendRequest(
      config,
      `/emails?limit=${listPageSize}`
    ).pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError("list Resend synthetic messages", cause)
      )
    );
    const payload = yield* decodeResendResponse(response, listResponseSchema);
    return payload.data
      .filter((message) => message.to.includes(recipient))
      .map((message) => message.id);
  });

const pollForListMatch = (
  config: WorkspaceE2EAccountConfig,
  bounds: {
    readonly deadline: number;
    readonly excludedMessageIds: readonly string[];
    readonly minimumCreatedAt: number;
    readonly pollIntervalMs: number;
    readonly recipient: string;
  }
): Effect.Effect<string, WorkspaceE2EError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    while (Date.now() < bounds.deadline) {
      const matches = yield* listRecentMessages(config, bounds);
      if (matches.length > 1) {
        return yield* workspaceE2EError(
          "Resend retrieval matched multiple synthetic messages for the exact recipient",
          {
            diagnosticCode: "auth_delivery_message_ambiguous",
            operation: "list Resend synthetic messages",
          }
        );
      }
      const [match] = matches;
      if (match) return match;
      yield* Effect.sleep(`${bounds.pollIntervalMs} millis`);
    }
    return yield* workspaceE2EError(
      "Resend retrieval did not observe the synthetic magic-link message before the deadline",
      {
        diagnosticCode: "auth_delivery_message_not_observed",
        operation: "poll Resend synthetic messages",
      }
    );
  });

const listRecentMessages = (
  config: WorkspaceE2EAccountConfig,
  bounds: {
    readonly excludedMessageIds: readonly string[];
    readonly minimumCreatedAt: number;
    readonly recipient: string;
  }
): Effect.Effect<readonly string[], WorkspaceE2EError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const response = yield* resendRequest(
      config,
      `/emails?limit=${listPageSize}`
    ).pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError("list Resend synthetic messages", cause)
      )
    );
    const payload = yield* decodeResendResponse(response, listResponseSchema);
    return yield* tryWorkspaceE2ESync("match Resend synthetic messages", () =>
      matchSyntheticMessages(payload.data, bounds)
    );
  });

const matchSyntheticMessages = (
  data: readonly { created_at: string; id: string; to: readonly string[] }[],
  bounds: {
    readonly excludedMessageIds: readonly string[];
    readonly minimumCreatedAt: number;
    readonly recipient: string;
  }
) => {
  const excluded = new Set(bounds.excludedMessageIds);
  return data
    .filter(
      (message) =>
        !excluded.has(message.id) &&
        message.to.includes(bounds.recipient) &&
        parseResendCreatedAt(message.created_at) >= bounds.minimumCreatedAt
    )
    .map((message) => message.id);
};

const retrieveMessage = (
  config: WorkspaceE2EAccountConfig,
  messageId: string
): Effect.Effect<
  WorkspaceE2ERetrievedMessage,
  WorkspaceE2EError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const response = yield* resendRequest(
      config,
      `/emails/${encodeURIComponent(messageId)}`
    ).pipe(
      Effect.mapError((cause) =>
        workspaceE2EError("retrieve Resend synthetic message failed", {
          cause,
          diagnosticCode: "auth_delivery_message_retrieve_failed",
          operation: "retrieve Resend synthetic message",
        })
      )
    );
    const payload = yield* decodeResendResponse(response, retrievedEmailSchema);
    return payload;
  });

const resendRequest = (
  config: WorkspaceE2EAccountConfig,
  pathWithQuery: string
) =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.get(
      `${resendApiOrigin}${pathWithQuery}`
    ).pipe(HttpClientRequest.setHeaders(authorizationHeaders(config)));
    return yield* httpClient.execute(request);
  });

const authorizationHeaders = (config: WorkspaceE2EAccountConfig) => ({
  accept: "application/json",
  authorization: `Bearer ${config.resendApiKey}`,
});

const decodeResendResponse = <A>(
  response: HttpClientResponse.HttpClientResponse,
  schema: Schema.Decoder<A>
): Effect.Effect<A, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const body = yield* response.json.pipe(
      Effect.mapError(() =>
        workspaceE2EError(
          "Resend retrieval returned an unreadable message payload",
          {
            diagnosticCode: "auth_delivery_message_retrieve_failed",
            operation: "decode Resend message payload",
          }
        )
      )
    );
    return yield* Schema.decodeEffect(schema)(body).pipe(
      Effect.mapError(() =>
        workspaceE2EError(
          "Resend retrieval returned an unexpected message payload",
          {
            diagnosticCode: "auth_delivery_message_retrieve_failed",
            operation: "decode Resend message payload",
          }
        )
      )
    );
  });

const assertCorrelationTags = (
  tags: readonly { readonly name: string; readonly value: string }[]
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    for (const expected of workspaceE2EAuthCorrelationTags) {
      const matched = tags.some(
        (tag) => tag.name === expected.name && tag.value === expected.value
      );
      if (!matched) {
        return yield* workspaceE2EError(
          "Resend retrieval matched a synthetic message without the fixed correlation tags",
          {
            diagnosticCode: "auth_delivery_message_invalid",
            operation: "verify Resend correlation tags",
          }
        );
      }
    }
  });

const authLinkPattern = /https:\/\/[^\s"'<>\\]+/g;

const extractAuthLink = (
  config: WorkspaceE2EAccountConfig,
  message: { readonly html: string | null; readonly text: string | null },
  expected: { readonly callbackPath: string }
): string => {
  const body = `${message.text ?? ""}\n${message.html ?? ""}`;
  const candidates = [...new Set(body.match(authLinkPattern) ?? [])].filter(
    (link) => isAuthLink(config, link, expected)
  );
  const [link] = candidates;
  if (candidates.length !== 1 || !link) {
    throw workspaceE2EError(
      "Resend retrieval did not return exactly one auth link for the exact preview",
      {
        diagnosticCode: "auth_delivery_message_invalid",
        operation: "extract Resend magic link",
      }
    );
  }
  return link;
};

const isAuthLink = (
  config: WorkspaceE2EAccountConfig,
  link: string,
  expected: { readonly callbackPath: string }
) => {
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.host !== config.expectedHost) return false;
  if (parsed.pathname !== "/api/auth/magic-link/verify") return false;
  const callback = parsed.searchParams.get("callbackURL");
  if (!callback) return false;
  try {
    const callbackUrl = new URL(callback, config.baseUrl);
    return (
      callbackUrl.host === config.expectedHost &&
      callbackUrl.pathname === expected.callbackPath
    );
  } catch {
    return false;
  }
};

const parseResendCreatedAt = (value: string) => {
  const withoutSpace = value.includes("T") ? value : value.replace(" ", "T");
  const hourOnlyOffset = /([+-]\d\d)$/.exec(withoutSpace);
  let withZone = `${withoutSpace}Z`;
  if (hourOnlyOffset) {
    withZone = `${withoutSpace}:00`;
  } else if (/[z]|[+-]\d\d:\d\d$/i.test(withoutSpace)) {
    withZone = withoutSpace;
  }
  const parsed = Date.parse(withZone);
  if (Number.isNaN(parsed)) {
    throw workspaceE2EError(
      "Resend retrieval returned an unreadable message timestamp",
      {
        diagnosticCode: "auth_delivery_message_retrieve_failed",
        operation: "parse Resend message timestamp",
      }
    );
  }
  return parsed;
};
