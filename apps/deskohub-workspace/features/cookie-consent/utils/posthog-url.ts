import { Predicate } from "effect";
import type { Properties } from "posthog-js";
import { sanitizeAnalyticsUrl } from "@/shared/utils/analytics-url";

export const createPostHogPageUrl = sanitizeAnalyticsUrl;

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
