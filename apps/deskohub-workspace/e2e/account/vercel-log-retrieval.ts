import { Effect, Stream } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import {
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import { addRedaction } from "../runtime";
import type { WorkspaceE2EAccountConfig } from "./config";

export const workspaceE2EPreviewE2ELogCode = "account.magic-link.preview-e2e";

const logLimit = 100;
const maxVercelResponseBytes = 2 * 1024 * 1024;
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

type VercelLogPage = {
  readonly hasMoreRows: boolean;
  readonly rows: readonly {
    readonly logs: readonly {
      readonly message: string;
      readonly messageTruncated: boolean;
    }[];
    readonly messageTruncated: boolean;
    readonly requestId: string;
    readonly timestampInMs: number;
  }[];
};

export type WorkspaceE2EMagicLinkRequest = {
  readonly callbackPath: string;
  readonly excludeLogEntryIds?: readonly string[];
  readonly recipient: string;
  readonly startedAt: Date;
  readonly pollIntervalMs?: number;
  readonly deadlineAfterMs?: number;
};

export type WorkspaceE2EPreviewLogs = {
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
  const response = yield* httpClient.execute(request).pipe(
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

const readVercelJson = Effect.fn("vercelLogRetrieval.readJson")(function* (
  response: Effect.Success<ReturnType<typeof requestVercel>>,
  invalidPayload: () => WorkspaceE2EError
) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  yield* Stream.runForEach(response.stream, (chunk) => {
    if (size + chunk.byteLength > maxVercelResponseBytes) {
      return Effect.fail(invalidPayload());
    }
    size += chunk.byteLength;
    chunks.push(chunk);
    return Effect.void;
  }).pipe(Effect.mapError(invalidPayload));

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return yield* Effect.try({
    catch: invalidPayload,
    try: () => JSON.parse(new TextDecoder().decode(bytes)),
  });
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

const resolveVercelDeployment = (
  config: WorkspaceE2EAccountConfig,
  timeoutMs = vercelRequestTimeoutMs
): Effect.Effect<VercelDeployment, WorkspaceE2EError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const url = new URL(
      `https://api.vercel.com/v13/deployments/${encodeURIComponent(config.expectedHost)}`
    );
    const response = yield* requestVercel(
      config,
      url,
      "resolve Vercel preview deployment",
      timeoutMs
    );
    const payload = yield* readVercelJson(
      response,
      invalidVercelDeploymentPayload
    );
    const decoded = decodeVercelDeployment(payload, config.vercelProjectId);
    if (decoded.kind === "invalid")
      return yield* invalidVercelDeploymentPayload();
    if (decoded.kind === "project-mismatch") {
      return yield* vercelDeploymentProjectMismatch();
    }
    return decoded.deployment;
  }).pipe(
    Effect.timeoutOrElse({
      duration: `${timeoutMs} millis`,
      orElse: () =>
        Effect.fail(
          vercelRequestFailure("resolve Vercel preview deployment", "timeout")
        ),
    })
  );

const decodeVercelLogPage = (
  payload: unknown,
  deploymentId: string
): VercelLogPage => {
  const candidate = payload as {
    hasMoreRows?: unknown;
    rows?: unknown;
  } | null;
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    Array.isArray(candidate)
  ) {
    throw invalidVercelLogPayload();
  }
  const hasMoreRows = candidate?.hasMoreRows ?? false;
  const rows = candidate?.rows ?? [];
  if (
    typeof hasMoreRows !== "boolean" ||
    !Array.isArray(rows) ||
    rows.length > logLimit
  ) {
    throw invalidVercelLogPayload();
  }

  return {
    hasMoreRows,
    rows: rows.map((row) => {
      const request = row as {
        deploymentId?: unknown;
        logs?: unknown;
        messageTruncated?: unknown;
        requestId?: unknown;
        timestamp?: unknown;
      } | null;
      const logs = request?.logs ?? [];
      let timestampInMs: number;
      if (typeof request?.timestamp === "number") {
        timestampInMs = request.timestamp;
      } else if (typeof request?.timestamp === "string") {
        timestampInMs = Date.parse(request.timestamp);
      } else {
        timestampInMs = Number.NaN;
      }
      if (
        typeof request?.requestId !== "string" ||
        request.requestId.length === 0 ||
        request.deploymentId !== deploymentId ||
        !Array.isArray(logs) ||
        !Number.isSafeInteger(timestampInMs) ||
        timestampInMs < 0 ||
        (request.messageTruncated !== undefined &&
          typeof request.messageTruncated !== "boolean")
      ) {
        throw invalidVercelLogPayload();
      }
      return {
        logs: logs.map((log) => {
          const entry = log as {
            message?: unknown;
            messageTruncated?: unknown;
          } | null;
          if (
            typeof entry?.message !== "string" ||
            (entry.messageTruncated !== undefined &&
              typeof entry.messageTruncated !== "boolean")
          ) {
            throw invalidVercelLogPayload();
          }
          return {
            message: entry.message,
            messageTruncated: entry.messageTruncated === true,
          };
        }),
        messageTruncated: request.messageTruncated === true,
        requestId: request.requestId,
        timestampInMs,
      };
    }),
  };
};

const requestVercelLogPage = (
  config: WorkspaceE2EAccountConfig,
  deployment: VercelDeployment,
  since: Date,
  endDate: number,
  page: number,
  timeoutMs: number
): Effect.Effect<VercelLogPage, WorkspaceE2EError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const url = new URL("https://vercel.com/api/logs/request-logs");
    url.searchParams.set("projectId", deployment.projectId);
    url.searchParams.set("ownerId", deployment.ownerId);
    url.searchParams.set("page", `${page}`);
    url.searchParams.set("startDate", `${since.getTime()}`);
    url.searchParams.set("endDate", `${endDate}`);
    url.searchParams.set("deploymentId", deployment.id);
    url.searchParams.set("search", workspaceE2EPreviewE2ELogCode);

    const response = yield* requestVercel(
      config,
      url,
      "query Vercel preview runtime logs",
      timeoutMs
    );
    const payload = yield* readVercelJson(response, invalidVercelLogPayload);
    return yield* Effect.try({
      catch: invalidVercelLogPayload,
      try: () => decodeVercelLogPage(payload, deployment.id),
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: `${timeoutMs} millis`,
      orElse: () =>
        Effect.fail(
          vercelRequestFailure("query Vercel preview runtime logs", "timeout")
        ),
    })
  );

