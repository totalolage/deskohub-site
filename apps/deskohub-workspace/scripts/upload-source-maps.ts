/**
 * The `build:source-maps` task: between `build:compile` and generation,
 * `posthog-cli` injects chunk IDs into a production build's chunks, uploads
 * its source maps to PostHog, then deletes them and their `sourceMappingURL`
 * comments, so the deployment never serves them. It runs in its own process,
 * apart from the compiler: inside the compile process it overlapped
 * Turbopack's cache write and left a cold production compile no headroom on
 * Vercel's 8 GB build machine. Other builds emit no browser source maps (see
 * `productionBrowserSourceMaps` in next.config.mjs) and upload nothing.
 *
 * The CLI's output is never printed because it can echo credentials; each
 * failed attempt logs a summary from `describeSourceMapUploadFailure`.
 * Transient and unrecognised failures are retried. When PostHog stays
 * unavailable, the release ships without uploaded source maps: the public maps
 * are deleted and production-build.ts raises a GitHub warning. Any other
 * failure stops the production build, including a request the CLI couldn't
 * send for a reason its output doesn't name.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Console, Data, Effect, Match, Schedule } from "effect";
import { runStandaloneWorkspaceEffect } from "@/shared/backend/standalone-workspace-effect";
import { runCommand } from "./shared/command";
import {
  describeSourceMapUploadFailure,
  type SourceMapUploadFailure,
  skippedSourceMapUploadMarker,
} from "./source-map-upload-failure";

type SourceMapUpload = {
  readonly args: readonly string[];
  /** Credentials stay in the environment, out of the logged command line. */
  readonly env: Readonly<{
    readonly POSTHOG_CLI_API_KEY: string;
    readonly POSTHOG_CLI_HOST: string;
    readonly POSTHOG_CLI_PROJECT_ID: string;
    readonly RUST_LOG: string;
  }>;
};

interface SourceMapUploadRun {
  readonly upload: SourceMapUpload;
  readonly posthogCli: string;
  /** The build output the CLI processes; its `static` maps are public. */
  readonly distDir: string;
  readonly commandRunner?: typeof runCommand;
}

/** Far above a normal upload; the CLI retries its own requests within it. */
const attemptTimeoutMs = 10 * 60_000;

class SourceMapUploadFailed extends Data.TaggedError(
  "SourceMapUploadFailed"
)<SourceMapUploadFailure> {}

class SourceMapCleanupFailed extends Data.TaggedError(
  "SourceMapCleanupFailed"
)<{
  readonly message: string;
  readonly cause: unknown;
}> {}

