import { Effect } from "effect";
import {
  toWorkspaceE2EError,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import { addRedaction } from "../runtime";
import type { WorkspaceE2EAccountConfig } from "./config";

/**
 * The structured payload the Preview runtime prints for synthetic magic-link
 * delivery (see the shared `@deskohub/email` Console provider,
 * packages/email/backend/providers/console-provider.ts). The fixed code is
 * the `--query` marker, and the individual log entry's recipient field must
 * equal the requesting case's exact synthetic recipient (case-insensitively)
 * for the entry to count as a match. Well-formed entries whose recipient
 * differs from the requested recipient are skipped so concurrent synthetic
 * recipients in the same query window do not fail the retrieval; entries
 * that cannot be parsed as a structured envelope fail closed.
 */
export const workspaceE2EPreviewE2ELogCode = "account.magic-link.preview-e2e";

const vercelCliVersion = "54.9.1";
const logLimit = 100;
/** One CLI invocation must never outlive a bounded slice of the deadline. */
const cliInvocationTimeoutMs = 30_000;
const defaultPollIntervalMs = 5_000;
/**
 * The injectable child-process boundary behind the pinned Vercel CLI. The
 * token always travels in the child environment, never in argv.
 */
export type WorkspaceE2EVercelLogsProcess = (command: {
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs: number;
}) => Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}>;

/**
 * The real process boundary: `bunx vercel@54.9.1` behind the base
 * environment captured once from the typed E2E environment.
 */
export const makeBunVercelLogsProcess = (
  baseEnv: Readonly<Record<string, string | undefined>>
): WorkspaceE2EVercelLogsProcess =>
  async function runVercelLogs({ args, env, timeoutMs }) {
    const process_ = Bun.spawn(
      ["bunx", `vercel@${vercelCliVersion}`, ...args],
      {
        env: { ...baseEnv, ...env },
        signal: AbortSignal.timeout(timeoutMs),
        stderr: "pipe",
        stdout: "pipe",
      }
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process_.stdout).text(),
      new Response(process_.stderr).text(),
      process_.exited,
    ]);
    return { exitCode, stderr, stdout };
  };

type WorkspaceE2EVercelLogRequest = {
  readonly id: string;
  readonly messageTruncated: boolean;
  readonly logs: readonly {
    readonly message: string;
    readonly messageTruncated: boolean;
  }[];
};

/** One flattened, matchable log record with its stable composite identity. */
type WorkspaceE2EVercelLogEntry = {
  readonly id: string;
  readonly message: string;
  readonly truncated: boolean;
};

export type WorkspaceE2EMagicLinkRequest = {
  readonly callbackPath: string;
  /** Log entry ids observed before the request; retrieval ignores them. */
  readonly excludeLogEntryIds?: readonly string[];
  /**
   * The exact synthetic recipient this retrieval serves. A preview-e2e log
   * line only counts as a match when its recipient field equals this
   * recipient (case-insensitively); the serial lane, the `--since` window,
   * and the baseline exclusions provide the remaining correlation.
   */
  readonly recipient: string;
  /** Bounded query window start; entries logged before it can never match. */
  readonly startedAt: Date;
  /** Test-only override; the runner always uses the checked-in timeout. */
  readonly pollIntervalMs?: number;
  /** Test-only override; the runner always uses the checked-in timeout. */
  readonly deadlineAfterMs?: number;
};

const vercelLogsArgs = (config: WorkspaceE2EAccountConfig, since: Date) => [
  "logs",
  "--deployment",
  config.baseUrl,
  "--json",
  "--limit",
  `${logLimit}`,
  "--since",
  since.toISOString(),
  "--query",
  workspaceE2EPreviewE2ELogCode,
  "--no-branch",
  "--project",
  config.vercelProjectId,
];

const runLogQuery = (
  config: WorkspaceE2EAccountConfig,
  since: Date
): Effect.Effect<readonly WorkspaceE2EVercelLogEntry[], WorkspaceE2EError> =>
  Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      catch: (cause) =>
        workspaceE2EError("query Vercel preview runtime logs failed", {
          cause,
          diagnosticCode: "auth_delivery_message_retrieve_failed",
          operation: "query Vercel preview runtime logs",
        }),
      try: () =>
        config.vercelLogsProcess({
          args: vercelLogsArgs(config, since),
          env: { VERCEL_TOKEN: config.vercelToken },
          timeoutMs: cliInvocationTimeoutMs,
        }),
    });
    if (result.exitCode !== 0) {
      return yield* workspaceE2EError(
        "query Vercel preview runtime logs failed",
        {
          diagnosticCode: "auth_delivery_message_retrieve_failed",
          operation: "query Vercel preview runtime logs",
        }
      );
    }
    return yield* tryWorkspaceE2ESync("decode Vercel runtime log entries", () =>
      decodeLogRequests(result.stdout)
    );
  });

/**
 * Decodes the CLI's bounded JSON Lines output: `vercel logs --json` writes
 * one JSON object per REQUEST line, `{ id, messageTruncated?, logs: [...] }`,
 * where each `logs[]` record is an individual `{ message, messageTruncated? }`
 * entry. Malformed lines fail closed; empty stdout is zero entries.
 */
const decodeLogRequests = (
  stdout: string
): readonly WorkspaceE2EVercelLogEntry[] => {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return [];

  return lines.flatMap((line) => {
    let payload: unknown;
    try {
      payload = JSON.parse(line);
    } catch {
      throw workspaceE2EError(
        "Vercel runtime logs returned an unreadable log payload",
        {
          diagnosticCode: "auth_delivery_message_retrieve_failed",
          operation: "decode Vercel runtime log entries",
        }
      );
    }
    return flattenLogRequest(payload);
  });
};

