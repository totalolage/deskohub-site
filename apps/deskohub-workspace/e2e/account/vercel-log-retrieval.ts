import { Effect, Exit, Ref, Stream } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import {
  tryWorkspaceE2ESync,
  WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import { addRedaction } from "../runtime";
import type { WorkspaceE2EAccountConfig } from "./config";

export const workspaceE2EPreviewE2ELogCode = "account.magic-link.preview-e2e";

const logLimit = 100;
const maxLogLineLength = 64 * 1024;
const vercelRequestTimeoutMs = 30_000;
const defaultPollIntervalMs = 5_000;

type WorkspaceE2EVercelLogEntry = {
  readonly id: string;
  readonly message: string;
  readonly timestampInMs: number;
  readonly truncated: boolean;
};

type VercelDeployment = {
  readonly id: string;
  readonly ownerId: string;
  readonly projectId: string;
};

type VercelLogStreamState = {
  readonly chunksReceived: number;
  readonly completeLinesReceived: number;
  readonly entries: readonly WorkspaceE2EVercelLogEntry[];
  readonly status: "open" | "ended" | "failed" | "invalid" | "overflow";
};

export type WorkspaceE2EMagicLinkRequest = {
  readonly callbackPath: string;
  readonly excludeLogEntryIds?: readonly string[];
  readonly recipient: string;
  readonly startedAt: Date;
  readonly pollIntervalMs?: number;
  readonly deadlineAfterMs?: number;
};

export type WorkspaceE2EPreviewLogStream = {
  readonly listSyntheticLogEntryIds: (request: {
    readonly recipient: string;
    readonly startedAt: Date;
  }) => Effect.Effect<readonly string[], WorkspaceE2EError>;
  readonly retrieveMagicLink: (
    request: WorkspaceE2EMagicLinkRequest
  ) => Effect.Effect<string, WorkspaceE2EError>;
};

const invalidVercelLogPayload = () =>
  workspaceE2EError("Vercel runtime log payload was invalid", {
    diagnosticCode: "auth_delivery_message_invalid",
    operation: "decode Vercel runtime log entries",
  });

const vercelRequestFailure = (
  operation: string,
  reason: string,
  status?: number
) =>
  workspaceE2EError(
    `${operation} failed (${status === undefined ? reason : `HTTP ${status}`})`,
    {
      diagnosticCode: "auth_delivery_message_retrieve_failed",
      operation,
    }
  );

const requestVercel = Effect.fn("vercelLogRetrieval.request")(function* (
  config: WorkspaceE2EAccountConfig,
  url: URL,
  operation: string,
  timeoutMs: number
) {
  const httpClient = yield* HttpClient.HttpClient;
  const request = HttpClientRequest.get(url).pipe(
    HttpClientRequest.setHeaders({
      Accept: "application/json",
      Authorization: `Bearer ${config.vercelToken}`,
    })
  );
  const response = yield* HttpClient.withScope(httpClient)
    .execute(request)
    .pipe(
      Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
      Effect.mapError(() => vercelRequestFailure(operation, "request-failed")),
      Effect.timeoutOrElse({
        duration: `${timeoutMs} millis`,
        orElse: () => Effect.fail(vercelRequestFailure(operation, "timeout")),
      })
    );
  yield* Effect.annotateCurrentSpan("vercel.http.status_code", response.status);
  if (response.status < 200 || response.status >= 300) {
    return yield* vercelRequestFailure(
      operation,
      "request-failed",
      response.status
    );
  }
  return response;
});

const invalidVercelDeploymentPayload = () =>
  workspaceE2EError("Vercel preview deployment metadata was invalid", {
    diagnosticCode: "auth_delivery_message_retrieve_failed",
    operation: "resolve Vercel preview deployment",
  });

const vercelDeploymentProjectMismatch = () =>
  workspaceE2EError(
    "Vercel preview deployment did not match the configured project",
    {
      diagnosticCode: "auth_delivery_message_retrieve_failed",
      operation: "resolve Vercel preview deployment",
    }
  );

const decodeVercelDeployment = (
  payload: unknown,
  expectedProjectId: string
):
  | { readonly kind: "match"; readonly deployment: VercelDeployment }
  | { readonly kind: "invalid" }
  | { readonly kind: "project-mismatch" } => {
  const candidate = payload as {
    id?: unknown;
    ownerId?: unknown;
    projectId?: unknown;
  } | null;
  if (
    typeof candidate?.id !== "string" ||
    candidate.id.length === 0 ||
    typeof candidate.ownerId !== "string" ||
    candidate.ownerId.length === 0
  ) {
    return { kind: "invalid" };
  }
  if (candidate.projectId !== expectedProjectId) {
    return { kind: "project-mismatch" };
  }
  return {
    deployment: {
      id: candidate.id,
      ownerId: candidate.ownerId,
      projectId: candidate.projectId,
    },
    kind: "match",
  };
};

const resolveVercelDeployment = Effect.fn(
  function* (config: WorkspaceE2EAccountConfig) {
    const url = new URL(
      `https://api.vercel.com/v13/deployments/${encodeURIComponent(config.expectedHost)}`
    );
    const response = yield* requestVercel(
      config,
      url,
      "resolve Vercel preview deployment",
      vercelRequestTimeoutMs
    );
    const payload = yield* response.json.pipe(
      Effect.mapError(invalidVercelDeploymentPayload)
    );
    const decoded = decodeVercelDeployment(payload, config.vercelProjectId);
    if (decoded.kind === "invalid")
      return yield* invalidVercelDeploymentPayload();
    if (decoded.kind === "project-mismatch") {
      return yield* vercelDeploymentProjectMismatch();
    }
    return decoded.deployment;
  },
  Effect.timeoutOrElse({
    duration: `${vercelRequestTimeoutMs} millis`,
    orElse: () =>
      Effect.fail(
        vercelRequestFailure("resolve Vercel preview deployment", "timeout")
      ),
  })
);

const requestVercelLogStream = (
  config: WorkspaceE2EAccountConfig,
  deployment: VercelDeployment
) => {
  const url = new URL(
    `https://api.vercel.com/v1/projects/${encodeURIComponent(deployment.projectId)}/deployments/${encodeURIComponent(deployment.id)}/runtime-logs`
  );
  url.searchParams.set("format", "lines");
  return requestVercel(
    config,
    url,
    "open Vercel preview runtime log stream",
    vercelRequestTimeoutMs
  );
};

const decodeVercelLogLine = (
  line: string
): WorkspaceE2EVercelLogEntry | "ignored" | "invalid" => {
  let payload: unknown;
  try {
    payload = JSON.parse(line);
  } catch {
    return "invalid";
  }
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return "invalid";
  }
  const candidate = payload as {
    message?: unknown;
    messageTruncated?: unknown;
    rowId?: unknown;
    timestampInMs?: unknown;
  };
  if (typeof candidate.message !== "string") return "ignored";
  if (!candidate.message.includes(workspaceE2EPreviewE2ELogCode)) {
    return "ignored";
  }
  if (
    typeof candidate.rowId !== "string" ||
    candidate.rowId.length === 0 ||
    typeof candidate.timestampInMs !== "number" ||
    !Number.isSafeInteger(candidate.timestampInMs) ||
    candidate.timestampInMs < 0 ||
    (candidate.messageTruncated !== undefined &&
      typeof candidate.messageTruncated !== "boolean")
  ) {
    return "invalid";
  }
  return {
    id: candidate.rowId,
    message: candidate.message,
    timestampInMs: candidate.timestampInMs,
    truncated: candidate.messageTruncated === true,
  };
};