const requireVariable = (
  env: Readonly<Record<string, string | undefined>>,
  name: string
): string => {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required to upload production source maps`);
  }
  return value;
};

/** The upload for a production build; `undefined` for any other build. */
export const sourceMapUpload = (
  env: Readonly<Record<string, string | undefined>>,
  distDir: string
): SourceMapUpload | undefined => {
  if (env.VERCEL_ENV !== "production") return undefined;
  const release = env.VERCEL_GIT_COMMIT_SHA;
  return {
    args: [
      "sourcemap",
      "process",
      "--directory",
      distDir,
      "--release-name",
      "deskohub-workspace",
      ...(release ? ["--release-version", release] : []),
      // The SDK reports the release per exception from the ID injected into
      // each chunk, so symbol sets stay independent of releases.
      "--release-mode",
      "event",
      "--delete-after",
    ],
    env: {
      POSTHOG_CLI_API_KEY: requireVariable(env, "POSTHOG_API_KEY"),
      POSTHOG_CLI_HOST: requireVariable(env, "POSTHOG_API_HOST"),
      POSTHOG_CLI_PROJECT_ID: requireVariable(env, "POSTHOG_PROJECT_ID"),
      RUST_LOG: "posthog_cli=info",
    },
  };
};

/**
 * One `sourcemap process` run. Rerunning it is safe: the CLI keeps chunk IDs
 * it already injected and deletes maps only after a successful upload.
 */
const processSourceMaps = ({
  upload,
  posthogCli,
  commandRunner = runCommand,
}: SourceMapUploadRun) =>
  Effect.tryPromise({
    try: () =>
      commandRunner([posthogCli, ...upload.args], {
        env: { ...process.env, ...upload.env },
        timeoutMs: attemptTimeoutMs,
      }),
    // A CLI that can't start won't on a rerun either.
    catch: () =>
      new SourceMapUploadFailed({
        kind: "permanent",
        summary: "posthog-cli could not be started",
      }),
  }).pipe(
    Effect.filterOrFail(
      (result) =>
        result.exitCode === 0 && result.signalCode === null && !result.timedOut,
      (result) =>
        new SourceMapUploadFailed(describeSourceMapUploadFailure(result))
    ),
    Effect.tapError(({ kind, summary }) =>
      Console.error(
        `PostHog source-map upload attempt failed (${kind}): ${summary}. CLI output is withheld because it can echo credentials.`
      )
    )
  );

/**
 * Deletes the browser source maps the CLI would have deleted after uploading,
 * so the deployment doesn't serve them. Server maps never reach the browser.
 */
const deletePublicSourceMaps = (distDir: string) =>
  Effect.tryPromise({
    try: async () => {
      const staticDir = join(distDir, "static");
      const maps = await Array.fromAsync(
        new Bun.Glob("**/*.map").scan({ cwd: staticDir, onlyFiles: true })
      );
      await Promise.all(maps.map((map) => rm(join(staticDir, map))));
      return maps.length;
    },
    catch: (cause) =>
      new SourceMapCleanupFailed({
        message: "The public source maps could not be deleted",
        cause,
      }),
  });

const skipUpload = ({
  failure,
  distDir,
}: {
  readonly failure: SourceMapUploadFailed;
  readonly distDir: string;
}) =>
  deletePublicSourceMaps(distDir).pipe(
    Effect.flatMap((deleted) =>
      Console.log(
        `${skippedSourceMapUploadMarker} ${failure.summary}. Deleted ${deleted} public source map${deleted === 1 ? "" : "s"}; errors from this release's new chunks stay unsymbolicated in PostHog.`
      )
    )
  );

export const uploadSourceMaps = (run: SourceMapUploadRun) =>
  processSourceMaps(run).pipe(
    Effect.retry({
      schedule: Schedule.exponential("5 seconds"),
      times: 2,
      while: ({ kind }) => kind === "transient" || kind === "unknown",
    }),
    // Only an outage PostHog has confirmed ships without source maps. Every
    // other failure needs a fix or can't vouch for the rewritten chunks.
    Effect.catchIf(
      ({ kind }) => kind === "transient",
      (failure) => skipUpload({ failure, distDir: run.distDir })
    ),
    Effect.withSpan("SourceMaps.upload")
  );

const reportBuildFailure = (
  failure: SourceMapUploadFailed | SourceMapCleanupFailed
) =>
  Console.error(
    Match.valueTags(failure, {
      SourceMapUploadFailed: ({ kind, summary }) =>
        `PostHog source-map upload failed (${kind}): ${summary}. Stopping the production build.`,
      SourceMapCleanupFailed: ({ message }) =>
        `${message}. Stopping the production build so they aren't deployed.`,
    })
  ).pipe(
    Effect.andThen(
      Effect.sync(() => {
        process.exitCode = 1;
      })
    )
  );

if (import.meta.main) {
  const distDir = join(import.meta.dir, "..", ".next");
  const upload = sourceMapUpload(process.env, distDir);
  if (upload === undefined) {
    process.stdout.write(
      "Not a production build; skipping the source-map upload.\n"
    );
  } else {
    const posthogCli = fileURLToPath(
      import.meta.resolve("@posthog/cli/run-posthog-cli.js")
    );
    await uploadSourceMaps({ upload, posthogCli, distDir }).pipe(
      Effect.catch(reportBuildFailure),
      runStandaloneWorkspaceEffect("source-maps.upload")
    );
  }
}
