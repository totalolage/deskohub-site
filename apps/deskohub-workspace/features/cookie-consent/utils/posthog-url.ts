import { isSensitiveUrlSearchParam } from "@/shared/utils/sensitive-url-search-params";

export function createPostHogPageUrl(href: string) {
  const url = new URL(href);

  for (const param of [...url.searchParams.keys()]) {
    if (isSensitiveUrlSearchParam(param)) {
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
  properties: Record<string, unknown> | undefined,
  posthogEnvironment: string
) {
  const sanitizedProperties: Record<string, unknown> = {
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
    if (typeof url === "string") {
      sanitizedProperties[property] = sanitizePostHogUrl(url);
    }
  }

  return sanitizedProperties;
}