const consumeVercelLogStream = Effect.fn(function* (
  response: Effect.Success<ReturnType<typeof requestVercel>>,
  state: Ref.Ref<VercelLogStreamState>
) {
  let unfinishedLine = "";

  const storeLine = Effect.fn(function* (line: string) {
    yield* Ref.update(state, (current) => ({
      ...current,
      completeLinesReceived: current.completeLinesReceived + 1,
    }));
    if (line.length === 0) return;
    const decoded = decodeVercelLogLine(line);
    if (decoded === "invalid") {
      yield* Ref.update(state, (current) => ({
        ...current,
        status: "invalid" as const,
      }));
      return yield* invalidVercelLogPayload();
    }
    if (decoded === "ignored") return;

    const current = yield* Ref.get(state);
    if (current.entries.length >= logLimit) {
      yield* Ref.update(state, (value) => ({
        ...value,
        status: "overflow" as const,
      }));
      return yield* invalidVercelLogPayload();
    }
    yield* Ref.set(state, {
      ...current,
      entries: [...current.entries, decoded],
    });
  });

  const readChunks = Stream.runForEach(
    response.stream.pipe(Stream.decodeText),
    Effect.fn(function* (chunk) {
      yield* Ref.update(state, (current) => ({
        ...current,
        chunksReceived: current.chunksReceived + 1,
      }));
      let start = 0;
      while (start < chunk.length) {
        const newline = chunk.indexOf("\n", start);
        const end = newline === -1 ? chunk.length : newline;
        const part = chunk.slice(start, end);
        if (unfinishedLine.length + part.length > maxLogLineLength) {
          yield* Ref.update(state, (current) => ({
            ...current,
            status: "invalid" as const,
          }));
          return yield* invalidVercelLogPayload();
        }
        unfinishedLine += part;
        if (newline === -1) break;
        yield* storeLine(unfinishedLine);
        unfinishedLine = "";
        start = newline + 1;
      }
    })
  ).pipe(
    Effect.flatMap(() =>
      unfinishedLine.length > 0 ? storeLine(unfinishedLine) : Effect.void
    )
  );
  const exit = yield* Effect.exit(readChunks);
  yield* Ref.update(state, (current) => {
    let status = current.status;
    if (status !== "invalid" && status !== "overflow") {
      status = Exit.isFailure(exit) ? "failed" : "ended";
    }
    return { ...current, status };
  });
});

