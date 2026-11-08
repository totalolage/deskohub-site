/**
 * Publishes an over-the-air update of the mobile app to a deployment's Expo
 * Updates server, or rolls installed apps back to their embedded update:
 *
 *   bun scripts/publish-mobile-update.ts --project <Expo app directory>
 *     --target <deployment origin> [--platform android --platform ios]
 *     [--rollback] [--certificate <code-signing certificate PEM>]
 *
 * It runs from apps/deskohub-workspace. Each platform publishes the update
 * `expo export` builds for the runtime version `expo-updates` resolves, so
 * only builds with a matching native runtime get it. Once a platform is
 * published, the script checks for an update as an installed app would and
 * fails unless the deployment serves that update, signed so the app's
 * embedded certificate verifies it. Secrets come from the environment, as
 * `MobileUpdatePublishConfig` documents.
 */
import { createPublicKey } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Console, Data, Effect, Layer, Schema } from "effect";
import { MobileUpdatePlatform } from "@/features/mobile-updates/mobile-update-publication";
import { MobileUpdatePublishConfig } from "@/features/mobile-updates/publish/mobile-update-publish-config";
import { MobileUpdatesDeployment } from "@/features/mobile-updates/publish/mobile-updates-deployment.service";
import {
  type PlatformRuntimeVersions,
  publishMobileUpdates,
  rollBackMobileUpdates,
} from "@/features/mobile-updates/publish/publish-mobile-updates";
import { UpdateAssetStorage } from "@/features/mobile-updates/publish/update-asset-storage.service";
import { runStandaloneWorkspaceEffect } from "@/shared/backend/standalone-workspace-effect";
import { isLoopbackHostname } from "@/shared/utils/hostname";
import { runCommand } from "./shared/command";

/** The certificate the app embeds to verify update signatures. */
const appCertificatePath = fileURLToPath(
  new URL(
    "../features/mobile-updates/code-signing-certificate.pem",
    import.meta.url
  )
);

const allPlatforms: readonly MobileUpdatePlatform[] = ["android", "ios"];

/** `expo export` bundles the whole app, which can take a while in CI. */
const exportTimeoutMs = 15 * 60_000;
const expoCommandTimeoutMs = 3 * 60_000;

/** Secrets the script reads that the Expo CLI never needs. */
const publishSecrets = [
  "BLOB_READ_WRITE_TOKEN",
  "MOBILE_UPDATES_PUBLISH_TOKEN",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
] as const;

class PublishUsageInvalid extends Data.TaggedError("PublishUsageInvalid")<{
  readonly message: string;
}> {}

class ExpoCommandFailed extends Data.TaggedError("ExpoCommandFailed")<{
  readonly message: string;
}> {}

interface PublishOptions {
  readonly project: string;
  readonly target: URL;
  readonly platforms: readonly MobileUpdatePlatform[];
  readonly rollback: boolean;
  readonly certificate: string;
}

const RuntimeVersionResolution = Schema.fromJsonString(
  Schema.Struct({ runtimeVersion: Schema.NonEmptyString })
);
const PublicExpoConfig = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Json)
);
const decodePlatform = Schema.decodeUnknownEffect(MobileUpdatePlatform);

/** The app's public key, and the runtime version of each platform's build. */
const readAppTarget = Effect.fnUntraced(function* (options: PublishOptions) {
  const appPublicKey = yield* readAppPublicKey(options.certificate);
  const runtimeVersions: PlatformRuntimeVersions = new Map(
    yield* Effect.forEach(options.platforms, (platform) =>
      resolveRuntimeVersion(options.project, platform).pipe(
        Effect.map((runtimeVersion) => [platform, runtimeVersion] as const)
      )
    )
  );
  return { appPublicKey, runtimeVersions };
});

const publishUpdate = Effect.fn("MobileUpdates.publishUpdate")(function* (
  options: PublishOptions
) {
  const appTarget = yield* readAppTarget(options);
  const expoClient = yield* readPublicExpoConfig(options.project);
  const exportDirectory = yield* exportUpdate(options);
  return yield* publishMobileUpdates({
    ...appTarget,
    exportDirectory,
    expoClient,
  });
}, Effect.scoped);

const rollBack = Effect.fn("MobileUpdates.rollBack")(function* (
  options: PublishOptions
) {
  return yield* rollBackMobileUpdates(yield* readAppTarget(options));
});

/** A rollback stores no files, so it never needs the Blob store. */
const run = Effect.fn("MobileUpdates.run")(function* (options: PublishOptions) {
  const config = MobileUpdatePublishConfig.Default(options.target);
  return yield* options.rollback
    ? rollBack(options).pipe(
        Effect.provide(MobileUpdatesDeployment.Live.pipe(Layer.provide(config)))
      )
    : publishUpdate(options).pipe(
        Effect.provide(
          Layer.mergeAll(
            UpdateAssetStorage.Default,
            MobileUpdatesDeployment.Live
          ).pipe(Layer.provide(config))
        )
      );
});

