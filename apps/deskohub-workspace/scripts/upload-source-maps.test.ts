import { describe, expect, test } from "bun:test";
import { sourceMapUpload } from "./upload-source-maps";

const productionEnv = {
  POSTHOG_API_HOST: "https://posthog.example",
  POSTHOG_API_KEY: "phx_synthetic",
  POSTHOG_PROJECT_ID: "12345",
  VERCEL_ENV: "production",
  VERCEL_GIT_COMMIT_SHA: "abc123",
};

describe("sourceMapUpload", () => {
  test.each([
    ["preview", { ...productionEnv, VERCEL_ENV: "preview" }],
    ["development", { ...productionEnv, VERCEL_ENV: "development" }],
    ["local or CI", { ...productionEnv, VERCEL_ENV: undefined }],
  ])("uploads nothing from a %s build", (_name, env) => {
    expect(sourceMapUpload(env, "/app/.next")).toBeUndefined();
  });

  test("processes a production build's output for its commit", () => {
    const upload = sourceMapUpload(productionEnv, "/app/.next");

    expect(upload?.args).toEqual([
      "sourcemap",
      "process",
      "--directory",
      "/app/.next",
      "--release-name",
      "deskohub-workspace",
      "--release-version",
      "abc123",
      "--release-mode",
      "event",
      "--delete-after",
    ]);
    expect(upload?.env).toMatchObject({
      POSTHOG_CLI_API_KEY: "phx_synthetic",
      POSTHOG_CLI_HOST: "https://posthog.example",
      POSTHOG_CLI_PROJECT_ID: "12345",
    });
    expect(upload?.args.join(" ")).not.toContain("phx_synthetic");
  });

  test.each(["POSTHOG_API_KEY", "POSTHOG_API_HOST", "POSTHOG_PROJECT_ID"])(
    "fails a production build without %s",
    (name) => {
      expect(() =>
        sourceMapUpload({ ...productionEnv, [name]: " " }, "/app/.next")
      ).toThrow(`${name} is required`);
    }
  );
});
