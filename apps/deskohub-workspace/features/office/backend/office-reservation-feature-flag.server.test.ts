import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import type { PostHogFeatureFlagKey } from "@/features/feature-flags/generated/contract";

// Outside a Next.js render there is no cache; record what each load asks of
// it instead.
const nextCache = await import("next/cache");
const cacheLife = mock(
  (_profile: Parameters<typeof nextCache.cacheLife>[0]) => {}
);
mock.module("next/cache", () => ({ ...nextCache, cacheLife }));

// Inside `"use cache"`, Next.js fails the render on any request read.
const headers = mock(() => {
  throw new Error("headers() was read inside a cached render");
});
const nextHeaders = await import("next/headers");
mock.module("next/headers", () => ({ ...nextHeaders, headers }));

// The flags that are the same for every visitor; any other is decided per
// visitor.
let constantFlags: Partial<Record<PostHogFeatureFlagKey, boolean>> = {};
mock.module(
  "@/features/feature-flags/backend/feature-flag-evaluation-mode.server",
  () => ({
    getGlobalWorkspaceFeatureFlagValues: () => Promise.resolve(undefined),
    getGlobalWorkspaceFeatureFlagValue: (key: PostHogFeatureFlagKey) =>
      Promise.resolve(constantFlags[key]),
  })
);

const { loadOfficeGlobalRelease } = await import(
  "./office-reservation-feature-flag.server"
);

describe("loadOfficeGlobalRelease", () => {
  test("reads the office gate as decided for everyone, without the request", async () => {
    for (const [officePage, release] of [
      [true, "on"],
      [false, "off"],
      [undefined, "undecided"],
    ] as const) {
      constantFlags = officePage === undefined ? {} : { office_page: officePage };

      expect(await loadOfficeGlobalRelease()).toBe(release);
    }
    expect(headers).not.toHaveBeenCalled();
    expect(cacheLife).toHaveBeenCalledWith("publicContent");
  });
});
