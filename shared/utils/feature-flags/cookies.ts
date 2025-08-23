import { cookies } from "next/headers";
import {
  FEATURE_FLAG_COOKIE_CONFIG,
  type FeatureFlagKey,
  type FeatureFlagOverride,
} from "@/shared/config/feature-flags";

/**
 * Get the cookie name for a feature flag
 */
export function getFeatureFlagCookieName(featureName: FeatureFlagKey): string {
  return `${FEATURE_FLAG_COOKIE_CONFIG.PREFIX}${featureName}`;
}

/**
 * Validate if a value is a valid feature flag override
 */
function isValidOverride(value: unknown): value is "true" | "false" {
  return value === "true" || value === "false";
}

/**
 * Get a feature flag override value from cookies
 */
export async function getFeatureFlagOverride(
  featureName: FeatureFlagKey
): Promise<FeatureFlagOverride> {
  try {
    const cookieStore = await cookies();
    const cookieName = getFeatureFlagCookieName(featureName);
    const value = cookieStore.get(cookieName)?.value;

    if (isValidOverride(value)) {
      return value;
    }

    return null;
  } catch (error) {
    console.error(
      `Error reading feature flag cookie for ${featureName}:`,
      error
    );
    return null;
  }
}

/**
 * Set a feature flag override in cookies
 */
export async function setFeatureFlagOverride(
  featureName: FeatureFlagKey,
  value: FeatureFlagOverride
): Promise<void> {
  try {
    const cookieStore = await cookies();
    const cookieName = getFeatureFlagCookieName(featureName);

    if (value === null) {
      // Remove the cookie if setting to null
      cookieStore.delete(cookieName);
    } else {
      // Set cookie with configuration from centralized config
      cookieStore.set(cookieName, value, {
        httpOnly: false, // Allow client-side access for debugging
        secure: process.env.NODE_ENV === "production",
        sameSite: FEATURE_FLAG_COOKIE_CONFIG.SAME_SITE,
        maxAge: FEATURE_FLAG_COOKIE_CONFIG.MAX_AGE,
        path: FEATURE_FLAG_COOKIE_CONFIG.PATH,
      });
    }
  } catch (error) {
    console.error(
      `Error setting feature flag cookie for ${featureName}:`,
      error
    );
  }
}

/**
 * Clear all feature flag overrides
 */
export async function clearAllFeatureFlagOverrides(): Promise<void> {
  try {
    const cookieStore = await cookies();
    const allCookies = cookieStore.getAll();

    for (const cookie of allCookies) {
      if (cookie.name.startsWith(FEATURE_FLAG_COOKIE_CONFIG.PREFIX)) {
        cookieStore.delete(cookie.name);
      }
    }
  } catch (error) {
    console.error("Error clearing all feature flag cookies:", error);
  }
}

/**
 * Get all feature flag overrides from cookies
 */
export async function getAllFeatureFlagOverrides(): Promise<
  Partial<Record<FeatureFlagKey, "true" | "false">>
> {
  try {
    const cookieStore = await cookies();
    const allCookies = cookieStore.getAll();
    const overrides: Partial<Record<FeatureFlagKey, "true" | "false">> = {};

    for (const cookie of allCookies) {
      if (cookie.name.startsWith(FEATURE_FLAG_COOKIE_CONFIG.PREFIX)) {
        const featureName = cookie.name.slice(
          FEATURE_FLAG_COOKIE_CONFIG.PREFIX.length
        ) as FeatureFlagKey;
        if (isValidOverride(cookie.value)) {
          overrides[featureName] = cookie.value;
        }
      }
    }

    return overrides;
  } catch (error) {
    console.error("Error getting all feature flag cookies:", error);
    return {};
  }
}
