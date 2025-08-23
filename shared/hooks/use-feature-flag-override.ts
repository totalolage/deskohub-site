"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getAllFeatureFlagOverrides,
  getFeatureFlagOverride,
  setFeatureFlagOverride as setClientOverride,
} from "@/shared/utils/feature-flags/client";

/**
 * Hook for managing feature flag overrides in client components
 */
export function useFeatureFlagOverride(featureName: string) {
  const [override, setOverride] = useState<"true" | "false" | null>(null);

  // Load initial override value
  useEffect(() => {
    setOverride(getFeatureFlagOverride(featureName));
  }, [featureName]);

  // Set override and update state
  const setFeatureFlagOverride = useCallback(
    (value: "true" | "false" | null) => {
      setClientOverride(featureName, value);
      setOverride(value);
      // Reload the page to apply the new override
      window.location.reload();
    },
    [featureName]
  );

  // Toggle override between true -> false -> null -> true
  const toggleOverride = useCallback(() => {
    const current = getFeatureFlagOverride(featureName);
    let newValue: "true" | "false" | null;

    if (current === "true") {
      newValue = "false";
    } else if (current === "false") {
      newValue = null;
    } else {
      newValue = "true";
    }

    setFeatureFlagOverride(newValue);
  }, [featureName, setFeatureFlagOverride]);

  return {
    override,
    setOverride: setFeatureFlagOverride,
    toggleOverride,
    isEnabled: override === "true",
    isDisabled: override === "false",
    isDefault: override === null,
  };
}

/**
 * Hook for managing all feature flag overrides
 */
export function useAllFeatureFlagOverrides() {
  const [overrides, setOverrides] = useState<Record<string, "true" | "false">>(
    {}
  );

  // Load all overrides
  useEffect(() => {
    setOverrides(getAllFeatureFlagOverrides());
  }, []);

  // Refresh overrides and reload page
  const refreshOverrides = useCallback(() => {
    setOverrides(getAllFeatureFlagOverrides());
    window.location.reload();
  }, []);

  return {
    overrides,
    refreshOverrides,
  };
}
