"use client";

import type { FeatureFlagResult } from "posthog-js";
import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import type {
  PostHogFeatureFlagContract,
  PostHogFeatureFlagDefinitionContract,
  PostHogFeatureFlagKey,
  PostHogFeatureFlagOverrides,
  PostHogFeatureFlagPayload,
  PostHogFeatureFlagValue,
} from "./contract";

type ValidDefinitions<Definitions> = {
  readonly [Key in keyof Definitions]: PostHogFeatureFlagDefinitionContract;
};

interface PostHogFeatureFlagOverrideClient<Definitions> {
  readonly featureFlags: {
    readonly overrideFeatureFlags: (
      overrides:
        | false
        | {
            readonly flags: PostHogFeatureFlagOverrides<Definitions>;
          }
    ) => void;
  };
}

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

/** The browser SDK reads behind the flag hooks. */
export interface PostHogFeatureFlagClient {
  getFeatureFlag(key: string): boolean | string | undefined;
  getFeatureFlagResult(
    key: string,
    options?: { readonly send_event?: boolean }
  ): FeatureFlagResult | undefined;
  isFeatureEnabled(key: string): boolean | undefined;
  onFeatureFlags(callback: () => void): () => void;
}

/**
 * The browser SDK client once it is available. It can arrive after the hooks
 * mount, for example when the SDK loads only after analytics consent.
 */
export interface PostHogClientSource {
  readonly getClient: () => PostHogFeatureFlagClient | undefined;
  readonly subscribe: (listener: () => void) => () => void;
}

const unavailableClient: PostHogClientSource = {
  getClient: () => undefined,
  subscribe: () => () => undefined,
};

const PostHogClientContext =
  createContext<PostHogClientSource>(unavailableClient);

// `@posthog/react` imports the whole browser SDK at module load, so the hooks
// read the client from this context instead, with the same semantics.
export function PostHogClientProvider({
  children,
  client,
}: {
  readonly children: ReactNode;
  readonly client: PostHogClientSource;
}) {
  return createElement(
    PostHogClientContext.Provider,
    { value: client },
    children
  );
}

/** Reads a flag value, then again whenever the client or its flags change. */
const useFeatureFlagRead = <Value>(
  flag: string,
  read: (client: PostHogFeatureFlagClient, flag: string) => Value | undefined
): Value | undefined => {
  const source = useContext(PostHogClientContext);
  const [value, setValue] = useState(() => {
    const client = source.getClient();
    return client === undefined ? undefined : read(client, flag);
  });

  useEffect(() => {
    let unsubscribeFlags: (() => void) | undefined;
    const attachClient = () => {
      unsubscribeFlags?.();
      unsubscribeFlags = undefined;
      const client = source.getClient();
      if (client === undefined) return;

      setValue(read(client, flag));
      unsubscribeFlags = client.onFeatureFlags(() =>
        setValue(read(client, flag))
      );
    };

    attachClient();
    const unsubscribeSource = source.subscribe(attachClient);
    return () => {
      unsubscribeSource();
      unsubscribeFlags?.();
    };
  }, [flag, read, source]);

  return value;
};

const readEnabled = (client: PostHogFeatureFlagClient, flag: string) =>
  client.isFeatureEnabled(flag);
const readResult = (client: PostHogFeatureFlagClient, flag: string) =>
  client.getFeatureFlagResult(flag);
const readVariantKey = (client: PostHogFeatureFlagClient, flag: string) =>
  client.getFeatureFlag(flag);
const readPayload = (client: PostHogFeatureFlagClient, flag: string) =>
  client.getFeatureFlagResult(flag, { send_event: false })?.payload;

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
    return useFeatureFlagRead(flag, readEnabled) ?? defaultValue;
  }

  function useFeatureFlagResult<Key extends PostHogFeatureFlagKey<Definitions>>(
    flag: Key
  ) {
    return useFeatureFlagRead(flag, readResult) as
      | TypedPostHogFeatureFlagResult<Definitions, Key>
      | undefined;
  }

  function useFeatureFlagVariantKey<
    Key extends PostHogFeatureFlagKey<Definitions>,
  >(flag: Key) {
    return useFeatureFlagRead(flag, readVariantKey) as
      | PostHogFeatureFlagValue<Definitions, Key>
      | undefined;
  }

  function useFeatureFlagPayload<
    Key extends PostHogFeatureFlagKey<Definitions>,
  >(flag: Key) {
    return useFeatureFlagRead(flag, readPayload) as PostHogFeatureFlagPayload<
      Definitions,
      Key
    >;
  }

  const applyFeatureFlagOverrides = (
    client: PostHogFeatureFlagOverrideClient<Definitions>,
    overrides?: PostHogFeatureFlagOverrides<Definitions>
  ) => {
    client.featureFlags.overrideFeatureFlags(
      overrides === undefined
        ? false
        : {
            flags: overrides,
          }
    );
  };

  return {
    applyFeatureFlagOverrides,
    useFeatureFlagEnabled,
    useFeatureFlagPayload,
    useFeatureFlagResult,
    useFeatureFlagVariantKey,
  };
};