type PreviewE2ELogLineParseResult =
  | { readonly kind: "match"; readonly text: string }
  | { readonly kind: "other-recipient" }
  | { readonly kind: "unreadable" };

const parsePreviewE2ELogLine = (
  message: string,
  expectedRecipient: string
): PreviewE2ELogLineParseResult => {
  const trimmed = message.trim();
  if (!trimmed.startsWith("{")) return { kind: "unreadable" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { kind: "unreadable" };
  }
  const candidate = parsed as {
    code?: unknown;
    recipient?: unknown;
    text?: unknown;
  } | null;
  if (
    candidate?.code !== workspaceE2EPreviewE2ELogCode ||
    typeof candidate.recipient !== "string"
  ) {
    return { kind: "unreadable" };
  }
  if (candidate.recipient.toLowerCase() !== expectedRecipient.toLowerCase()) {
    return { kind: "other-recipient" };
  }
  if (typeof candidate.text !== "string" || candidate.text.length === 0) {
    return { kind: "unreadable" };
  }
  return { kind: "match", text: candidate.text };
};

const matchPreviewE2EEntries = (
  entries: readonly WorkspaceE2EVercelLogEntry[],
  bounds: {
    readonly excludeLogEntryIds: readonly string[];
    readonly recipient: string;
    readonly startedAt: Date;
  }
): readonly WorkspaceE2EVercelLogEntry[] => {
  const excluded = new Set(bounds.excludeLogEntryIds);
  const candidates = entries.filter(
    (entry) =>
      entry.timestampInMs >= bounds.startedAt.getTime() &&
      !excluded.has(entry.id) &&
      entry.message.includes(workspaceE2EPreviewE2ELogCode)
  );
  if (candidates.some((entry) => entry.truncated)) {
    throw workspaceE2EError(
      "Vercel log retrieval matched a truncated preview log entry",
      {
        diagnosticCode: "auth_delivery_message_invalid",
        operation: "parse Vercel preview log entry",
      }
    );
  }
  const matches: WorkspaceE2EVercelLogEntry[] = [];
  for (const entry of candidates) {
    const parsed = parsePreviewE2ELogLine(entry.message, bounds.recipient);
    if (parsed.kind === "other-recipient") continue;
    if (parsed.kind === "unreadable") {
      throw workspaceE2EError(
        "Vercel log retrieval matched an unreadable preview log entry",
        {
          diagnosticCode: "auth_delivery_message_invalid",
          operation: "parse Vercel preview log entry",
        }
      );
    }
    matches.push(entry);
  }
  return matches;
};

