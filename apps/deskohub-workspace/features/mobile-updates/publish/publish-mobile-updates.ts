import type { KeyObject } from "node:crypto";
import { randomUUID } from "node:crypto";
import { Effect, type Schema } from "effect";
import type {
  MobileUpdatePlatform,
  MobileUpdatePublication,
} from "../mobile-update-publication";
import { readExportedUpdates, toUpdatePublication } from "./exported-update";
import { verifyManifestReply } from "./manifest-verification";
import { MobileUpdatesDeployment } from "./mobile-updates-deployment.service";
import { storeUpdateFiles } from "./store-update-files";

/** The runtime version each platform's native build reports. */
export type PlatformRuntimeVersions = ReadonlyMap<MobileUpdatePlatform, string>;

/** The platforms a run publishes to, in order, and how to check the result. */
interface PublishRun {
  readonly runtimeVersions: PlatformRuntimeVersions;
  /** The public key of the code-signing certificate the app embeds. */
  readonly appPublicKey: KeyObject;
}

/**
 * Publishes the update `expo export` wrote to `exportDirectory` for each
 * platform. It first checks that the deployment signs what it serves so the
 * app accepts it, and stores every file before anything is published; then each
 * platform is published and checked as an installed app would check it
 * before the next one, so a deployment that serves unverifiable updates stops
 * the run after one platform.
 */
export const publishMobileUpdates = Effect.fn("publishMobileUpdates")(
  function* ({
    exportDirectory,
    expoClient,
    runtimeVersions,
    appPublicKey,
  }: PublishRun & {
    readonly exportDirectory: string;
    readonly expoClient: Schema.Json;
  }) {
    const updates = yield* readExportedUpdates(exportDirectory, [
      ...runtimeVersions.keys(),
    ]);
    yield* verifyDeploymentSigning({ runtimeVersions, appPublicKey });
    const { assetUrls, uploaded, reused } = yield* storeUpdateFiles(
      updates.flatMap(({ launchAsset, assets }) => [launchAsset, ...assets])
    );
    yield* Effect.logInfo("Mobile update files stored").pipe(
      Effect.annotateLogs({ uploaded, reused })
    );

    return yield* Effect.forEach(updates, (update) =>
      publishAndVerify(
        toUpdatePublication(update, {
          id: randomUUID(),
          runtimeVersion: runtimeVersionOf(runtimeVersions, update.platform),
          expoClient,
          assetUrls,
        }),
        appPublicKey
      )
    );
  }
);

/**
 * Sends installed apps on each platform back to the update embedded in their
 * build, checking each platform's directive before the next one.
 */
export const rollBackMobileUpdates = Effect.fn("rollBackMobileUpdates")(
  function* ({ runtimeVersions, appPublicKey }: PublishRun) {
    yield* verifyDeploymentSigning({ runtimeVersions, appPublicKey });
    return yield* Effect.forEach(
      runtimeVersions,
      ([platform, runtimeVersion]) =>
        publishAndVerify(
          {
            type: "rollBackToEmbedded",
            id: randomUUID(),
            platform,
            runtimeVersion,
          },
          appPublicKey
        )
    );
  }
);

/**
 * Checks for an update on each platform before anything changes, so a
 * deployment whose signing key doesn't match the app's certificate fails the
 * run before installed apps are offered an update they would reject.
 */
const verifyDeploymentSigning = Effect.fnUntraced(function* ({
  runtimeVersions,
  appPublicKey,
}: PublishRun) {
  const deployment = yield* MobileUpdatesDeployment;
  yield* Effect.forEach(runtimeVersions, ([platform, runtimeVersion]) =>
    deployment
      .checkForUpdate({ platform, runtimeVersion })
      .pipe(
        Effect.flatMap((reply) =>
          verifyManifestReply(reply, { type: "any" }, appPublicKey)
        )
      )
  );
});

const runtimeVersionOf = (
  runtimeVersions: PlatformRuntimeVersions,
  platform: MobileUpdatePlatform
) => {
  const runtimeVersion = runtimeVersions.get(platform);
  if (runtimeVersion === undefined) {
    throw new Error(`No runtime version for ${platform}`);
  }
  return runtimeVersion;
};

const publishAndVerify = Effect.fnUntraced(function* (
  publication: MobileUpdatePublication,
  appPublicKey: KeyObject
) {
  const deployment = yield* MobileUpdatesDeployment;
  const { id, platform, runtimeVersion, type } = publication;

  const outcome = yield* deployment.publish(publication);
  const reply = yield* deployment.checkForUpdate({ platform, runtimeVersion });
  yield* verifyManifestReply(
    reply,
    type === "update" ? { type, id } : { type },
    appPublicKey
  );

  const summary = {
    platform,
    type,
    id,
    runtimeVersion,
    outcome,
  };
  yield* Effect.logInfo("Mobile update published").pipe(
    Effect.annotateLogs(summary)
  );
  return summary;
});
