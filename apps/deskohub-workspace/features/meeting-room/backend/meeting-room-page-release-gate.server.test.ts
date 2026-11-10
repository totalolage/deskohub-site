import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, spyOn, test } from "bun:test";
import { classifiedConstancy } from "@/features/feature-flags/backend/feature-flag-constancy.test-utils";
import { ReleaseGateUnavailableError } from "@/features/feature-flags/backend/release-gate";
import type { PostHogFeatureFlagKey } from "@/features/feature-flags/generated/contract";
import { recordNextCache } from "@/shared/testing/next-cache-recorder.test-utils";

// The gate reads the flag's global release through a `"use cache"` loader,
// and outside a Next.js render there is no cache to set a lifetime on.
const nextCacheModule = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCacheModule,
  ...recordNextCache().module,
}));

// The after-connection reader waits for request time, which a test outside
// a render reaches at once.
const nextServer = await import("next/server");
mock.module("next/server", () => ({
  ...nextServer,
  connection: () => Promise.resolve(),
}));

// No classification could be read while `unclassified`; otherwise the
// meeting-room page is constant on.
let unclassified = true;
mock.module(
  "@/features/feature-flags/backend/feature-flag-evaluation-mode.server",
  () => ({
    getGlobalWorkspaceFeatureFlagValues: () => Promise.resolve(undefined),
    getGlobalWorkspaceFeatureFlagValue: (key: PostHogFeatureFlagKey) =>
      Promise.resolve(
        unclassified || key !== "meeting_room_page" ? undefined : true
      ),
    getWorkspaceFeatureFlagConstancy: (key: PostHogFeatureFlagKey) =>
      Promise.resolve(
        unclassified
          ? { kind: "unclassified" }
          : classifiedConstancy(key === "meeting_room_page" ? true : undefined)
      ),
  })
);

const { isMeetingRoomPageEnabled, isMeetingRoomPageOpenAfterConnection } =
  await import("./meeting-room-page-release-gate.server");

describe("meeting-room page release gate readers", () => {
  test("reject for stored output but stay closed after connection() while PostHog can't decide the flag", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      unclassified = true;

      await expect(isMeetingRoomPageEnabled()).rejects.toBeInstanceOf(
        ReleaseGateUnavailableError
      );
      await expect(isMeetingRoomPageOpenAfterConnection()).resolves.toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  test("agree while the flag is decided", async () => {
    unclassified = false;

    await expect(isMeetingRoomPageEnabled()).resolves.toBe(true);
    await expect(isMeetingRoomPageOpenAfterConnection()).resolves.toBe(true);
  });
});
