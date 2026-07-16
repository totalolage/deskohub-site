"use client";

import {
  useFeatureFlagEnabled as usePostHogFeatureFlagEnabled,
  useFeatureFlagPayload as usePostHogFeatureFlagPayload,
  useFeatureFlagResult as usePostHogFeatureFlagResult,
  useFeatureFlagVariantKey as usePostHogFeatureFlagVariantKey,
} from "@posthog/react";
import type { FeatureFlagResult } from "posthog-js";
import type {
  PostHogFeatureFlagContract,
  PostHogFeatureFlagDefinitionContract,
  PostHogFeatureFlagKey,
  PostHogFeatureFlagPayload,
  PostHogFeatureFlagValue,
} from "./contract";

type ValidDefinitions<Definitions> = {
  readonly [Key in keyof Definitions]: PostHogFeatureFlagDefinitionContract;
};

export type TypedPostHogFeatureFlagResult<
  Definitions,
  Key extends PostHogFeatureFlagKey<Definitions>,
> = Omit<FeatureFlagResult, "key" | "payload" | "variant"> & {
  readonly key: Key;
  readonly payload: PostHogFeatureFlagPayload<Definitions, Key>;
  readonly variant:
    | Extract<PostHogFeatureFlagValue<Definitions, Key>, string>
    | undefined;
};

export const createPostHogReactFeatureFlags = <
  const Definitions extends ValidDefinitions<Definitions>,
>(
  _contract: PostHogFeatureFlagContract<Definitions>
) => {
  function useFeatureFlagEnabled<
    Key extends PostHogFeatureFlagKey<Definitions>,
  >(flag: Key): boolean | undefined;
  function useFeatureFlagEnabled<
    Key extends PostHogFeatureFlagKey<Definitions>,
  >(flag: Key, defaultValue: boolean): boolean;
  function useFeatureFlagEnabled<
    Key extends PostHogFeatureFlagKey<Definitions>,
  >(flag: Key, defaultValue?: boolean) {
    const useEnabled = usePostHogFeatureFlagEnabled as (
      flagKey: string,
      fallback?: boolean
    ) => boolean | undefined;
    return useEnabled(flag, defaultValue);
  }

  function useFeatureFlagResult<Key extends PostHogFeatureFlagKey<Definitions>>(
    flag: Key
  ) {
    return usePostHogFeatureFlagResult(flag) as
      | TypedPostHogFeatureFlagResult<Definitions, Key>
      | undefined;
  }

  function useFeatureFlagVariantKey<
    Key extends PostHogFeatureFlagKey<Definitions>,
  >(flag: Key) {
    return usePostHogFeatureFlagVariantKey(flag) as
      | PostHogFeatureFlagValue<Definitions, Key>
      | undefined;
  }

  function useFeatureFlagPayload<
    Key extends PostHogFeatureFlagKey<Definitions>,
  >(flag: Key) {
    return usePostHogFeatureFlagPayload(flag) as PostHogFeatureFlagPayload<
      Definitions,
      Key
    >;
  }

  return {
    useFeatureFlagEnabled,
    useFeatureFlagPayload,
    useFeatureFlagResult,
    useFeatureFlagVariantKey,
  };
};
