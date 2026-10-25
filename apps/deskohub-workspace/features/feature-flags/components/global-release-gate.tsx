import "server-only";

import { connection } from "next/server";
import { type ReactNode, Suspense } from "react";
import { loadGlobalRelease } from "@/features/feature-flags/backend/global-release.server";
import type { PostHogFeatureFlagKey } from "@/features/feature-flags/generated/contract";

type GlobalReleaseGateProps = {
  /** The release gate's flag. */
  readonly flag: PostHogFeatureFlagKey;
  /** The gate's per-request decision, read only while the flag varies. */
  readonly isEnabled: () => Promise<boolean>;
  readonly children: ReactNode;
};

/**
 * Renders `children` only while the release gate is on. A flag that is the
 * same for every visitor is decided in the static shell, so cached pages need
 * no request. Otherwise the gate is evaluated after the static shell, which
 * stays the same for every visitor.
 */
export async function GlobalReleaseGate({
  flag,
  isEnabled,
  children,
}: GlobalReleaseGateProps) {
  switch (await loadGlobalRelease(flag)) {
    case "on":
      return children;
    case "off":
      return null;
    case "undecided":
      return (
        <Suspense fallback={null}>
          <RequestReleaseGate isEnabled={isEnabled}>
            {children}
          </RequestReleaseGate>
        </Suspense>
      );
  }
}

async function RequestReleaseGate({
  isEnabled,
  children,
}: Omit<GlobalReleaseGateProps, "flag">) {
  await connection();
  return (await isEnabled()) ? children : null;
}
