import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  asRecord,
  sanitizeArtifactText,
  sanitizeHarEntry,
  sanitizeHarNamedValues,
} from "./artifact-sanitization";
import { addRedaction, redact, redactJsonValue } from "./redaction";

/**
 * Where a Playwright trace came from: the preview origins whose host must not
 * leave the runner. A local run has none.
 */
export type PlaywrightTraceSource = {
  readonly origins: readonly string[];
};

export type PlaywrightTraceSanitization =
  | { readonly outcome: "sanitized"; readonly path: string }
  | {
      readonly outcome: "deleted";
      readonly reason: PlaywrightTraceDeletionReason;
    };

type PlaywrightTraceDeletionReason =
  | "the trace could not be sanitized"
  | "a secret or the preview origin remained after sanitizing";

/** Stands in for a preview host, so the trace viewer can still parse URLs. */
export const previewHostPlaceholder = "preview.invalid";

const sanitizedTracePrefix = "sanitized-";

class TraceLeakError extends Error {}

/**
 * Rewrites a Playwright trace archive so it can leave the runner, with the
 * rules that sanitize the session's HAR (`artifact-sanitization.ts`): every
 * header, cookie, query, and posted value is redacted, response bodies are
 * dropped, and free text loses registered secrets, query values, and token
 * runs. Cookie and credential values the trace recorded, including the
 * `addCookies` parameters, are registered as secrets first, and preview hosts
 * become `preview.invalid`. Screenshots keep their pixels: no text rule can
 * redact what a page renders. They never show an address bar, so trace only
 * pages that render no secret, as the failure screenshots already require.
 *
 * Throws when sanitizing fails or any entry, by name or by bytes, still holds
 * a registered secret or a preview host.
 */
const sanitizePlaywrightTrace = (
  archive: Uint8Array,
  source: PlaywrightTraceSource
): Uint8Array => {
  const hosts = previewHosts(source);
  const entries = unzipSync(archive);
  const events = new Map<string, unknown[]>();
  for (const [name, bytes] of Object.entries(entries)) {
    if (isTraceEventFile(name)) events.set(name, parseTraceEvents(bytes));
  }
  for (const fileEvents of events.values()) registerTraceSecrets(fileEvents);

  const droppedBodies = new Set<string>();
  const sanitized: Record<string, Uint8Array> = {};
  for (const [name, fileEvents] of events) {
    const lines = fileEvents.map((event) =>
      JSON.stringify(sanitizeTraceEvent(event, hosts, droppedBodies))
    );
    sanitized[name] = strToU8(`${lines.join("\n")}\n`);
  }
  for (const [name, bytes] of Object.entries(entries)) {
    if (events.has(name)) continue;
    if (droppedBodies.has(basename(name))) continue;
    sanitized[name] = isTraceResource(name)
      ? redactBytes(bytes, hosts)
      : strToU8(sanitizeTraceText(strFromU8(bytes), hosts));
  }

  for (const [name, bytes] of Object.entries(sanitized)) {
    if (leaks(name, hosts) || leaks(latin1(bytes), hosts))
      throw new TraceLeakError();
  }
  return zipSync(sanitized);
};

/**
 * Replaces a trace file with its sanitized copy, `sanitized-<name>`, or
 * deletes it when it can't be sanitized. Never leaves the original behind.
 */
export const sanitizePlaywrightTraceFile = (
  path: string,
  source: PlaywrightTraceSource
): PlaywrightTraceSanitization => {
  const sanitizedPath = join(
    dirname(path),
    `${sanitizedTracePrefix}${basename(path)}`
  );
  try {
    writeFileSync(
      sanitizedPath,
      sanitizePlaywrightTrace(readFileSync(path), source)
    );
    return { outcome: "sanitized", path: sanitizedPath };
  } catch (error) {
    rmSync(sanitizedPath, { force: true });
    return {
      outcome: "deleted",
      reason:
        error instanceof TraceLeakError
          ? "a secret or the preview origin remained after sanitizing"
          : "the trace could not be sanitized",
    };
  } finally {
    rmSync(path, { force: true });
  }
};

const previewHosts = (source: PlaywrightTraceSource) =>
  source.origins.flatMap((origin) => {
    const url = new URL(origin);
    return url.host === url.hostname ? [url.host] : [url.host, url.hostname];
  });

// `trace.trace` and `trace.network` hold one JSON event per line;
// `trace.stacks` is one JSON document, which parses the same way.
const isTraceEventFile = (name: string) =>
  !isTraceResource(name) && /\.(?:network|stacks|trace)$/.test(name);

const isTraceResource = (name: string) => name.startsWith("resources/");

const parseTraceEvents = (bytes: Uint8Array): unknown[] =>
  strFromU8(bytes)
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));

