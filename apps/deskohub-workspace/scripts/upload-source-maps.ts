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
import { fileURLToPath } from "node:url";
import { runCommand } from "./shared/command";

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

class SourceMapUploadFailed extends Error {}

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

export const runSourceMapUpload = async (
  upload: SourceMapUpload,
  posthogCli: string,
  commandRunner: typeof runCommand = runCommand
): Promise<void> => {
  const result = await commandRunner([posthogCli, ...upload.args], {
    env: { ...process.env, ...upload.env },
  });
  if (result.exitCode === 0 && result.signalCode === null && !result.timedOut) {
    return;
  }

  let outcome: string;
  if (result.timedOut) outcome = "timed out";
  else if (result.signalCode !== null) {
    outcome = `was ended by ${result.signalCode}`;
  } else {
    outcome = `exited with code ${result.exitCode}`;
  }
  process.stderr.write(
    `PostHog source-map upload failed (${outcome}). CLI output is withheld because it can echo credentials; rerun \`posthog-cli sourcemap process\` locally with the same environment to see details.\n`
  );
  throw new SourceMapUploadFailed(`posthog-cli ${outcome}`);
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
    const posthogCli = fileURLToPath(
      import.meta.resolve("@posthog/cli/run-posthog-cli.js")
    );
    try {
      await runSourceMapUpload(upload, posthogCli);
    } catch (error) {
      if (!(error instanceof SourceMapUploadFailed)) throw error;
      process.exitCode = 1;
    }
  }
}