const runLogQuery = (
  config: WorkspaceE2EAccountConfig,
  deployment: VercelDeployment,
  since: Date,
  timeoutMs: number
): Effect.Effect<
  readonly WorkspaceE2EVercelLogEntry[],
  WorkspaceE2EError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const endDate = Math.max(since.getTime(), Date.now());
    let page = 0;
    let requestRowCount = 0;
    const entries: WorkspaceE2EVercelLogEntry[] = [];

    while (requestRowCount < logLimit) {
      const result = yield* requestVercelLogPage(
        config,
        deployment,
        since,
        endDate,
        page,
        timeoutMs
      );
      if (result.rows.length === 0) {
        if (result.hasMoreRows) return yield* invalidVercelLogPayload();
        break;
      }
      if (result.rows.length > logLimit - requestRowCount) {
        return yield* invalidVercelLogPayload();
      }
      for (const row of result.rows) {
        entries.push(
          ...row.logs.map((log, logIndex) => ({
            id: `${row.requestId}:${logIndex}`,
            message: log.message,
            timestampInMs: row.timestampInMs,
            truncated: row.messageTruncated || log.messageTruncated,
          }))
        );
      }
      requestRowCount += result.rows.length;
      if (!result.hasMoreRows) break;
      if (requestRowCount >= logLimit) {
        return yield* invalidVercelLogPayload();
      }
      page += 1;
    }

    return entries;
  }).pipe(
    Effect.timeoutOrElse({
      duration: `${timeoutMs} millis`,
      orElse: () =>
        Effect.fail(
          vercelRequestFailure("query Vercel preview runtime logs", "timeout")
        ),
    })
  );

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

