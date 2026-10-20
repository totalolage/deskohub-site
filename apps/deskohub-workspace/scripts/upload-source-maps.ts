/**
 * The `build:source-maps` task: between `build:compile` and generation,
 * `posthog-cli` injects chunk IDs into a production build's chunks, uploads
 * its source maps to PostHog, then deletes them and their `sourceMappingURL`
 * comments, so the deployment never serves them. It runs in its own process,
 * apart from the compiler: inside the compile process it overlapped
 * Turbopack's cache write and left a cold production compile no headroom on
 * Vercel's 8 GB build machine. Other builds emit no browser source maps (see
 * `productionBrowserSourceMaps` in next.config.mjs) and upload nothing.
 */
import { join } from "node:path";
import { runCommand } from "./shared/command";

type SourceMapUpload = {
  readonly args: readonly string[];
  /** Credentials stay in the environment, out of the logged command line. */
  readonly env: Readonly<Record<string, string>>;
};

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

if (import.meta.main) {
  const upload = sourceMapUpload(
    process.env,
    join(import.meta.dir, "..", ".next")
  );
  if (upload === undefined) {
    process.stdout.write(
      "Not a production build; skipping the source-map upload.\n"
    );
  } else {
    const result = await runCommand(["posthog-cli", ...upload.args], {
      env: { ...process.env, ...upload.env },
    });
    if (
      result.exitCode !== 0 ||
      result.signalCode !== null ||
      result.timedOut
    ) {
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      let outcome: string;
      if (result.timedOut) outcome = "timed out";
      else if (result.signalCode !== null) {
        outcome = `was ended by ${result.signalCode}`;
      } else {
        outcome = `exited with code ${result.exitCode}`;
      }
      throw new Error(`posthog-cli ${outcome}`);
    }
  }
}
