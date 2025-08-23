"use server";

import { revalidatePath } from "next/cache";
import type {
  FeatureFlagKey,
  FeatureFlagOverride,
} from "@/shared/config/feature-flags";
import {
  clearAllFeatureFlagOverrides,
  getAllFeatureFlagOverrides,
  setFeatureFlagOverride,
} from "@/shared/utils/feature-flags/cookies";

/**
 * Server action to set a feature flag override
 */
export async function setFeatureFlagOverrideAction(
  featureName: FeatureFlagKey,
  value: FeatureFlagOverride
) {
  try {
    await setFeatureFlagOverride(featureName, value);
    // Revalidate all paths to ensure the new flag value is used
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    console.error("Error in setFeatureFlagOverrideAction:", error);
    return {
      success: false,
      error: "Failed to set feature flag override",
    };
  }
}

/**
 * Server action to get all feature flag overrides
 */
export async function getAllFeatureFlagOverridesAction() {
  try {
    const overrides = await getAllFeatureFlagOverrides();
    return { success: true, overrides };
  } catch (error) {
    console.error("Error in getAllFeatureFlagOverridesAction:", error);
    return {
      success: false,
      error: "Failed to get feature flag overrides",
      overrides: {},
    };
  }
}

/**
 * Server action to clear all feature flag overrides
 */
export async function clearAllFeatureFlagOverridesAction() {
  try {
    await clearAllFeatureFlagOverrides();
    // Revalidate all paths to ensure default flag values are used
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    console.error("Error in clearAllFeatureFlagOverridesAction:", error);
    return {
      success: false,
      error: "Failed to clear feature flag overrides",
    };
  }
}

/**
 * Server action to toggle a feature flag override
 * Cycles through: null -> "true" -> "false" -> null
 */
export async function toggleFeatureFlagOverrideAction(
  featureName: FeatureFlagKey
) {
  try {
    const overrides = await getAllFeatureFlagOverrides();
    const currentValue = overrides[featureName];

    let newValue: FeatureFlagOverride;
    if (currentValue === undefined || currentValue === null) {
      newValue = "true";
    } else if (currentValue === "true") {
      newValue = "false";
    } else {
      newValue = null;
    }

    await setFeatureFlagOverride(featureName, newValue);
    // Revalidate all paths to ensure the new flag value is used
    revalidatePath("/", "layout");

    return { success: true, newValue };
  } catch (error) {
    console.error("Error in toggleFeatureFlagOverrideAction:", error);
    return {
      success: false,
      error: "Failed to toggle feature flag override",
    };
  }
}
