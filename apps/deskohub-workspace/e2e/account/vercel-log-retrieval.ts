import { Effect, Result } from "effect";
import { HttpClient } from "effect/unstable/http";
import {
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import {
  readVercelJson,
  requestVercel,
  resolveVercelDeployment,
  type TransientVercelRequestFailure,
  transientVercelRequestFailure,
  type VercelApiAccess,
  type VercelDeployment,
  vercelRequestTimeoutMs,
} from "../integrations/vercel";
import { addRedaction } from "../runtime";
import type { WorkspaceE2EAccountConfig } from "./config";

const workspaceE2EPreviewE2ELogCode = "account.magic-link.preview-e2e";

const logLimit = 100;
const defaultPollIntervalMs = 5_000;

type WorkspaceE2EVercelLogEntry = {
  readonly id: string;
  readonly message: string;
  readonly timestampInMs: number;
  readonly truncated: boolean;
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

type LogPollDiagnostics = {
  completedQueryCount: number;
  lastReturnedEntryCount: number;
  lastMarkerCount: number;
  baselineExcludedMarkerCount: number;
  beforeStartedAtMarkerCount: number;
  otherRecipientCandidateCount: number;
  matchingEntryCount: number;
  lastMarkerMinTimestampDeltaMs: number | undefined;
  lastMarkerMaxTimestampDeltaMs: number | undefined;
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
  readonly retrieveSignInEmail: (
    request: WorkspaceE2EMagicLinkRequest
  ) => Effect.Effect<
    { readonly link: string; readonly code: string },
    WorkspaceE2EError
  >;
};

const accountVercelFailures = {
  diagnosticCode: "auth_delivery_message_retrieve_failed",
} as const satisfies Pick<VercelApiAccess, "diagnosticCode">;

const accountVercelAccess = (config: WorkspaceE2EAccountConfig) => ({
  ...accountVercelFailures,
  expectedHost: config.expectedHost,
  vercelProjectId: config.vercelProjectId,
  vercelToken: config.vercelToken,
});

const invalidVercelLogPayload = () =>
  workspaceE2EError("Vercel runtime log payload was invalid", {
    diagnosticCode: "auth_delivery_message_invalid",
    operation: "decode Vercel runtime log entries",
  });

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
): Effect.Effect<
  VercelLogPage,
  WorkspaceE2EError | TransientVercelRequestFailure,
  HttpClient.HttpClient
> =>
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
      accountVercelAccess(config),
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
          transientVercelRequestFailure(
            accountVercelFailures,
            "query Vercel preview runtime logs",
            "timeout"
          )
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
  WorkspaceE2EError | TransientVercelRequestFailure,
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
          transientVercelRequestFailure(
            accountVercelFailures,
            "query Vercel preview runtime logs",
            "timeout"
          )
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

function retrieveWorkspaceE2EMagicLink(
  config: WorkspaceE2EAccountConfig,
  request: WorkspaceE2EMagicLinkRequest
): Effect.Effect<string, WorkspaceE2EError, HttpClient.HttpClient> {
  const diagnostics = makeLogPollDiagnostics();

  return retrieveWorkspaceE2EMagicLinkEffect(config, request, diagnostics).pipe(
    Effect.onExit(() =>
      Effect.suspend(() => annotateLogPollDiagnostics(diagnostics))
    )
  );
}

function retrieveWorkspaceE2ESignInEmail(
  config: WorkspaceE2EAccountConfig,
  request: WorkspaceE2EMagicLinkRequest
): Effect.Effect<
  { readonly link: string; readonly code: string },
  WorkspaceE2EError,
  HttpClient.HttpClient
> {
  const diagnostics = makeLogPollDiagnostics();

  return retrieveWorkspaceE2ESignInEmailEffect(
    config,
    request,
    diagnostics
  ).pipe(
    Effect.onExit(() =>
      Effect.suspend(() => annotateLogPollDiagnostics(diagnostics))
    )
  );
}

const makeLogPollDiagnostics = (): LogPollDiagnostics => ({
  completedQueryCount: 0,
  lastReturnedEntryCount: 0,
  lastMarkerCount: 0,
  baselineExcludedMarkerCount: 0,
  beforeStartedAtMarkerCount: 0,
  otherRecipientCandidateCount: 0,
  matchingEntryCount: 0,
  lastMarkerMinTimestampDeltaMs: undefined,
  lastMarkerMaxTimestampDeltaMs: undefined,
});

const retrieveWorkspaceE2EMagicLinkEffect = Effect.fn(
  "vercelLogRetrieval.retrieveMagicLink"
)(function* (
  config: WorkspaceE2EAccountConfig,
  request: WorkspaceE2EMagicLinkRequest,
  diagnostics: LogPollDiagnostics
) {
  const body = yield* retrieveWorkspaceE2EPreviewAuthBodyEffect(
    config,
    request,
    diagnostics
  );

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

const retrieveWorkspaceE2ESignInEmailEffect = Effect.fn(
  "vercelLogRetrieval.retrieveSignInEmail"
)(function* (
  config: WorkspaceE2EAccountConfig,
  request: WorkspaceE2EMagicLinkRequest,
  diagnostics: LogPollDiagnostics
) {
  const body = yield* retrieveWorkspaceE2EPreviewAuthBodyEffect(
    config,
    request,
    diagnostics
  );

  return yield* tryWorkspaceE2ESync("extract preview sign-in email", () => {
    const link = extractAuthLink(config, body, {
      callbackPath: request.callbackPath,
    });
    // Redact immediately upon extraction, before any error path, trace,
    // artifact, or failure output can observe the bearer material.
    addRedaction(link);
    addRedaction(new URL(link).searchParams.get("token") ?? "");

    const code = extractSignInCode(body);
    addRedaction(code, true);
    return { link, code };
  });
});

const retrieveWorkspaceE2EPreviewAuthBodyEffect = Effect.fn(
  "vercelLogRetrieval.retrievePreviewAuthBody"
)(function* (
  config: WorkspaceE2EAccountConfig,
  request: WorkspaceE2EMagicLinkRequest,
  diagnostics: LogPollDiagnostics
) {
  const deadline =
    Date.now() + (request.deadlineAfterMs ?? config.timeouts.authDelivery);
  const pollIntervalMs = request.pollIntervalMs ?? defaultPollIntervalMs;
  const deployment = yield* retryTransientVercelRequest(
    (timeoutMs) =>
      resolveVercelDeployment(accountVercelAccess(config), timeoutMs),
    {
      deadline,
      operation: "resolve Vercel preview deployment",
      pollIntervalMs,
    }
  ).pipe(
    Effect.catchTag("TransientVercelRequestFailure", ({ failure }) =>
      Effect.fail(failure)
    )
  );

  const body = yield* pollForLogMatch(config, deployment, {
    deadline,
    excludeLogEntryIds: request.excludeLogEntryIds ?? [],
    pollIntervalMs,
    recipient: request.recipient,
    startedAt: request.startedAt,
    diagnostics,
  });
  return body;
});

const listSyntheticLogEntryIds = (
  config: WorkspaceE2EAccountConfig,
  request: { readonly recipient: string; readonly startedAt: Date }
): Effect.Effect<readonly string[], WorkspaceE2EError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const bounds = {
      deadline: Date.now() + config.timeouts.providerTransition,
      pollIntervalMs: defaultPollIntervalMs,
    };
    const deployment = yield* retryTransientVercelRequest(
      (timeoutMs) =>
        resolveVercelDeployment(accountVercelAccess(config), timeoutMs),
      { ...bounds, operation: "resolve Vercel preview deployment" }
    ).pipe(
      Effect.catchTag("TransientVercelRequestFailure", ({ failure }) =>
        Effect.fail(failure)
      )
    );
    const entries = yield* retryTransientVercelRequest(
      (timeoutMs) =>
        runLogQuery(config, deployment, request.startedAt, timeoutMs),
      { ...bounds, operation: "query Vercel preview runtime logs" }
    ).pipe(
      Effect.catchTag("TransientVercelRequestFailure", ({ failure }) =>
        Effect.fail(failure)
      )
    );
    return matchPreviewE2EMarkerEntries(
      selectPreviewE2EMarkerEntries(entries),
      {
        excludeLogEntryIds: [],
        recipient: request.recipient,
        startedAt: request.startedAt,
      }
    ).map((entry) => entry.id);
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
    readonly diagnostics: LogPollDiagnostics;
  }
): Effect.Effect<string, WorkspaceE2EError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    let historyObserved = false;
    while (true) {
      const remainingMs = bounds.deadline - Date.now();
      if (remainingMs <= 0) break;
      // A request still in flight when the deadline clips it is not a
      // provider failure once history has already answered without the entry.
      const entries = yield* retryTransientVercelRequest(
        (timeoutMs) =>
          runLogQuery(config, deployment, bounds.startedAt, timeoutMs),
        {
          deadline: bounds.deadline,
          operation: "query Vercel preview runtime logs",
          pollIntervalMs: bounds.pollIntervalMs,
        }
      ).pipe(
        Effect.catchTag("TransientVercelRequestFailure", (transient) =>
          Effect.succeed(undefined).pipe(
            Effect.filterOrFail(
              () => historyObserved && transient.timedOut,
              () => transient.failure
            )
          )
        )
      );
      if (entries === undefined) break;
      const markerEntries = selectPreviewE2EMarkerEntries(entries);
      recordLogPollResponse(
        bounds.diagnostics,
        entries,
        markerEntries,
        bounds.startedAt
      );
      if (Date.now() >= bounds.deadline) break;
      historyObserved = true;
      const matches = matchPreviewE2EMarkerEntries(
        markerEntries,
        {
          excludeLogEntryIds: bounds.excludeLogEntryIds,
          recipient: bounds.recipient,
          startedAt: bounds.startedAt,
        },
        bounds.diagnostics
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

const retryTransientVercelRequest = <A, R>(
  request: (
    timeoutMs: number
  ) => Effect.Effect<A, WorkspaceE2EError | TransientVercelRequestFailure, R>,
  bounds: {
    readonly deadline: number;
    readonly operation: string;
    readonly pollIntervalMs: number;
  }
): Effect.Effect<A, WorkspaceE2EError | TransientVercelRequestFailure, R> =>
  Effect.gen(function* () {
    let lastFailure = transientVercelRequestFailure(
      accountVercelFailures,
      bounds.operation,
      "timeout"
    );
    while (true) {
      const remainingMs = bounds.deadline - Date.now();
      if (remainingMs <= 0) return yield* lastFailure;
      const result = yield* request(
        Math.min(vercelRequestTimeoutMs, remainingMs)
      ).pipe(Effect.result);
      if (Result.isSuccess(result)) return result.success;
      if (result.failure._tag === "WorkspaceE2EError") {
        return yield* result.failure;
      }
      lastFailure = result.failure;
      const sleepRemainingMs = bounds.deadline - Date.now();
      if (sleepRemainingMs <= 0) return yield* lastFailure;
      yield* Effect.sleep(
        `${Math.min(bounds.pollIntervalMs, sleepRemainingMs)} millis`
      );
    }
  });

const selectPreviewE2EMarkerEntries = (
  entries: readonly WorkspaceE2EVercelLogEntry[]
): readonly WorkspaceE2EVercelLogEntry[] =>
  entries.filter((entry) =>
    entry.message.includes(workspaceE2EPreviewE2ELogCode)
  );

const recordLogPollResponse = (
  diagnostics: LogPollDiagnostics,
  entries: readonly WorkspaceE2EVercelLogEntry[],
  markerEntries: readonly WorkspaceE2EVercelLogEntry[],
  startedAt: Date
) => {
  // Cumulative filter counts span processed complete queries; last-response
  // counts and deltas are replaced for each completed query, including one
  // that returns after the deadline and therefore is not matched.
  diagnostics.completedQueryCount += 1;
  diagnostics.lastReturnedEntryCount = entries.length;
  diagnostics.lastMarkerCount = markerEntries.length;

  const timestampDeltas = markerEntries.map(
    (entry) => entry.timestampInMs - startedAt.getTime()
  );
  diagnostics.lastMarkerMinTimestampDeltaMs =
    timestampDeltas.length > 0 ? Math.min(...timestampDeltas) : undefined;
  diagnostics.lastMarkerMaxTimestampDeltaMs =
    timestampDeltas.length > 0 ? Math.max(...timestampDeltas) : undefined;
};

const annotateLogPollDiagnostics = (diagnostics: LogPollDiagnostics) =>
  Effect.annotateCurrentSpan({
    "e2e.account.log_poll.completed_query_count_cumulative":
      diagnostics.completedQueryCount,
    "e2e.account.log_poll.last_returned_entry_count":
      diagnostics.lastReturnedEntryCount,
    "e2e.account.log_poll.last_marker_count": diagnostics.lastMarkerCount,
    "e2e.account.log_poll.baseline_excluded_marker_count_cumulative":
      diagnostics.baselineExcludedMarkerCount,
    "e2e.account.log_poll.before_started_at_marker_count_cumulative":
      diagnostics.beforeStartedAtMarkerCount,
    "e2e.account.log_poll.other_recipient_candidate_count_cumulative":
      diagnostics.otherRecipientCandidateCount,
    "e2e.account.log_poll.matching_entry_count_cumulative":
      diagnostics.matchingEntryCount,
    ...(diagnostics.lastMarkerMinTimestampDeltaMs === undefined
      ? {}
      : {
          "e2e.account.log_poll.last_marker_min_timestamp_delta_ms":
            diagnostics.lastMarkerMinTimestampDeltaMs,
        }),
    ...(diagnostics.lastMarkerMaxTimestampDeltaMs === undefined
      ? {}
      : {
          "e2e.account.log_poll.last_marker_max_timestamp_delta_ms":
            diagnostics.lastMarkerMaxTimestampDeltaMs,
        }),
  });

const matchPreviewE2EMarkerEntries = (
  markerEntries: readonly WorkspaceE2EVercelLogEntry[],
  bounds: {
    readonly excludeLogEntryIds: readonly string[];
    readonly recipient: string;
    readonly startedAt: Date;
  },
  diagnostics?: LogPollDiagnostics
): readonly WorkspaceE2EVercelLogEntry[] => {
  const excluded = new Set(bounds.excludeLogEntryIds);
  const candidates: WorkspaceE2EVercelLogEntry[] = [];
  for (const entry of markerEntries) {
    if (excluded.has(entry.id)) {
      if (diagnostics) diagnostics.baselineExcludedMarkerCount += 1;
      continue;
    }
    if (entry.timestampInMs < bounds.startedAt.getTime()) {
      if (diagnostics) diagnostics.beforeStartedAtMarkerCount += 1;
      continue;
    }
    candidates.push(entry);
  }
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
    if (parsed.kind === "other-recipient") {
      if (diagnostics) diagnostics.otherRecipientCandidateCount += 1;
      continue;
    }
    if (parsed.kind === "unreadable") {
      throw workspaceE2EError(
        "Vercel log retrieval matched an unreadable preview log entry",
        {
          diagnosticCode: "auth_delivery_message_invalid",
          operation: "parse Vercel preview log entry",
        }
      );
    }
    if (diagnostics) diagnostics.matchingEntryCount += 1;
    matches.push(entry);
  }
  return matches;
};

const authLinkPattern = /https:\/\/[^\s"'<>\\]+/g;
const signInCodePattern = /^[ \t]*(\d{6})[ \t]*$/gm;

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

const extractSignInCode = (body: string): string => {
  const candidates = [
    ...new Set(
      [...body.matchAll(signInCodePattern)].map(([, code]) => code ?? "")
    ),
  ];
  const [code] = candidates;
  if (candidates.length !== 1 || !code) {
    throw workspaceE2EError(
      "Vercel log retrieval did not return exactly one sign-in code for the exact preview",
      {
        diagnosticCode: "auth_delivery_message_invalid",
        operation: "extract preview sign-in code",
      }
    );
  }
  return code;
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
      retrieveSignInEmail: (request) =>
        retrieveWorkspaceE2ESignInEmail(config, request).pipe(
          Effect.provideService(HttpClient.HttpClient, httpClient)
        ),
    };
  });