const credentialHeaderNames = new Set([
  "authorization",
  "proxy-authorization",
  "x-vercel-protection-bypass",
]);

/**
 * Registers every cookie and credential value the events recorded: cookie
 * lists (`addCookies`, `storageState`, HAR entries), `Cookie` and
 * `Set-Cookie` headers, authorization and bypass headers, and HTTP
 * credentials.
 */
const registerTraceSecrets = (events: readonly unknown[]) => {
  const visit = (value: unknown, key?: string) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (key === "cookies") addRedaction(stringField(item, "value"));
        if (key === "headers" || key === "extraHTTPHeaders")
          registerHeader(stringField(item, "name"), stringField(item, "value"));
        visit(item);
      }
      return;
    }
    const record = asRecord(value);
    if (!record) return;
    if (key === "httpCredentials")
      addRedaction(stringField(record, "password"));
    if (
      (key === "headers" || key === "extraHTTPHeaders") &&
      !("name" in record)
    ) {
      for (const [name, headerValue] of Object.entries(record))
        if (typeof headerValue === "string") registerHeader(name, headerValue);
    }
    for (const [childKey, child] of Object.entries(record))
      visit(child, childKey);
  };
  for (const event of events) visit(event);
};

const registerHeader = (
  name: string | undefined,
  value: string | undefined
) => {
  if (!(name && value)) return;
  const header = name.toLowerCase();
  if (credentialHeaderNames.has(header)) {
    addRedaction(value);
    addRedaction(value.replace(/^\S+\s+/, ""));
  }
  if (header === "cookie" || header === "set-cookie") {
    for (const pair of value.split(header === "cookie" ? ";" : "\n")) {
      const cookie = pair.split(";", 1)[0] ?? "";
      addRedaction(cookie.slice(cookie.indexOf("=") + 1).trim());
    }
  }
};

const stringField = (value: unknown, field: string) => {
  const fieldValue = asRecord(value)?.[field];
  return typeof fieldValue === "string" ? fieldValue : undefined;
};

const sanitizeTraceEvent = (
  event: unknown,
  hosts: readonly string[],
  droppedBodies: Set<string>
) => {
  const record = asRecord(event);
  if (record?.type === "resource-snapshot") {
    const entry = asRecord(record.snapshot);
    if (entry) {
      for (const body of storedBodies(entry)) droppedBodies.add(body);
      sanitizeHarEntry(entry);
    }
  }
  return redactJsonValue(redactCredentialFields(event), (text) =>
    sanitizeTraceText(text, hosts)
  );
};

const storedBodies = (entry: Record<string, unknown>) =>
  [
    asRecord(asRecord(entry.response)?.content)?._sha1,
    asRecord(asRecord(entry.request)?.postData)?._sha1,
  ].filter((sha1): sha1 is string => typeof sha1 === "string");

/**
 * Redacts the values of header and cookie lists and HTTP credentials
 * anywhere in a trace event, such as an `addCookies` call's parameters or the
 * context options.
 */
const redactCredentialFields = (value: unknown, key?: string): unknown => {
  if (Array.isArray(value)) {
    const items =
      key === "cookies" || key === "headers" || key === "extraHTTPHeaders"
        ? sanitizeHarNamedValues(value)
        : value;
    return (items as unknown[]).map((item) => redactCredentialFields(item));
  }
  const record = asRecord(value);
  if (!record) return value;
  if (key === "httpCredentials") return "[redacted]";
  if (key === "headers" || key === "extraHTTPHeaders")
    return Object.fromEntries(
      Object.keys(record).map((name) => [name, "[redacted]"])
    );
  return Object.fromEntries(
    Object.entries(record).map(([childKey, child]) => [
      childKey,
      redactCredentialFields(child, childKey),
    ])
  );
};

const sanitizeTraceText = (text: string, hosts: readonly string[]) =>
  sanitizeArtifactText(replaceHosts(text, hosts));

const replaceHosts = (text: string, hosts: readonly string[]) =>
  hosts.reduce(
    (output, host) => output.replaceAll(host, previewHostPlaceholder),
    text
  );

// Screenshots and other binary resources only lose exact secret and host
// bytes; the text rules would corrupt them. Latin-1 maps each byte to one
// character, so unchanged bytes survive the round trip.
const redactBytes = (bytes: Uint8Array, hosts: readonly string[]) => {
  const text = latin1(bytes);
  const redacted = redact(replaceHosts(text, hosts));
  return redacted === text ? bytes : Buffer.from(redacted, "latin1");
};

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

const leaks = (text: string, hosts: readonly string[]) =>
  redact(text) !== text || hosts.some((host) => text.includes(host));
