import { Predicate } from "effect";
import type { Properties } from "posthog-js";

const SENSITIVE_QUERY_PARAMS = new Set([
  "checkouttoken",
  "accesstoken",
  "paystate",
  "paystateref",
  "token",
  "state",
  "secret",
  "statustoken",
  "x-vercel-protection-bypass",
]);

export function createPostHogPageUrl(href: string) {
  const url = new URL(href);

  for (const param of [...url.searchParams.keys()]) {
    if (SENSITIVE_QUERY_PARAMS.has(param.toLowerCase())) {
      url.searchParams.delete(param);
    }
  }

  return url.toString();
}

function sanitizePostHogUrl(value: string) {
  try {
    return createPostHogPageUrl(value);
  } catch {
    return value;
  }
}

export function sanitizePostHogProperties(
  properties: Properties | undefined,
  posthogEnvironment: string
) {
  const sanitizedProperties: Properties = {
    ...properties,
    "deployment.environment.name": posthogEnvironment,
  };

  for (const property of [
    "$current_url",
    "$referrer",
    "$initial_current_url",
    "$initial_referrer",
  ]) {
    const url = sanitizedProperties[property];
    if (Predicate.isString(url)) {
      sanitizedProperties[property] = sanitizePostHogUrl(url);
    }
  }

  return sanitizedProperties;
}
