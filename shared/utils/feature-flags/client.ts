/**
 * Client-side utilities for managing feature flag overrides
 * These functions work directly with document.cookie in the browser
 */

const FF_COOKIE_PREFIX = "FF_";

/**
 * Get the cookie name for a feature flag
 */
export function getFeatureFlagCookieName(featureName: string): string {
  return `${FF_COOKIE_PREFIX}${featureName}`;
}

/**
 * Set a feature flag override in the browser
 */
export function setFeatureFlagOverride(
  featureName: string,
  value: "true" | "false" | null
): void {
  const cookieName = getFeatureFlagCookieName(featureName);

  if (value === null) {
    // Remove the cookie
    // biome-ignore lint/suspicious/noDocumentCookie: We need direct cookie access for feature flag overrides
    document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
  } else {
    // Set cookie with 30 day expiration
    const date = new Date();
    date.setTime(date.getTime() + 30 * 24 * 60 * 60 * 1000);
    const expires = `expires=${date.toUTCString()}`;
    // biome-ignore lint/suspicious/noDocumentCookie: We need direct cookie access for feature flag overrides
    document.cookie = `${cookieName}=${value}; ${expires}; path=/`;
  }
}

/**
 * Get a feature flag override value from browser cookies
 * Returns "true", "false", or null if not set
 */
export function getFeatureFlagOverride(
  featureName: string
): "true" | "false" | null {
  const cookieName = getFeatureFlagCookieName(featureName);
  const cookies = document.cookie.split(";");

  for (const cookie of cookies) {
    const parts = cookie.trim().split("=");
    if (parts.length >= 2) {
      const [name, value] = parts;
      if (name === cookieName) {
        if (value === "true" || value === "false") {
          return value;
        }
      }
    }
  }

  return null;
}

/**
 * Get all feature flag overrides from browser cookies
 */
export function getAllFeatureFlagOverrides(): Record<string, "true" | "false"> {
  const overrides: Record<string, "true" | "false"> = {};
  const cookies = document.cookie.split(";");

  for (const cookie of cookies) {
    const parts = cookie.trim().split("=");
    if (parts.length >= 2) {
      const name = parts[0];
      const value = parts[1];
      if (name?.startsWith(FF_COOKIE_PREFIX)) {
        const featureName = name.slice(FF_COOKIE_PREFIX.length);
        if (value === "true" || value === "false") {
          overrides[featureName] = value;
        }
      }
    }
  }

  return overrides;
}

/**
 * Clear all feature flag overrides in the browser
 */
export function clearAllFeatureFlagOverrides(): void {
  const cookies = document.cookie.split(";");

  for (const cookie of cookies) {
    const parts = cookie.trim().split("=");
    if (parts.length >= 1) {
      const name = parts[0];
      if (name?.startsWith(FF_COOKIE_PREFIX)) {
        // biome-ignore lint/suspicious/noDocumentCookie: We need direct cookie access for feature flag overrides
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
      }
    }
  }
}

/**
 * Toggle a feature flag override
 * If set to true, changes to false
 * If set to false, removes override
 * If not set, sets to true
 */
export function toggleFeatureFlagOverride(featureName: string): void {
  const current = getFeatureFlagOverride(featureName);

  if (current === "true") {
    setFeatureFlagOverride(featureName, "false");
  } else if (current === "false") {
    setFeatureFlagOverride(featureName, null);
  } else {
    setFeatureFlagOverride(featureName, "true");
  }
}
