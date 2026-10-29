import {
  isNexiBuildApiUrl,
  summarizeNexiBuildFailureBody,
} from "./checkout/nexi-build-api";
import { redact, redactJsonValue } from "./redaction";

/**
 * Redacts registered secrets, query values, the bypass header, and long
 * token-like runs from text bound for a failure artifact.
 */
export const sanitizeArtifactText = (text: string) =>
  sanitizeArtifactUrlText(redact(text))
    .replace(/([?&][^=&#\s]+)=[^&\s",}]+/g, "$1=[redacted]")
    .replace(/((?:%3F|%26)[^=%&\s]+)(?:%3D|=)[^%&\s",}]+/gi, "$1%3D[redacted]")
    .replace(/(x-vercel-protection-bypass[=":\s]+)[^&\s",}]+/gi, "$1[redacted]")
    .replace(/[A-Za-z0-9_-]{96,}/g, "[token]");

const sanitizeArtifactUrlText = (text: string) =>
  text.replace(/https?:\/\/[^\s"'<>]+/g, (value) => {
    try {
      const url = new URL(value);
      for (const key of url.searchParams.keys())
        url.searchParams.set(key, "[redacted]");
      return url.toString();
    } catch {
      return value;
    }
  });

// Sanitizes string values only, so short redacted values (such as test card
// fragments) cannot rewrite timings and sizes into invalid JSON.
export const sanitizeHarArtifact = (text: string) => {
  try {
    const har = JSON.parse(text) as Record<string, unknown>;
    const log = asRecord(har.log);
    const entries = Array.isArray(log?.entries) ? log.entries : [];

    for (const entry of entries) {
      const record = asRecord(entry);
      if (record) sanitizeHarEntry(record);
    }

    return JSON.stringify(redactJsonValue(har, sanitizeArtifactText), null, 2);
  } catch {
    return sanitizeArtifactText(text);
  }
};

/**
 * Redacts one HAR entry in place: every header, cookie, query, and posted
 * value, and the response body, which keeps only a Nexi build-failure
 * summary. A body stored outside the entry loses its reference. Free text
 * still needs `sanitizeArtifactText`.
 */
export const sanitizeHarEntry = (entry: Record<string, unknown>) => {
  const request = asRecord(entry.request);
  const requestUrl = typeof request?.url === "string" ? request.url : "";
  sanitizeHarRequest(request);
  sanitizeHarResponse(asRecord(entry.response), requestUrl);
};

const sanitizeHarRequest = (request: Record<string, unknown> | undefined) => {
  if (!request) return;
  if (typeof request.url === "string")
    request.url = sanitizeHarUrl(request.url);
  request.headers = sanitizeHarNamedValues(request.headers);
  request.cookies = [];
  request.queryString = sanitizeHarNamedValues(request.queryString);

  const postData = asRecord(request.postData);
  if (!postData) return;
  postData.params = [];
  dropStoredBody(postData);
  if (typeof postData.text === "string") postData.text = "[redacted]";
};

const sanitizeHarResponse = (
  response: Record<string, unknown> | undefined,
  requestUrl: string
) => {
  if (!response) return;
  response.headers = sanitizeHarNamedValues(response.headers);
  response.cookies = [];

  const content = asRecord(response.content);
  if (!content) return;
  dropStoredBody(content);
  if (typeof content.text !== "string") return;
  const summary =
    typeof response.status === "number" &&
    response.status >= 400 &&
    isNexiBuildUrl(requestUrl)
      ? summarizeNexiBuildFailureBody(content.text)
      : undefined;
  content.text = summary ? JSON.stringify(summary) : "[redacted]";
};

// Playwright stores a body outside the entry as `_sha1` in a trace and as
// `_file` in a HAR recorded with attached content.
const dropStoredBody = (body: Record<string, unknown>) => {
  Reflect.deleteProperty(body, "_sha1");
  Reflect.deleteProperty(body, "_file");
};

const isNexiBuildUrl = (value: string) => {
  const url = URL.parse(value);
  return url ? isNexiBuildApiUrl(url) : false;
};

/** Redacts the value of every `{ name, value }` pair, keeping the names. */
export const sanitizeHarNamedValues = (value: unknown) =>
  Array.isArray(value)
    ? value.map((item) => {
        const record = asRecord(item);
        return record ? { ...record, value: "[redacted]" } : item;
      })
    : value;

const sanitizeHarUrl = (value: string) => {
  try {
    const url = new URL(value);
    for (const key of url.searchParams.keys())
      url.searchParams.set(key, "[redacted]");
    return sanitizeArtifactText(url.toString());
  } catch {
    return sanitizeArtifactText(value);
  }
};

export const asRecord = (value: unknown) =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
