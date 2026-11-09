import { Clock, Context, Data, Effect, Layer, Option } from "effect";
import { gt, prerelease, rcompare, valid } from "semver";
import {
  DHW_BUILD_TARGET,
  DHW_VERSION,
  isReleaseBuild,
  type ReleaseBuildTarget,
} from "../build-info";
import { DhwConfig } from "../config/dhw-config.service";
import { ExecutableInstaller } from "./executable-installer.service";
import {
  type GithubRelease,
  type GithubReleaseResult,
  GithubReleaseService,
} from "./github-release.service";
import {
  type AvailableUpdate,
  type UpdateState,
  UpdateStateStore,
} from "./update-state-store.service";

const updateCheckIntervalMillis = 30_000;
const cliTagPrefix = "dhw-v";

interface IUpdateService {
  readonly check: (
    force: boolean
  ) => Effect.Effect<Option.Option<AvailableUpdate>, UpdateError>;
  readonly install: (
    update: AvailableUpdate
  ) => Effect.Effect<void, UpdateError>;
}

export class UpdateService extends Context.Service<
  UpdateService,
  IUpdateService
>()("UpdateService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* DhwConfig;
      const github = yield* GithubReleaseService;
      const installer = yield* ExecutableInstaller;
      const stateStore = yield* UpdateStateStore;

      return {
        check: Effect.fn("UpdateService.check")((force: boolean) =>
          checkForUpdate({
            force,
            build: runningReleaseBuild,
            config,
            github,
            stateStore,
          }).pipe(Effect.mapError(UpdateError.fromCause))
        ),
        install: Effect.fn("UpdateService.install")((update: AvailableUpdate) =>
          installer.install(update).pipe(Effect.mapError(UpdateError.fromCause))
        ),
      };
    })
  );
}

export class UpdateError extends Data.TaggedError("UpdateError")<{
  readonly message: string;
  readonly cause: unknown;
}> {
  static fromCause = (cause: unknown) =>
    cause instanceof UpdateError
      ? cause
      : new UpdateError({
          message: "The CLI update operation failed.",
          cause,
        });
}

/** The published release this executable runs as, if it is one. */
interface ReleaseBuild {
  readonly version: string;
  readonly target: ReleaseBuildTarget;
}

const runningReleaseBuild: ReleaseBuild | undefined = isReleaseBuild
  ? { version: DHW_VERSION, target: DHW_BUILD_TARGET as ReleaseBuildTarget }
  : undefined;

interface CheckForUpdateInput {
  readonly force: boolean;
  readonly build: ReleaseBuild | undefined;
  readonly config: DhwConfig["Service"];
  readonly github: GithubReleaseService["Service"];
  readonly stateStore: UpdateStateStore["Service"];
}

export const checkForUpdate = Effect.fn("checkForUpdate")(function* ({
  force,
  build,
  config,
  github,
  stateStore,
}: CheckForUpdateInput) {
  if (build === undefined || (!force && config.updateChecksDisabled)) {
    return Option.none<AvailableUpdate>();
  }

  const state = yield* stateStore.get;
  const now = yield* Clock.currentTimeMillis;

  if (!force && wasAttemptedRecently(state, now)) {
    return Option.none<AvailableUpdate>();
  }

  yield* stateStore.set({ ...state, lastAttemptedAt: now });
  const result = yield* github.list(state.etag);
  const available =
    result._tag === "NotModified"
      ? state.available
      : selectAvailableUpdate(result.releases, build.target);

  yield* stateStore.set(checkedUpdateState({ state, result, available, now }));

  return newerUpdate(available, build.version);
});

const wasAttemptedRecently = (state: UpdateState, now: number) =>
  state.lastAttemptedAt !== undefined &&
  now - state.lastAttemptedAt < updateCheckIntervalMillis;

const checkedUpdateState = ({
  state,
  result,
  available,
  now,
}: {
  readonly state: UpdateState;
  readonly result: GithubReleaseResult;
  readonly available: AvailableUpdate | undefined;
  readonly now: number;
}): UpdateState => ({
  lastAttemptedAt: now,
  lastSuccessfulAt: now,
  ...(result.etag === undefined && state.etag === undefined
    ? {}
    : { etag: result.etag ?? state.etag }),
  ...(available === undefined ? {} : { available }),
});

const newerUpdate = (
  available: AvailableUpdate | undefined,
  runningVersion: string
) =>
  available !== undefined && gt(available.version, runningVersion)
    ? Option.some(available)
    : Option.none<AvailableUpdate>();

export const selectAvailableUpdate = (
  releases: ReadonlyArray<GithubRelease>,
  target: ReleaseBuildTarget
): AvailableUpdate | undefined =>
  releases
    .flatMap((release) => {
      const update = releaseUpdate(release, target);
      return update === undefined ? [] : [update];
    })
    .sort((left, right) => rcompare(left.version, right.version))[0];

type GithubReleaseAsset = GithubRelease["assets"][number];

const releaseUpdate = (
  release: GithubRelease,
  target: ReleaseBuildTarget
): AvailableUpdate | undefined => {
  if (!isPublishedCliRelease(release)) {
    return undefined;
  }

  const version = stableCliVersion(release.tag_name);
  const asset = release.assets.find(
    (candidate) => candidate.name === `dhw-${target}`
  );

  if (
    version === undefined ||
    asset === undefined ||
    !isVerifiableAsset(asset) ||
    !isGithubReleaseUrl(release.html_url)
  ) {
    return undefined;
  }

  return {
    version,
    releaseUrl: release.html_url.href,
    assetUrl: asset.browser_download_url.href,
    assetDigest: asset.digest,
    assetSize: asset.size,
    target,
  };
};

const isPublishedCliRelease = (release: GithubRelease) =>
  !release.draft &&
  !release.prerelease &&
  release.immutable &&
  release.tag_name.startsWith(cliTagPrefix);

const stableCliVersion = (tagName: string) => {
  const version = valid(tagName.slice(cliTagPrefix.length));
  return version !== null && prerelease(version) === null ? version : undefined;
};

const isVerifiableAsset = (
  asset: GithubReleaseAsset
): asset is GithubReleaseAsset & { readonly digest: string } =>
  asset.digest !== null &&
  Number.isSafeInteger(asset.size) &&
  asset.size > 0 &&
  /^sha256:[a-f0-9]{64}$/.test(asset.digest) &&
  isGithubReleaseUrl(asset.browser_download_url);

const isGithubReleaseUrl = (url: URL) =>
  url.protocol === "https:" &&
  url.hostname === "github.com" &&
  url.pathname.startsWith("/totalolage/deskohub-site/releases/");
