import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Effect, Exit, Option } from "effect";
import { withInstantSleeps } from "@/shared/testing/workspace-test-clock.test-utils";
import type { CommandResult } from "./shared/command";
import { skippedSourceMapUploadMarker } from "./source-map-upload-failure";
import { sourceMapUpload, uploadSourceMaps } from "./upload-source-maps";

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

const credential = 'phx_TEST_ONLY_not_a_secret/"\\';
const credentialForms = [
  "phx_TEST_ONLY_not_a_secret",
  "Bearer phx_TEST_ONLY_not_a_secret",
  encodeURIComponent(credential),
  JSON.stringify(credential).slice(1, -1),
];

const uploaded: CommandResult = {
  exitCode: 0,
  signalCode: null,
  stdout: "",
  stderr: "",
  timedOut: false,
};

const failedWith = (stderr: string): CommandResult => ({
  exitCode: 1,
  signalCode: null,
  // The CLI's output can echo every credential form.
  stdout: `${credentialForms.join("\n")}\n`,
  stderr: `${credentialForms.join("\n")}\n${stderr}\n`,
  timedOut: false,
});

const transientFailure = failedWith(
  "Oops! Failed to start upload\n\nCaused by:\n    0: API error: status='503' url='https://posthog.example/api' message='busy'"
);
const permanentFailure = failedWith(
  "Oops! Failed to create release\n\nCaused by:\n    0: API error: status='401' url='https://posthog.example/api' message='no'"
);
const unknownFailure = failedWith("Oops! something new");
const timedOut: CommandResult = {
  ...uploaded,
  exitCode: null,
  signalCode: "SIGKILL",
  timedOut: true,
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

/** A build output with public and server source maps. */
const buildOutput = async () => {
  const distDir = await mkdtemp(join(tmpdir(), "source-map-upload-"));
  temporaryDirectories.push(distDir);
  await mkdir(join(distDir, "static", "chunks"), { recursive: true });
  await mkdir(join(distDir, "static", "css"), { recursive: true });
  await mkdir(join(distDir, "server"), { recursive: true });
  await Promise.all([
    writeFile(join(distDir, "static", "chunks", "app.js"), "app();"),
    writeFile(join(distDir, "static", "chunks", "app.js.map"), "{}"),
    writeFile(join(distDir, "static", "css", "app.css.map"), "{}"),
    writeFile(join(distDir, "server", "page.js.map"), "{}"),
  ]);
  return distDir;
};

/** Runs the upload against scripted CLI results and captures its log lines. */
const runUpload = async (
  results: readonly CommandResult[],
  distDir = "/app/.next"
) => {
  const upload = sourceMapUpload(
    { ...productionEnv, POSTHOG_API_KEY: credential },
    distDir
  );
  if (!upload) throw new Error("Expected a production source-map upload");
  const logged: string[] = [];
  const capture = (...parts: unknown[]) => {
    logged.push(parts.join(" "));
  };
  const log = spyOn(console, "log").mockImplementation(capture);
  const error = spyOn(console, "error").mockImplementation(capture);
  const calls: { command: readonly string[]; timeoutMs?: number }[] = [];
  try {
    const exit = await Effect.runPromiseExit(
      withInstantSleeps(
        uploadSourceMaps({
          upload,
          posthogCli: "/fake/posthog-cli",
          distDir,
          commandRunner: async (command, options) => {
            expect(options.env?.POSTHOG_CLI_API_KEY).toBe(credential);
            calls.push({ command, timeoutMs: options.timeoutMs });
            const result = results[calls.length - 1];
            if (!result) throw new Error("Unexpected extra CLI run");
            return result;
          },
        })
      )
    );
    return {
      calls,
      failure: Exit.isFailure(exit)
        ? Option.getOrUndefined(Cause.findErrorOption(exit.cause))
        : undefined,
      logged: logged.join("\n"),
      succeeded: Exit.isSuccess(exit),
    };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
};

const expectNoCredential = (logged: string) => {
  for (const form of credentialForms) expect(logged).not.toContain(form);
  expect(logged).not.toContain("TEST_ONLY_not_a_secret");
  expect(logged).not.toContain("posthog.example");
};

describe("uploadSourceMaps", () => {
  test("bounds each CLI run", async () => {
    const { calls, succeeded } = await runUpload([uploaded]);

    expect(succeeded).toBe(true);
    expect(calls).toEqual([
      {
        command: [
          "/fake/posthog-cli",
          ...(sourceMapUpload(productionEnv, "/app/.next")?.args ?? []),
        ],
        timeoutMs: 600_000,
      },
    ]);
  });

  test("retries a transient failure and logs only its summary", async () => {
    const { calls, logged, succeeded } = await runUpload([
      transientFailure,
      uploaded,
    ]);

    expect(succeeded).toBe(true);
    expect(calls).toHaveLength(2);
    expect(logged).toBe(
      "PostHog source-map upload attempt failed (transient): posthog-cli exited with code 1 while starting the upload: HTTP 503. CLI output is withheld because it can echo credentials."
    );
    expectNoCredential(logged);
  });

  test("fails a permanent failure without retrying", async () => {
    const { calls, failure, logged } = await runUpload([permanentFailure]);

    expect(calls).toHaveLength(1);
    expect(failure).toEqual(
      expect.objectContaining({
        _tag: "SourceMapUploadFailed",
        kind: "permanent",
        summary:
          "posthog-cli exited with code 1 while creating the release: HTTP 401",
      })
    );
    expectNoCredential(logged);
  });

  test("fails without retrying when the CLI can't start", async () => {
    // With no scripted result, the runner rejects as a failed spawn would.
    const { calls, failure } = await runUpload([]);

    expect(calls).toHaveLength(1);
    expect(failure).toEqual(
      expect.objectContaining({
        _tag: "SourceMapUploadFailed",
        kind: "permanent",
        summary: "posthog-cli could not be started",
      })
    );
  });

  test("fails an interrupted run without retrying", async () => {
    const { calls, failure } = await runUpload([timedOut]);

    expect(calls).toHaveLength(1);
    expect(failure).toEqual(expect.objectContaining({ kind: "interrupted" }));
  });

  test("fails after retrying an unrecognised failure twice", async () => {
    const { calls, failure, logged } = await runUpload([
      unknownFailure,
      unknownFailure,
      unknownFailure,
    ]);

    expect(calls).toHaveLength(3);
    expect(failure).toEqual(
      expect.objectContaining({
        kind: "unknown",
        summary:
          "posthog-cli exited with code 1: no recognised error in its output",
      })
    );
    expectNoCredential(logged);
  });

  test("fails a forbidden chunk upload whose body names a transient status", async () => {
    const forbiddenChunk = failedWith(
      `ERROR posthog_cli::utils: Request failed: Response { url: "https://s3.example/chunk", status: 403 }
ERROR posthog_cli::utils: Response text: Request failed: Response { status: 503 }
Oops! Failed to upload chunk

Caused by:
    0: Request failed`
    );
    const distDir = await buildOutput();
    const { failure, succeeded } = await runUpload(
      [forbiddenChunk, forbiddenChunk, forbiddenChunk],
      distDir
    );

    expect(succeeded).toBe(false);
    expect(failure).toEqual(expect.objectContaining({ kind: "unknown" }));
    expect(
      await Bun.file(join(distDir, "static", "chunks", "app.js.map")).exists()
    ).toBe(true);
  });

  test("fails after retrying a request the CLI couldn't send", async () => {
    // CLI 0.16.2 prints the same error for DNS, connection, and TLS failures.
    const unsentRequest = failedWith(
      `WARN posthog_cli::api::releases: failed to get release from hash: Request error: error sending request for url (https://posthog.example/api/hash/1)
Oops! Request error: error sending request for url (https://posthog.example/api/hash/1)`
    );
    const distDir = await buildOutput();
    const { calls, failure, logged, succeeded } = await runUpload(
      [unsentRequest, unsentRequest, unsentRequest],
      distDir
    );

    expect(succeeded).toBe(false);
    expect(calls).toHaveLength(3);
    expect(failure).toEqual(
      expect.objectContaining({
        _tag: "SourceMapUploadFailed",
        kind: "unknown",
        summary:
          "posthog-cli exited with code 1 while looking up the release: request not sent",
      })
    );
    expect(logged).not.toContain(skippedSourceMapUploadMarker);
    expectNoCredential(logged);
    expect(
      await Bun.file(join(distDir, "static", "chunks", "app.js.map")).exists()
    ).toBe(true);
  });

  test("ships without public source maps when PostHog stays unavailable", async () => {
    const distDir = await buildOutput();

    const { calls, logged, succeeded } = await runUpload(
      [transientFailure, unknownFailure, transientFailure],
      distDir
    );

    expect(succeeded).toBe(true);
    expect(calls).toHaveLength(3);
    expect(logged).toContain(
      `${skippedSourceMapUploadMarker} posthog-cli exited with code 1 while starting the upload: HTTP 503. Deleted 2 public source maps;`
    );
    expectNoCredential(logged);
    expect(await readdir(join(distDir, "static"), { recursive: true })).toEqual(
      expect.arrayContaining(["chunks/app.js"])
    );
    expect(
      (await readdir(join(distDir, "static"), { recursive: true })).filter(
        (path) => path.endsWith(".map")
      )
    ).toEqual([]);
    expect(await readdir(join(distDir, "server"))).toEqual(["page.js.map"]);
  });

  test("fails when the public source maps can't be deleted", async () => {
    const { failure } = await runUpload(
      [transientFailure, transientFailure, transientFailure],
      "/nonexistent/.next"
    );

    expect(failure).toEqual(
      expect.objectContaining({ _tag: "SourceMapCleanupFailed" })
    );
  });
});
