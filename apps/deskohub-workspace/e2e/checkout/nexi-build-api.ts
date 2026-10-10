// Nexi hosted-field API calls (card data, state, validate-and-pay) that the
// hosted payment page makes on its own origin. This module stays free of
// runner imports so the Playwright runtime can classify responses too.

export const isNexiBuildApiUrl = (url: URL) =>
  url.hostname.endsWith(".nexigroup.com") &&
  /^\/fe\/(?:v2\/)?build\//.test(url.pathname);

export type NexiBuildEndpoint =
  | "card-data"
  | "browser-data"
  | "state"
  | "gdi-result"
  | "finalize-payment"
  | "validate-and-pay"
  | "other";

export type NexiBuildResponse = {
  readonly endpoint: NexiBuildEndpoint;
  readonly method: string;
  readonly status: number;
};

const nexiBuildEndpoints: readonly [RegExp, NexiBuildEndpoint][] = [
  [/^\/fe\/build\/text\/?$/, "card-data"],
  [/^\/fe\/build\/text\/BROWSER_DATA$/, "browser-data"],
  [/^\/fe\/(?:v2\/)?build\/state$/, "state"],
  [/^\/fe\/build\/check_gdi_result$/, "gdi-result"],
  [/^\/fe\/build\/finalize_payment$/, "finalize-payment"],
  [/^\/fe\/build\/validateAndPay$/, "validate-and-pay"],
];

export const toNexiBuildEndpoint = (url: URL): NexiBuildEndpoint =>
  nexiBuildEndpoints.find(([pattern]) => pattern.test(url.pathname))?.[1] ??
  "other";

const parseHttpsUrl = (value: string) => {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
};

// Reads the session response log ("<status> <METHOD> <url>" lines) and keeps
// only the status, method, and a fixed endpoint class of Nexi hosted-field API
// calls.
export const parseNexiBuildResponses = (
  responseLog: string
): readonly NexiBuildResponse[] => {
  const responses: NexiBuildResponse[] = [];
  for (const line of responseLog.split("\n")) {
    const match = line.trim().match(/^(\d{3})\s+([A-Z]+)\s+(https:\/\/\S+)$/);
    if (!match?.[1] || !match[2] || !match[3]) continue;
    const url = parseHttpsUrl(match[3]);
    if (!url || !isNexiBuildApiUrl(url)) continue;
    responses.push({
      endpoint: toNexiBuildEndpoint(url),
      method: match[2],
      status: Number(match[1]),
    });
  }
  return responses;
};

// Nexi explains a rejected hosted-field call only in its response body. Keep
// only fields at known paths whose values have a provider-code shape that
// cannot carry customer or card data; drop everything else.
const nexiErrorCodePattern = /^[A-Z]{2,4}\d{2,6}$/;
const nexiEnumValuePattern = /^[A-Z]+(?:_[A-Z]+)+$/;
const nexiHostedFieldIds = new Set([
  "CARDHOLDER_EMAIL",
  "CARDHOLDER_NAME",
  "CARD_NUMBER",
  "EXPIRATION_DATE",
  "SECURITY_CODE",
]);
const nexiWorkflowKeys = ["event", "state", "workflowState"] as const;

export type NexiBuildFailureSummary = {
  readonly errors?: readonly { readonly code: string }[];
  readonly event?: string;
  readonly fieldStatus?: readonly {
    readonly event: string;
    readonly id: string;
  }[];
  readonly state?: string;
  readonly workflowState?: string;
};

export const summarizeNexiBuildFailureBody = (
  text: string
): NexiBuildFailureSummary | undefined => {
  let body: Record<string, unknown> | undefined;
  try {
    body = asRecord(JSON.parse(text));
  } catch {
    return undefined;
  }
  if (!body) return undefined;

  const summary: {
    -readonly [Key in keyof NexiBuildFailureSummary]: NexiBuildFailureSummary[Key];
  } = {};
  const errorCodes = recordsOf(body.errors).flatMap((error) =>
    codeValue(error.code, nexiErrorCodePattern)
  );
  if (errorCodes.length > 0)
    summary.errors = errorCodes.map((code) => ({ code }));
  for (const key of nexiWorkflowKeys) {
    const [value] = codeValue(body[key], nexiEnumValuePattern);
    if (value) summary[key] = value;
  }
  const fieldStatus = recordsOf(body.fieldStatus).flatMap((field) => {
    const [event] = codeValue(field.event, nexiEnumValuePattern);
    if (!event) return [];
    const id =
      typeof field.id === "string" && nexiHostedFieldIds.has(field.id)
        ? field.id
        : "[other]";
    return [{ event, id }];
  });
  if (fieldStatus.length > 0) summary.fieldStatus = fieldStatus;

  return Object.keys(summary).length > 0 ? summary : undefined;
};

// The provider codes of one summary, error codes first, without field ids.
export const listNexiBuildFailureCodes = (
  summary: NexiBuildFailureSummary
): readonly string[] => [
  ...(summary.errors ?? []).map(({ code }) => code),
  ...nexiWorkflowKeys.flatMap((key) => {
    const value = summary[key];
    return value ? [value] : [];
  }),
];

export type NexiBuildFailure = Pick<
  NexiBuildResponse,
  "endpoint" | "status"
> & {
  readonly codes: readonly string[];
};

// The session network log carries one code-only line per failed Nexi build
// response whose body names provider codes. The line holds no URL or body.
const nexiBuildFailureLinePrefix = "nexi-build-failure";

export const formatNexiBuildFailureLine = ({
  codes,
  endpoint,
  status,
}: NexiBuildFailure) =>
  `${nexiBuildFailureLinePrefix} ${status} ${endpoint} ${codes.join(",")}`;

const nexiBuildFailureLinePattern = new RegExp(
  `^${nexiBuildFailureLinePrefix} (\\d{3}) ([a-z-]+) ([A-Z0-9_,]+)$`
);
const nexiBuildEndpointNames = new Set<string>([
  ...nexiBuildEndpoints.map(([, endpoint]) => endpoint),
  "other",
]);

export const parseNexiBuildFailures = (
  networkLog: string
): readonly NexiBuildFailure[] =>
  networkLog.split("\n").flatMap((line) => {
    const match = line.trim().match(nexiBuildFailureLinePattern);
    if (!match?.[1] || !match[2] || !match[3]) return [];
    if (!nexiBuildEndpointNames.has(match[2])) return [];
    const codes = match[3]
      .split(",")
      .filter(
        (code) =>
          nexiErrorCodePattern.test(code) || nexiEnumValuePattern.test(code)
      );
    return codes.length > 0
      ? [
          {
            codes,
            endpoint: match[2] as NexiBuildEndpoint,
            status: Number(match[1]),
          },
        ]
      : [];
  });

export const formatNexiBuildFailureCodes = (
  failures: readonly NexiBuildFailure[]
) =>
  failures.length === 0
    ? "none observed"
    : failures
        .map(
          ({ codes, endpoint, status }) =>
            `${endpoint} HTTP ${status} ${codes.join(",")}`
        )
        .join("; ");

const recordsOf = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const record = asRecord(item);
        return record ? [record] : [];
      })
    : [];

const codeValue = (value: unknown, pattern: RegExp): string[] =>
  typeof value === "string" && pattern.test(value) ? [value] : [];

const asRecord = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