const readMatches = (
  entries: readonly WorkspaceE2EVercelLogEntry[],
  request: Pick<
    WorkspaceE2EMagicLinkRequest,
    "excludeLogEntryIds" | "recipient" | "startedAt"
  >
) =>
  Effect.try({
    try: () =>
      matchPreviewE2EEntries(entries, {
        excludeLogEntryIds: request.excludeLogEntryIds ?? [],
        recipient: request.recipient,
        startedAt: request.startedAt,
      }),
    catch: (failure) =>
      failure instanceof WorkspaceE2EError
        ? failure
        : invalidVercelLogPayload(),
  });

const streamStoppedFailure = (status: VercelLogStreamState["status"]) => {
  if (status === "invalid" || status === "overflow") {
    return invalidVercelLogPayload();
  }
  if (status === "failed") {
    return vercelRequestFailure(
      "query Vercel preview runtime logs",
      "request-failed"
    );
  }
  return workspaceE2EError(
    "Vercel preview runtime log stream ended before the magic-link entry was observed",
    {
      diagnosticCode: "auth_delivery_message_not_observed",
      operation: "poll Vercel preview runtime logs",
    }
  );
};

const makeLogStream = (
  config: WorkspaceE2EAccountConfig,
  state: Ref.Ref<VercelLogStreamState>
) => {
  const listSyntheticLogEntryIds: WorkspaceE2EPreviewLogStream["listSyntheticLogEntryIds"] =
    Effect.fn(function* (request) {
      const current = yield* Ref.get(state);
      if (current.status !== "open") {
        return yield* streamStoppedFailure(current.status);
      }
      const matches = yield* readMatches(current.entries, {
        excludeLogEntryIds: [],
        recipient: request.recipient,
        startedAt: request.startedAt,
      });
      return matches.map((entry) => entry.id);
    });

  const retrieveMagicLink: WorkspaceE2EPreviewLogStream["retrieveMagicLink"] =
    Effect.fn(function* (request) {
      const deadline =
        Date.now() + (request.deadlineAfterMs ?? config.timeouts.authDelivery);
      const pollIntervalMs = request.pollIntervalMs ?? defaultPollIntervalMs;
      const excludedIds = new Set(request.excludeLogEntryIds ?? []);
      const requestedAt = request.startedAt.getTime();

      while (Date.now() < deadline) {
        const current = yield* Ref.get(state);
        yield* Effect.annotateCurrentSpan({
          "e2e.account.magic_link.log_stream.chunks_received":
            current.chunksReceived,
          "e2e.account.magic_link.log_stream.complete_lines_received":
            current.completeLinesReceived,
          "e2e.account.magic_link.log_stream.retained_tagged_rows":
            current.entries.length,
          "e2e.account.magic_link.log_stream.rows_before_requested_at":
            current.entries.filter((entry) => entry.timestampInMs < requestedAt)
              .length,
          "e2e.account.magic_link.log_stream.excluded_id_rows":
            current.entries.filter((entry) => excludedIds.has(entry.id)).length,
          "e2e.account.magic_link.log_stream.state": current.status,
        });
        if (current.status === "invalid" || current.status === "overflow") {
          return yield* streamStoppedFailure(current.status);
        }
        const matches = yield* readMatches(current.entries, request);
        yield* Effect.annotateCurrentSpan(
          "e2e.account.magic_link.log_stream.matching_rows",
          matches.length
        );
        if (matches.length > 1) {
          return yield* workspaceE2EError(
            "Vercel log retrieval matched multiple preview log entries within the query window",
            {
              diagnosticCode: "auth_delivery_message_ambiguous",
              operation: "match Vercel preview runtime log entries",
            }
          );
        }
        const [match] = matches;
        if (match) {
          const body = parsePreviewE2ELogLine(match.message, request.recipient);
          if (body.kind !== "match") {
            return yield* workspaceE2EError(
              "Vercel log retrieval matched an unreadable preview log entry",
              {
                diagnosticCode: "auth_delivery_message_invalid",
                operation: "parse Vercel preview log entry",
              }
            );
          }
          return yield* tryWorkspaceE2ESync(
            "extract preview magic link",
            () => {
              const link = extractAuthLink(config, body.text, {
                callbackPath: request.callbackPath,
              });
              addRedaction(link);
              addRedaction(new URL(link).searchParams.get("token") ?? "");
              return link;
            }
          );
        }
        if (current.status !== "open") {
          return yield* streamStoppedFailure(current.status);
        }
        yield* Effect.sleep(
          `${Math.min(pollIntervalMs, Math.max(1, deadline - Date.now()))} millis`
        );
      }
      return yield* workspaceE2EError(
        "Vercel log retrieval did not observe the preview magic-link entry before the deadline",
        {
          diagnosticCode: "auth_delivery_message_not_observed",
          operation: "poll Vercel preview runtime logs",
        }
      );
    });

  return { listSyntheticLogEntryIds, retrieveMagicLink };
};

