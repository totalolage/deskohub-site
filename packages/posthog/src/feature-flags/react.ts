"use client";

import {
  useFeatureFlagEnabled as usePostHogFeatureFlagEnabled,
  useFeatureFlagPayload as usePostHogFeatureFlagPayload,
  useFeatureFlagResult as usePostHogFeatureFlagResult,
  useFeatureFlagVariantKey as usePostHogFeatureFlagVariantKey,
} from "@posthog/react";
import type { FeatureFlagResult } from "posthog-js";
import type {
  PostHogFeatureFlagKey,
  PostHogFeatureFlagPayload,
  PostHogFeatureFlagValue,
} from "../generated/feature-flags";

export type TypedPostHogFeatureFlagResult<Key extends PostHogFeatureFlagKey> =
  Omit<FeatureFlagResult, "key" | "payload" | "variant"> & {
    readonly key: Key;
    readonly payload: PostHogFeatureFlagPayload<Key>;
    readonly variant: Extract<PostHogFeatureFlagValue<Key>, string> | undefined;
  };

export function useFeatureFlagEnabled<Key extends PostHogFeatureFlagKey>(
  flag: Key
): boolean | undefined;
export function useFeatureFlagEnabled<Key extends PostHogFeatureFlagKey>(
  flag: Key,
  defaultValue: boolean
): boolean;
export function useFeatureFlagEnabled<Key extends PostHogFeatureFlagKey>(
  flag: Key,
  defaultValue?: boolean
) {
  const useEnabled = usePostHogFeatureFlagEnabled as (
    flagKey: string,
    fallback?: boolean
  ) => boolean | undefined;
  return useEnabled(flag, defaultValue);
}

/**
 * Returns the typed value and payload from one PostHog evaluation snapshot.
 * PostHog sends the `$feature_flag_called` exposure event by default.
 */
export function useFeatureFlagResult<Key extends PostHogFeatureFlagKey>(
  flag: Key
) {
  return usePostHogFeatureFlagResult(flag) as
    | TypedPostHogFeatureFlagResult<Key>
    | undefined;
}

export function useFeatureFlagVariantKey<Key extends PostHogFeatureFlagKey>(
  flag: Key
) {
  return usePostHogFeatureFlagVariantKey(flag) as
    | PostHogFeatureFlagValue<Key>
    | undefined;
}

/**
 * PostHog's payload-only hook does not send an exposure event. Pair it with
 * `useFeatureFlagEnabled`, `useFeatureFlagVariantKey`, or use
 * `useFeatureFlagResult` when the payload controls rendered behavior.
 */
export function useFeatureFlagPayload<Key extends PostHogFeatureFlagKey>(
  flag: Key
) {
  return usePostHogFeatureFlagPayload(flag) as PostHogFeatureFlagPayload<Key>;
}
