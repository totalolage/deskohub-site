import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";

const providerMessage =
  "provider failure for cloudinary-account-id-sentinel " +
  "with api_secret=synthetic-cloudinary-secret-sentinel";

let executeAttempts = 0;
const cacheLife = mock((_profile: string) => undefined);

const cloudinary = {
  config: mock(() => undefined),
  search: {
    expression: mock(() => {
      const builder = {
        with_field: () => builder,
        max_results: () => builder,
        next_cursor: () => builder,
        sort_by: () => builder,
        execute: async () => {
          executeAttempts += 1;
          throw { http_code: 401, message: providerMessage };
        },
      };
      return builder;
    }),
  },
};

mock.module("cloudinary", () => ({ v2: cloudinary }));
const cacheLife = mock(
  (_profile: { stale: number; revalidate: number; expire: number }) => undefined
);
mock.module("next/cache", () => ({
  cacheLife,
  cacheTag: () => undefined,
  revalidateTag: () => undefined,
}));
mock.module("@/env", () => ({
  env: {
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: "test-cloud",
    CLOUDINARY_API_KEY: "test-key",
    CLOUDINARY_API_SECRET: "test-secret",
  },
}));
// The real runner's only addition on top of a plain rejection is log
// annotation, so the propagated escaping error stays identical. The extra
// exports keep bun's cross-file module registry satisfied.
mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect:
    () =>
    <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
      Effect.runPromise(effect),
  defineWorkspaceTask: () => () => Promise.reject(new Error("unused")),
  defineWorkspacePage: () => () => {
    throw new Error("unused");
  },
  scheduleWorkspaceTelemetryFlush: () => Effect.void,
}));

const { getCloudinaryImages } = await import("./get-cloudinary-images.server");

describe("getCloudinaryImages provider failures", () => {
  test("degrades to no images and refreshes within a minute while staying prerenderable", async () => {
    const images = await getCloudinaryImages({ tags: [["gallery"]] });

    expect(images).toEqual([]);
    expect(executeAttempts).toBe(1);
    expect(cacheLife).toHaveBeenCalledWith({
      stale: 30,
      revalidate: 60,
      expire: 300,
    });
  });
});

describe("getCloudinaryImages caching", () => {
  test("uses the max cache life because the Cloudinary webhook revalidates its tags", async () => {
    cacheLife.mockClear();

    await getCloudinaryImages({ tags: [["gallery"]] }).catch(() => undefined);

    expect(cacheLife).toHaveBeenCalledWith("max");
  });
});
