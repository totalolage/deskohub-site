import { Predicate } from "effect";
import type { Properties } from "posthog-js";
import { sanitizeAnalyticsUrl } from "@/shared/utils/analytics-url";

const POSTHOG_URL_PROPERTIES = [
  "$current_url",
  "$referrer",
  "$initial_current_url",
  "$initial_referrer",
  "$session_entry_url",
  "$session_entry_referrer",
] as const;

const POSTHOG_PATH_PROPERTIES = [
  "$pathname",
  "$initial_pathname",
  "$session_entry_pathname",
] as const;

const SYNTHETIC_PATH_ORIGIN = "https://posthog-path.invalid";

const POSTHOG_CLICK_ID_PROPERTIES = new Set([
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
  "twclid",
  "li_fat_id",
  "mc_cid",
  "igshid",
  "ttclid",
]);

type PostHogUrlProperty = (typeof POSTHOG_URL_PROPERTIES)[number];

function isPostHogCampaignProperty(property: string) {
  if (
    property.startsWith("utm_") ||
    property.startsWith("$initial_utm_") ||
    property.startsWith("$session_entry_utm_")
  ) {
    return true;
  }

  return (
    POSTHOG_CLICK_ID_PROPERTIES.has(property) ||
    (property.startsWith("$initial_") &&
      POSTHOG_CLICK_ID_PROPERTIES.has(property.slice("$initial_".length))) ||
    (property.startsWith("$session_entry_") &&
      POSTHOG_CLICK_ID_PROPERTIES.has(property.slice("$session_entry_".length)))
  );
}

function sanitizePostHogUrlObject(url: URL) {
  url.search = "";
  url.hash = "";
  url.username = "";
  url.password = "";

  return url;
}

export function createPostHogPageUrl(href: string) {
  return sanitizePostHogUrlObject(
    new URL(sanitizeAnalyticsUrl(href))
  ).toString();
}

function sanitizePostHogUrl(
  value: string,
  property: PostHogUrlProperty
): string | undefined {
  if (
    (property === "$referrer" ||
      property === "$initial_referrer" ||
      property === "$session_entry_referrer") &&
    value === "$direct"
  ) {
    return value;
  }

  try {
    return createPostHogPageUrl(value);
  } catch {
    return undefined;
  }
}

function sanitizePostHogPath(value: string): string | undefined {
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;

  try {
    const url = new URL(value, SYNTHETIC_PATH_ORIGIN);
    if (url.origin !== SYNTHETIC_PATH_ORIGIN) return undefined;

    return sanitizePostHogUrlObject(
      new URL(sanitizeAnalyticsUrl(url.toString()))
    ).pathname;
  } catch {
    return undefined;
  }
}

export function sanitizePostHogUrlProperties(
  properties: Properties | undefined
) {
  const sanitizedProperties: Properties = { ...properties };

  for (const property of Object.keys(sanitizedProperties)) {
    if (isPostHogCampaignProperty(property)) {
      delete sanitizedProperties[property];
    }
  }

  for (const property of POSTHOG_URL_PROPERTIES) {
    const url = sanitizedProperties[property];
    if (!Predicate.isString(url)) {
      delete sanitizedProperties[property];
      continue;
    }

    const sanitizedUrl = sanitizePostHogUrl(url, property);
    if (sanitizedUrl === undefined) {
      delete sanitizedProperties[property];
    } else {
      sanitizedProperties[property] = sanitizedUrl;
    }
  }

  for (const property of POSTHOG_PATH_PROPERTIES) {
    const path = sanitizedProperties[property];
    if (!Predicate.isString(path)) {
      delete sanitizedProperties[property];
      continue;
    }

    const sanitizedPath = sanitizePostHogPath(path);
    if (sanitizedPath === undefined) {
      delete sanitizedProperties[property];
    } else {
      sanitizedProperties[property] = sanitizedPath;
    }
  }

  return sanitizedProperties;
}

export function sanitizePostHogProperties(
  properties: Properties | undefined,
  posthogEnvironment: string
) {
  const sanitizedProperties = sanitizePostHogUrlProperties(properties);

  for (const property of ["$set", "$set_once"] as const) {
    const nestedProperties = sanitizedProperties[property];
    if (Predicate.isObject(nestedProperties)) {
      sanitizedProperties[property] =
        sanitizePostHogUrlProperties(nestedProperties);
    }
  }

  sanitizedProperties["deployment.environment.name"] = posthogEnvironment;

  return sanitizedProperties;
}
