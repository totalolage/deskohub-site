import { escapeRegExp } from "../shared/utils/escape-regexp";

const redactions = new Map<string, "substring" | "token">();

export const addRedaction = (value: string | undefined, force = false) => {
  if (!value || (!force && value.length <= 6)) return;
  const mode = force && value.length <= 6 ? "token" : "substring";
  for (const variant of [
    value,
    encodeURIComponent(value),
    new URLSearchParams({ value }).toString().slice("value=".length),
  ]) {
    const existingMode = redactions.get(variant);
    redactions.set(
      variant,
      existingMode === "substring" || mode === "substring"
        ? "substring"
        : "token"
    );
  }
};

export const addDatabaseUrlRedactions = (value: string | undefined) => {
  addRedaction(value);
  if (!value) return;

  const url = URL.parse(value);
  if (!url) return;
  [
    url.host,
    url.hostname,
    url.pathname,
    url.pathname.slice(1),
    url.username,
    url.password,
  ].forEach((part) => {
    addRedaction(part, true);
  });
};

export const redact = (text: string) => {
  let output = text;
  for (const [secret, mode] of redactions) {
    output =
      mode === "token"
        ? output.replace(
            new RegExp(
              `(?<![A-Za-z0-9])${escapeRegExp(secret)}(?![A-Za-z0-9])`,
              "g"
            ),
            "[redacted]"
          )
        : output.replaceAll(secret, "[redacted]");
  }
  return output;
};

/**
 * Redacts registered secrets, whole URLs, and token-like runs from free text
 * bound for a diagnostic or artifact.
 */
export const redactDiagnosticText = (text: string) =>
  redact(text)
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[token]");

export const redactJsonValue = (
  value: unknown,
  sanitizeText: (text: string) => string = redact
): unknown => {
  if (typeof value === "string") return sanitizeText(value);
  if (typeof value === "number") {
    const text = String(value);
    const sanitized = sanitizeText(text);
    return sanitized === text ? value : sanitized;
  }
  if (Array.isArray(value))
    return value.map((item) => redactJsonValue(item, sanitizeText));
  if (value === null || typeof value !== "object") return value;

  const sanitized: Record<string, unknown> = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    const sanitizedKey = sanitizeText(key);
    let uniqueKey = sanitizedKey;
    let ordinal = 2;
    while (Object.hasOwn(sanitized, uniqueKey)) {
      uniqueKey = `${sanitizedKey}#${ordinal}`;
      ordinal += 1;
    }
    sanitized[uniqueKey] = redactJsonValue(item, sanitizeText);
  }
  return sanitized;
};
