import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { PostHogFeatureFlagKey } from "@/features/feature-flags/generated/contract";
import { recordNextCache } from "@/shared/testing/next-cache-recorder.test-utils";

// Outside a Next.js render there is no cache; record what each load asks of
// it instead.
const nextCacheModule = await import("next/cache");
const nextCache = recordNextCache();
mock.module("next/cache", () => ({ ...nextCacheModule, ...nextCache.module }));

// Inside `"use cache"`, Next.js fails the render on any request read.
const headers = mock(() => {
  throw new Error("headers() was read inside a cached render");
});
const nextHeaders = await import("next/headers");
mock.module("next/headers", () => ({ ...nextHeaders, headers }));

// The flags that are the same for every visitor; any other is decided per
// visitor. While `classificationFails`, the classification rejects.
let constantFlags: Partial<Record<PostHogFeatureFlagKey, boolean>> = {};
let classificationFails = false;
mock.module(
  "@/features/feature-flags/backend/feature-flag-evaluation-mode.server",
  () => ({
    getGlobalWorkspaceFeatureFlagValues: () => Promise.resolve(undefined),
    getGlobalWorkspaceFeatureFlagValue: (key: PostHogFeatureFlagKey) =>
      classificationFails
        ? Promise.reject(new Error("Classification failed"))
        : Promise.resolve(constantFlags[key]),
  })
);

const { loadGlobalRelease } = await import("./global-release.server");

beforeEach(() => nextCache.clear());

describe("loadGlobalRelease", () => {
  test("reads the flag as decided for everyone, without the request", async () => {
    for (const [officePage, release] of [
      [true, "on"],
      [false, "off"],
      [undefined, "undecided"],
    ] as const) {
      constantFlags =
        officePage === undefined ? {} : { office_page: officePage };

      expect(await loadGlobalRelease("office_page")).toBe(release);
    }
    expect(headers).not.toHaveBeenCalled();
    expect(nextCache.calls).toEqual(
      Array.from({ length: 3 }, () => ({ cacheLife: "minutes" }))
    );
  });

  test("reads the flag it is given", async () => {
    constantFlags = { office_page: true, referrals: false };

    expect(await loadGlobalRelease("referrals")).toBe("off");
  });

  test("counts a release it can't read as undecided, shared for the full lifetime", async () => {
    constantFlags = { office_page: true };
    classificationFails = true;
    try {
      expect(await loadGlobalRelease("office_page")).toBe("undecided");
      expect(nextCache.calls).toEqual([{ cacheLife: "minutes" }]);
    } finally {
      classificationFails = false;
    }
  });
});
