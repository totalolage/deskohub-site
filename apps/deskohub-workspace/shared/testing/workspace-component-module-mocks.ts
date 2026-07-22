import { mock } from "bun:test";

export const workspaceRouterPush = mock((_href: string) => undefined);
export const workspaceRouterReplace = mock((_href: string) => undefined);
export const workspaceUseSearchParams = mock(() => new URLSearchParams());
export const workspaceUseFeatureFlagEnabled = mock(
  (_flag: string, _initialEnabled: boolean): boolean | undefined => undefined
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
  useFeatureFlagEnabled: workspaceUseFeatureFlagEnabled,
}));

mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: workspaceUseAction,
}));