const retrieveWorkspaceE2EMagicLink = (
  config: WorkspaceE2EAccountConfig,
  request: WorkspaceE2EMagicLinkRequest
): Effect.Effect<string, WorkspaceE2EError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const deadline =
      Date.now() + (request.deadlineAfterMs ?? config.timeouts.authDelivery);
    const pollIntervalMs = request.pollIntervalMs ?? defaultPollIntervalMs;
    const metadataTimeoutMs = Math.min(
      vercelRequestTimeoutMs,
      deadline - Date.now()
    );
    if (metadataTimeoutMs <= 0) {
      return yield* vercelRequestFailure(
        "resolve Vercel preview deployment",
        "timeout"
      );
    }
    const deployment = yield* resolveVercelDeployment(
      config,
      metadataTimeoutMs
    );

    const body = yield* pollForLogMatch(config, deployment, {
      deadline,
      excludeLogEntryIds: request.excludeLogEntryIds ?? [],
      pollIntervalMs,
      recipient: request.recipient,
      startedAt: request.startedAt,
    });

    return yield* tryWorkspaceE2ESync("extract preview magic link", () => {
      const link = extractAuthLink(config, body, {
        callbackPath: request.callbackPath,
      });
      // Redact immediately upon extraction, before any error path, trace,
      // artifact, or failure output can observe the bearer material.
      addRedaction(link);
      addRedaction(new URL(link).searchParams.get("token") ?? "");
      return link;
    });
  });

const listSyntheticLogEntryIds = (
  config: WorkspaceE2EAccountConfig,
  request: { readonly recipient: string; readonly startedAt: Date }
): Effect.Effect<readonly string[], WorkspaceE2EError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const deployment = yield* resolveVercelDeployment(config);
    const entries = yield* runLogQuery(
      config,
      deployment,
      request.startedAt,
      vercelRequestTimeoutMs
    );
    return matchPreviewE2EEntries(entries, {
      excludeLogEntryIds: [],
      recipient: request.recipient,
      startedAt: request.startedAt,
    }).map((entry) => entry.id);
  });

const pollForLogMatch = (
  config: WorkspaceE2EAccountConfig,
  deployment: VercelDeployment,
  bounds: {
    readonly deadline: number;
    readonly excludeLogEntryIds: readonly string[];
    readonly pollIntervalMs: number;
    readonly recipient: string;
    readonly startedAt: Date;
  }
): Effect.Effect<string, WorkspaceE2EError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    while (true) {
      const remainingMs = bounds.deadline - Date.now();
      if (remainingMs <= 0) break;
      const entries = yield* runLogQuery(
        config,
        deployment,
        bounds.startedAt,
        Math.min(vercelRequestTimeoutMs, remainingMs)
      );
      if (Date.now() >= bounds.deadline) break;
      const matches = matchPreviewE2EEntries(entries, {
        excludeLogEntryIds: bounds.excludeLogEntryIds,
        recipient: bounds.recipient,
        startedAt: bounds.startedAt,
      });
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
        const body = parsePreviewE2ELogLine(match.message, bounds.recipient);
        if (body.kind !== "match") {
          return yield* workspaceE2EError(
            "Vercel log retrieval matched an unreadable preview log entry",
            {
              diagnosticCode: "auth_delivery_message_invalid",
              operation: "parse Vercel preview log entry",
            }
          );
        }
        return body.text;
      }
      const sleepRemainingMs = bounds.deadline - Date.now();
      if (sleepRemainingMs <= 0) break;
      yield* Effect.sleep(
        `${Math.min(bounds.pollIntervalMs, sleepRemainingMs)} millis`
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
      !excluded.has(entry.id) &&
      entry.timestampInMs >= bounds.startedAt.getTime() &&
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

const authLinkPattern = /https:\/\/[^\s"'<>\\]+/g;

const extractAuthLink = (
  config: WorkspaceE2EAccountConfig,
  body: string,
  expected: { readonly callbackPath: string }
): string => {
  const candidates = [...new Set(body.match(authLinkPattern) ?? [])].filter(
    (link) => isAuthLink(config, link, expected)
  );
  const [link] = candidates;
  if (candidates.length !== 1 || !link) {
    throw workspaceE2EError(
      "Vercel log retrieval did not return exactly one auth link for the exact preview",
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

export const resolveWorkspaceE2EPreviewLogs = (
  config: WorkspaceE2EAccountConfig
): Effect.Effect<WorkspaceE2EPreviewLogs, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    return {
      listSyntheticLogEntryIds: (request) =>
        listSyntheticLogEntryIds(config, request).pipe(
          Effect.provideService(HttpClient.HttpClient, httpClient)
        ),
      retrieveMagicLink: (request) =>
        retrieveWorkspaceE2EMagicLink(config, request).pipe(
          Effect.provideService(HttpClient.HttpClient, httpClient)
        ),
    };
  });