const readOptions = Effect.fn("MobileUpdates.readOptions")(function* (
  argv: readonly string[]
) {
  const { values } = yield* Effect.try({
    try: () =>
      parseArgs({
        args: [...argv],
        options: {
          project: { type: "string" },
          target: { type: "string" },
          platform: { type: "string", multiple: true },
          rollback: { type: "boolean", default: false },
          certificate: { type: "string", default: appCertificatePath },
        },
      }),
    catch: (cause) =>
      new PublishUsageInvalid({
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });
  const { project, target, certificate } = values;
  if (!project || !target || !URL.canParse(target)) {
    return yield* new PublishUsageInvalid({
      message:
        "Usage: publish-mobile-update.ts --project <dir> --target <origin> [--platform android|ios]... [--rollback] [--certificate <pem>]",
    });
  }
  const targetUrl = new URL(target);
  // The publish token and protection bypass travel with every request, so
  // only a local deployment may be reached without TLS.
  const encrypted =
    targetUrl.protocol === "https:" ||
    (targetUrl.protocol === "http:" && isLoopbackHostname(targetUrl.hostname));
  if (!encrypted) {
    return yield* new PublishUsageInvalid({
      message: "The target must be an https deployment origin",
    });
  }

  const platforms = yield* Effect.forEach(
    values.platform ?? allPlatforms,
    (platform) =>
      decodePlatform(platform).pipe(
        Effect.mapError(
          () =>
            new PublishUsageInvalid({
              message: `Unknown platform ${platform}; use android or ios`,
            })
        )
      )
  );
  return {
    project,
    target: new URL(targetUrl.origin),
    platforms: [...new Set(platforms)],
    rollback: values.rollback,
    certificate,
  } satisfies PublishOptions;
});

const readAppPublicKey = (certificate: string) =>
  Effect.tryPromise({
    try: async () => createPublicKey(await readFile(certificate)),
    catch: () =>
      new PublishUsageInvalid({
        message: `The code-signing certificate ${certificate} is unreadable`,
      }),
  });

/**
 * Runs a CLI the Expo project installs, from the project directory, without
 * the publish secrets in its environment.
 */
const runExpo = (
  project: string,
  command: readonly string[],
  timeoutMs = expoCommandTimeoutMs
) =>
  Effect.tryPromise({
    try: () =>
      runCommand([process.execPath, "x", "--no-install", ...command], {
        cwd: project,
        env: {
          ...process.env,
          ...Object.fromEntries(
            publishSecrets.map((name) => [name, undefined])
          ),
        },
        timeoutMs,
      }),
    catch: (cause) =>
      new ExpoCommandFailed({
        message: `${command.slice(0, 2).join(" ")} could not run: ${String(cause)}`,
      }),
  }).pipe(
    Effect.filterOrFail(
      ({ exitCode }) => exitCode === 0,
      ({ exitCode, timedOut, stderr }) =>
        new ExpoCommandFailed({
          message: `${command.slice(0, 2).join(" ")} ${
            timedOut ? "timed out" : `exited with ${exitCode}`
          }: ${stderr.trim().split("\n").slice(-20).join("\n")}`,
        })
    ),
    Effect.map(({ stdout }) => stdout)
  );

const resolveRuntimeVersion = (
  project: string,
  platform: MobileUpdatePlatform
) =>
  runExpo(project, [
    "expo-updates",
    "runtimeversion:resolve",
    "--platform",
    platform,
  ]).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(RuntimeVersionResolution)),
    Effect.map(({ runtimeVersion }) => runtimeVersion),
    Effect.catchTag("SchemaError", () =>
      Effect.fail(
        new ExpoCommandFailed({
          message: `expo-updates resolved no ${platform} runtime version`,
        })
      )
    )
  );

const readPublicExpoConfig = (project: string) =>
  runExpo(project, ["expo", "config", "--type", "public", "--json"]).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(PublicExpoConfig)),
    Effect.catchTag("SchemaError", () =>
      Effect.fail(
        new ExpoCommandFailed({
          message: "expo config printed no public config",
        })
      )
    )
  );

/** Exports the update into a directory the run's scope removes. */
const exportUpdate = ({ project, platforms }: PublishOptions) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "mobile-update-export-")),
      catch: () =>
        new ExpoCommandFailed({
          message: "No temporary directory for the export",
        }),
    }),
    (directory) =>
      Effect.promise(() => rm(directory, { recursive: true, force: true }))
  ).pipe(
    Effect.tap((directory) =>
      runExpo(
        project,
        [
          "expo",
          "export",
          ...platforms.flatMap((platform) => ["--platform", platform]),
          "--dump-assetmap",
          "--output-dir",
          directory,
        ],
        exportTimeoutMs
      )
    )
  );

/** Surfaces the failure as a GitHub Actions error and fails the step. */
const reportFailure = ({ message }: { readonly message: string }) =>
  Console.error(`::error title=Mobile update publish failed::${message}`).pipe(
    Effect.andThen(
      Effect.sync(() => {
        process.exitCode = 1;
      })
    )
  );

if (import.meta.main) {
  await readOptions(process.argv.slice(2)).pipe(
    Effect.flatMap(run),
    Effect.catch(reportFailure),
    runStandaloneWorkspaceEffect("mobile-updates.publish")
  );
}
