import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";

const providerMessage =
  "provider failure for cloudinary-account-id-sentinel " +
  "with api_secret=synthetic-cloudinary-secret-sentinel";

let executeAttempts = 0;

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
mock.module("next/cache", () => ({
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

describe("getCloudinaryImages escaping failures", () => {
  test("propagates a sanitized CloudinarySearchError without provider data", async () => {
    let caught: unknown;
    try {
      await getCloudinaryImages({ tags: [["gallery"]] });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    expect(executeAttempts).toBe(1);

    const failure = caught as {
      readonly _tag?: string;
      readonly message?: string;
      readonly expression?: string;
      readonly httpCode?: number;
      readonly cause?: unknown;
    };
    expect(failure._tag).toBe("CloudinarySearchError");
    expect(failure.message).not.toContain("cloudinary-account-id-sentinel");
    expect(failure.message).not.toContain(
      "synthetic-cloudinary-secret-sentinel"
    );
    expect(failure.expression).not.toContain("cloudinary-account-id-sentinel");
    expect(failure.expression).not.toContain("public_id=");
    expect(failure.cause).toBeUndefined();

    const stringified = JSON.stringify(caught);
    expect(stringified).not.toContain("cloudinary-account-id-sentinel");
    expect(stringified).not.toContain("synthetic-cloudinary-secret-sentinel");
    expect(stringified).not.toContain("api_secret");
  });
});
