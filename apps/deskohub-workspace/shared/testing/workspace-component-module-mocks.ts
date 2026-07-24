import { mock } from "bun:test";

export const workspaceRouterPush = mock((_href: string) => undefined);
export const workspaceRouterReplace = mock((_href: string) => undefined);
export const workspaceUseSearchParams = mock(() => new URLSearchParams());
export const workspaceUseFeatureFlagEnabled = mock(
  (_flag: string, _initialEnabled: boolean): boolean | undefined => undefined
);
export const workspaceApplyFeatureFlagOverrides = mock(
  (_posthog: unknown, _overrides: unknown) => undefined
);
export const workspaceUseFeatureFlagPayload = mock(
  (_flag: string): unknown => undefined
);
export const workspaceUseFeatureFlagResult = mock(
  (_flag: string): unknown => undefined
);
export const workspaceUseFeatureFlagVariantKey = mock(
  (_flag: string): unknown => undefined
);
export const workspaceUseAction = mock(
  (_action: unknown, _options: unknown): unknown => undefined
);

mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: workspaceRouterPush,
    replace: workspaceRouterReplace,
  }),
  useSearchParams: workspaceUseSearchParams,
  unstable_rethrow: (error: unknown) => {
    throw error;
  },
}));

mock.module("@/features/feature-flags/react", () => ({
  applyFeatureFlagOverrides: workspaceApplyFeatureFlagOverrides,
  useFeatureFlagEnabled: workspaceUseFeatureFlagEnabled,
  useFeatureFlagPayload: workspaceUseFeatureFlagPayload,
  useFeatureFlagResult: workspaceUseFeatureFlagResult,
  useFeatureFlagVariantKey: workspaceUseFeatureFlagVariantKey,
}));

mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: workspaceUseAction,
}));