const flattenLogRequest = (
  payload: unknown
): readonly WorkspaceE2EVercelLogEntry[] => {
  const candidate = payload as {
    id?: unknown;
    messageTruncated?: unknown;
    logs?: unknown;
  } | null;
  if (
    typeof candidate?.id !== "string" ||
    candidate.id.length === 0 ||
    !Array.isArray(candidate.logs)
  ) {
    throw workspaceE2EError(
      "Vercel runtime logs returned a log request with unexpected shape",
      {
        diagnosticCode: "auth_delivery_message_retrieve_failed",
        operation: "decode Vercel runtime log entries",
      }
    );
  }
  // `messageTruncated` is optional at both the request and log-entry level;
  // absent means not truncated.
  const requestTruncated = candidate.messageTruncated === true;
  return candidate.logs.map((log, logIndex) => {
    const entry = log as {
      message?: unknown;
      messageTruncated?: unknown;
    } | null;
    if (typeof entry?.message !== "string") {
      throw workspaceE2EError(
        "Vercel runtime logs returned a log entry with unexpected shape",
        {
          diagnosticCode: "auth_delivery_message_retrieve_failed",
          operation: "decode Vercel runtime log entries",
        }
      );
    }
    return {
      id: `${candidate.id}:${logIndex}`,
      message: entry.message,
      truncated: requestTruncated || entry.messageTruncated === true,
    };
  });
};

/**
 * Result of parsing one code-matching log line's structured envelope.
 * `other-recipient` marks a well-formed entry that belongs to a different
 * synthetic recipient and must be skipped; `unreadable` marks a record that
 * cannot be parsed as a valid preview-e2e envelope (or whose body fails
 * validation for the requested recipient) and must fail closed.
 */
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

/**
 * Bounded Vercel runtime log retrieval for one synthetic magic link. The log
 * line is matched by the fixed preview-e2e code marker, the exact synthetic
 * recipient carried by the line, the pre-request time
 * window (`--since`), and the pre-request baseline ids; exactly one valid
 * match is tolerated. The bearer link is parsed in memory from the logged
 * text body, validated against the exact immutable preview origin and
 * callback, and registered with the redactor before it is returned. Raw CLI
 * output, the log body, the URL, and the token never reach logs or
 * artifacts.
 */
export const retrieveWorkspaceE2EMagicLink = (
  config: WorkspaceE2EAccountConfig,
  request: WorkspaceE2EMagicLinkRequest
): Effect.Effect<string, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const deadline =
      Date.now() + (request.deadlineAfterMs ?? config.timeouts.authDelivery);
    const pollIntervalMs = request.pollIntervalMs ?? defaultPollIntervalMs;

    const body = yield* pollForLogMatch(config, {
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

/**
 * Lists the preview-e2e runtime log entry ids the deployment currently holds
 * within the request window, as stable composite identities
 * `<requestId>:<logIndex>`. Cases capture this baseline before requesting a
 * new link so retrieval matches only the newly logged entry regardless of log
 * delivery timing.
 */
export const listSyntheticLogEntryIds = (
  config: WorkspaceE2EAccountConfig,
  request: WorkspaceE2EMagicLinkRequest
): Effect.Effect<readonly string[], WorkspaceE2EError> =>
  Effect.gen(function* () {
    const entries = yield* runLogQuery(config, request.startedAt).pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError("list synthetic preview log entries", cause)
      )
    );
    return matchPreviewE2EEntries(entries, {
      excludeLogEntryIds: request.excludeLogEntryIds ?? [],
      recipient: request.recipient,
    }).map((entry) => entry.id);
  });

const pollForLogMatch = (
  config: WorkspaceE2EAccountConfig,
  bounds: {
    readonly deadline: number;
    readonly excludeLogEntryIds: readonly string[];
    readonly pollIntervalMs: number;
    readonly recipient: string;
    readonly startedAt: Date;
  }
): Effect.Effect<string, WorkspaceE2EError> =>
  Effect.gen(function* () {
    while (Date.now() < bounds.deadline) {
      const entries = yield* runLogQuery(config, bounds.startedAt);
      const matches = matchPreviewE2EEntries(entries, {
        excludeLogEntryIds: bounds.excludeLogEntryIds,
        recipient: bounds.recipient,
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
      yield* Effect.sleep(`${bounds.pollIntervalMs} millis`);
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
  }
): readonly WorkspaceE2EVercelLogEntry[] => {
  const excluded = new Set(bounds.excludeLogEntryIds);
  const candidates = entries.filter(
    (entry) =>
      !excluded.has(entry.id) &&
      entry.message.includes(workspaceE2EPreviewE2ELogCode)
  );
  // A code-matching entry whose request or log record was truncated by the
  // log pipeline fails closed instead of being silently skipped, and counts
  // toward the exactly-one rule.
  if (candidates.some((entry) => entry.truncated)) {
    throw workspaceE2EError(
      "Vercel log retrieval matched a truncated preview log entry",
      {
        diagnosticCode: "auth_delivery_message_invalid",
        operation: "parse Vercel preview log entry",
      }
    );
  }
  // Well-formed entries for other synthetic recipients are skipped so a
  // shared query window does not fail the requested recipient's retrieval.
  // Entries that cannot be parsed as a structured envelope — including a
  // missing recipient or an invalid body for the requested recipient — fail
  // closed and count toward the exactly-one rule.
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
