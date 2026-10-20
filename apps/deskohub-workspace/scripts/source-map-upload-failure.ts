/**
 * Describes a failed `posthog-cli sourcemap process` run without quoting it.
 * The CLI's output can carry the project API URL, response bodies, and
 * presigned S3 URLs with their query credentials, so the summary is built only
 * from the fixed vocabularies below. HTTP status codes are the only values it
 * copies from the output. Messages match `@posthog/cli` 0.16.2; recheck them
 * when upgrading the CLI.
 */
import type { CommandResult } from "./shared/command";

/** Starts the build-log line production-build.ts turns into a GitHub warning. */
export const skippedSourceMapUploadMarker =
  "PostHog source-map upload skipped:";

/**
 * - `transient`: PostHog or its storage is down or throttling, shown by a
 *   status or a transport cause that only an outage produces; a rerun can
 *   succeed.
 * - `permanent`: credentials, configuration, or the build output is wrong; a
 *   rerun fails the same way.
 * - `interrupted`: the CLI was killed, possibly while rewriting chunks, so
 *   the build output can't be trusted.
 * - `unknown`: nothing in the output identifies the cause, including a
 *   request the CLI couldn't send.
 */
export type SourceMapUploadFailureKind =
  | "transient"
  | "permanent"
  | "interrupted"
  | "unknown";

export interface SourceMapUploadFailure {
  readonly kind: SourceMapUploadFailureKind;
  /** Credential-free description, safe to print in build logs. */
  readonly summary: string;
}

type Evidence = {
  readonly pattern: RegExp;
  readonly label: string;
  readonly kind?: "transient" | "permanent";
};

/** CLI error contexts that say which step failed. */
const steps: readonly Evidence[] = [
  {
    pattern: /failed to get release from hash/,
    label: "looking up the release",
  },
  { pattern: /Failed to create release/, label: "creating the release" },
  { pattern: /While preparing files for upload/, label: "preparing files" },
  { pattern: /Failed to start upload/, label: "starting the upload" },
  { pattern: /Failed to upload chunk/, label: "uploading a chunk" },
  {
    pattern: /Failed to finalize symbol upload/,
    label: "finalizing the upload",
  },
  {
    pattern: /While cleaning up uploaded sourcemaps/,
    label: "deleting uploaded source maps",
    kind: "permanent",
  },
];

const causes: readonly Evidence[] = [
  {
    pattern: /Couldn't (?:find POSTHOG_CLI_API_KEY|load credentials)/,
    label: "missing credentials",
    kind: "permanent",
  },
  {
    pattern: /Invalid Personal API key/,
    label: "invalid personal API key",
    kind: "permanent",
  },
  { pattern: /Invalid Host/, label: "invalid host", kind: "permanent" },
  {
    pattern: /Invalid Environment ID/,
    label: "invalid project ID",
    kind: "permanent",
  },
  {
    pattern: /"[^"\n]*" does not exist/,
    label: "build directory missing",
    kind: "permanent",
  },
  {
    pattern: /no source files found/,
    label: "no source files found",
    kind: "permanent",
  },
  {
    pattern: /Release ID mismatch/,
    label: "release ID mismatch",
    kind: "permanent",
  },
  {
    pattern: /Content mismatch/,
    label: "symbol set content mismatch",
    kind: "permanent",
  },
  {
    pattern:
      /Failed to (?:parse|flatten|generate|serialize) (?:adjustment )?source ?map/i,
    label: "unreadable source map",
    kind: "permanent",
  },
  // Only an S3 chunk upload prints the transport cause chain, and only these
  // causes are an outage rather than a trust or configuration failure. Every
  // other request prints a bare `error sending request` whatever the cause,
  // so it stays unclassified.
  {
    pattern: /dns error|failed to lookup address/i,
    label: "DNS lookup failed",
    kind: "transient",
  },
  {
    pattern: /connection refused/i,
    label: "connection refused",
    kind: "transient",
  },
  {
    pattern: /connection reset/i,
    label: "connection reset",
    kind: "transient",
  },
  {
    pattern: /operation timed out/i,
    label: "request timed out",
    kind: "transient",
  },
  {
    pattern: /invalid peer certificate|received fatal alert|tls handshake/i,
    label: "TLS handshake failed",
    kind: "permanent",
  },
  {
    pattern: /connection closed|broken pipe|unexpected eof/i,
    label: "connection closed",
  },
  { pattern: /error sending request/i, label: "request not sent" },
];

/**
 * PostHog's API error types (`API error: error='<type>' …`). Other types are
 * reported as unrecognised rather than echoed.
 */
const apiErrorTypes: ReadonlyMap<string, "transient" | "permanent"> = new Map([
  ["authentication_error", "permanent"],
  ["invalid_request", "permanent"],
  ["validation_error", "permanent"],
  ["throttled_error", "transient"],
  ["server_error", "transient"],
]);

const transientStatuses: ReadonlySet<number> = new Set([408, 425, 429]);

