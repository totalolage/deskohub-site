import { describe, expect, test } from "bun:test";
import { runSourceMapUpload, sourceMapUpload } from "./upload-source-maps";

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

  test("withholds failed CLI output and reports failure", async () => {
    const credential = 'phx_TEST_ONLY_not_a_secret/"\\';
    const credentialForms = [
      "phx_TEST_ONLY_not_a_secret",
      "Bearer phx_TEST_ONLY_not_a_secret",
      encodeURIComponent(credential),
      JSON.stringify(credential).slice(1, -1),
    ];
    const upload = sourceMapUpload(
      {
        ...productionEnv,
        POSTHOG_API_KEY: credential,
      },
      "/app/.next"
    );
    if (!upload) throw new Error("Expected a production source-map upload");

    const stdout: string[] = [];
    const stderr: string[] = [];
    const previousStdout = process.stdout.write;
    const previousStderr = process.stderr.write;
    process.stdout.write = ((chunk: string) => {
      stdout.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string) => {
      stderr.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    let failure: unknown;
    try {
      await runSourceMapUpload(
        upload,
        "/fake/posthog-cli",
        async (command, options) => {
          expect(command[0]).toBe("/fake/posthog-cli");
          expect(options.env?.POSTHOG_CLI_API_KEY).toBe(credential);
          return {
            exitCode: 1,
            signalCode: null,
            stdout: `${credentialForms.join("\n")}\n`,
            stderr: `${credentialForms.join("\n")}\n`,
            timedOut: false,
          };
        }
      );
    } catch (error) {
      failure = error;
    } finally {
      process.stdout.write = previousStdout;
      process.stderr.write = previousStderr;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("exited with code 1");
    const printedOutput = `${stdout.join("")}${stderr.join("")}`;
    expect(printedOutput).toBe(
      "PostHog source-map upload failed (exited with code 1). CLI output is withheld because it can echo credentials; rerun `posthog-cli sourcemap process` locally with the same environment to see details.\n"
    );
    for (const form of credentialForms)
      expect(printedOutput).not.toContain(form);
    expect(printedOutput).not.toContain("TEST_ONLY_not_a_secret");
  });
});