export const openWorkspaceE2EPreviewLogStream = Effect.fn(
  function* (config: WorkspaceE2EAccountConfig) {
    const deployment = yield* resolveVercelDeployment(config);
    const response = yield* requestVercelLogStream(config, deployment);
    const state = yield* Ref.make<VercelLogStreamState>({
      chunksReceived: 0,
      completeLinesReceived: 0,
      entries: [],
      status: "open",
    });
    yield* consumeVercelLogStream(response, state).pipe(Effect.forkScoped);
    return makeLogStream(config, state);
  },
  Effect.timeoutOrElse({
    duration: `${vercelRequestTimeoutMs} millis`,
    orElse: () =>
      Effect.fail(
        vercelRequestFailure(
          "open Vercel preview runtime log stream",
          "timeout"
        )
      ),
  })
);

const authLinkPattern = /https:\/\/[^\s"'<>\\]+/g;

const extractAuthLink = (
  config: WorkspaceE2EAccountConfig,
  body: string,
  expected: Pick<WorkspaceE2EMagicLinkRequest, "callbackPath">
): string => {
  const candidates = [...new Set(body.match(authLinkPattern) ?? [])].filter(
    (link) => isAuthLink(config, link, expected)
  );
  const [link] = candidates;
  if (candidates.length !== 1 || !link) {
    throw workspaceE2EError(
      "Vercel log retrieval did not contain exactly one auth link for the immutable preview callback",
      {
        diagnosticCode: "auth_delivery_message_invalid",
        operation: "extract preview magic link",
      }
    );
  }
  return link;
};

const isAuthLink = (
  config: WorkspaceE2EAccountConfig,
  link: string,
  expected: Pick<WorkspaceE2EMagicLinkRequest, "callbackPath">
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
  if (!parsed.searchParams.has("token")) return false;
  const callback = parsed.searchParams.get("callbackURL");
  if (!callback) return false;
  try {
    const callbackUrl = new URL(callback, config.baseUrl);
    return (
      callbackUrl.protocol === "https:" &&
      callbackUrl.host === config.expectedHost &&
      callbackUrl.pathname === expected.callbackPath
    );
  } catch {
    return false;
  }
};