const httpStatusKind = (status: number) =>
  transientStatuses.has(status) || status >= 500 ? "transient" : "permanent";

const firstMatch = (text: string, pattern: RegExp) => pattern.exec(text)?.[1];

const exitOutcome = (result: CommandResult) => {
  if (result.timedOut) return "timed out";
  if (result.signalCode !== null) return `was ended by ${result.signalCode}`;
  return `exited with code ${result.exitCode}`;
};

/**
 * Splits the output into the CLI's final error and what it logged before.
 * Earlier lines hold retried errors and S3 response bodies, so only the
 * final error decides the kind, apart from the S3 status a bare
 * `Request failed` points back to (see `httpStatuses`). Its API error comes last and quotes the
 * response body, so only the chain before it and the API error's own leading
 * fields are read. A body can also contain a line opening with `Oops! `; with
 * more than one such line the final error is ambiguous and read as nothing.
 */
const finalError = (output: string) => {
  const boundaries = Array.from(
    output.matchAll(/^Oops! /gm),
    ({ index }) => index
  );
  const errorAt = boundaries.length === 1 ? boundaries[0] : undefined;
  const error = errorAt === undefined ? "" : output.slice(errorAt);
  const apiErrorAt = error.indexOf("API error: ");
  return {
    ambiguous: boundaries.length > 1,
    history: errorAt === undefined ? output : output.slice(0, errorAt),
    chain: (apiErrorAt === -1 ? error : error.slice(0, apiErrorAt)).replaceAll(
      /\bfor url \([^)]*\)/g,
      "for url"
    ),
    apiError: apiErrorAt === -1 ? "" : error.slice(apiErrorAt),
  };
};

/**
 * Every distinct HTTP status the failure names, so more than one is a
 * conflict. An S3 chunk upload ends in a bare `Request failed`; the
 * response's status is in the error the CLI logged just before, ahead of the
 * response body. The body can repeat that line with any status, so every such
 * line is read: a body can echo the real status but never replace it.
 */
const httpStatuses = ({
  history,
  chain,
  apiError,
}: ReturnType<typeof finalError>) => {
  const status =
    firstMatch(apiError, /^API error: status='(\d{3})'/) ??
    firstMatch(chain, /\bHTTP status (?:client|server) error \((\d{3})\b/);
  if (status !== undefined) return [Number(status)];
  if (!/\d: Request failed\s*$/.test(chain)) return [];
  const s3Statuses = history.matchAll(
    /Request failed: Response \{[^\n]*?\bstatus: (\d{3})\b/g
  );
  return [
    ...new Set(Array.from(s3Statuses, ([, s3Status = ""]) => s3Status)),
  ].map(Number);
};

export const describeSourceMapUploadFailure = (
  result: CommandResult
): SourceMapUploadFailure => {
  const output = finalError(`${result.stdout}\n${result.stderr}`);
  const chainStep = steps.findLast(({ pattern }) => pattern.test(output.chain));
  // A step only the earlier log names still says where the run was.
  const step =
    chainStep ?? steps.findLast(({ pattern }) => pattern.test(output.history));
  const matchedCauses = causes.filter(({ pattern }) =>
    pattern.test(output.chain)
  );
  const statuses = httpStatuses(output);
  const status = statuses.length === 1 ? statuses[0] : undefined;
  const apiType = firstMatch(
    output.apiError,
    /^API error: error='([a-z_]+)' code='/
  );
  const apiTypeKind =
    apiType === undefined ? undefined : apiErrorTypes.get(apiType);

  const kinds = [
    ...(chainStep?.kind ? [chainStep.kind] : []),
    ...matchedCauses.flatMap(({ kind }) => (kind ? [kind] : [])),
    ...(status === undefined ? [] : [httpStatusKind(status)]),
    ...(apiTypeKind ? [apiTypeKind] : []),
  ];
  let kind: SourceMapUploadFailureKind;
  if (result.timedOut || result.signalCode !== null) kind = "interrupted";
  else if (kinds.includes("permanent")) kind = "permanent";
  // A response body may have supplied one of the statuses.
  else if (statuses.length > 1) kind = "unknown";
  else if (kinds.includes("transient")) kind = "transient";
  else kind = "unknown";

  const details = [
    ...(status === undefined ? [] : [`HTTP ${status}`]),
    ...(statuses.length > 1 ? ["conflicting HTTP statuses"] : []),
    ...(apiType === undefined
      ? []
      : [
          apiTypeKind
            ? `PostHog ${apiType}`
            : "unrecognised PostHog error type",
        ]),
    ...matchedCauses.map(({ label }) => label),
  ];
  const where = step ? ` while ${step.label}` : "";
  let what: string;
  if (output.ambiguous) what = "several final errors in its output";
  else if (details.length > 0) what = details.join(", ");
  else what = "no recognised error in its output";
  return {
    kind,
    summary: `posthog-cli ${exitOutcome(result)}${where}: ${what}`,
  };
};
