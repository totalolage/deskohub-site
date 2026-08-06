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
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* DhwConfig;
      const github = yield* GithubReleaseService;
      const installer = yield* ExecutableInstaller;
      const stateStore = yield* UpdateStateStore;

      return {
        check: Effect.fn("UpdateService.check")((force: boolean) =>
          checkForUpdate({ force, config, github, stateStore }).pipe(
            Effect.mapError(UpdateError.fromCause)
          )
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

interface CheckForUpdateInput {
  readonly force: boolean;
  readonly config: DhwConfig["Service"];
  readonly github: GithubReleaseService["Service"];
  readonly stateStore: UpdateStateStore["Service"];
}

const checkForUpdate = Effect.fn("checkForUpdate")(function* ({
  force,
  config,
  github,
  stateStore,
}: CheckForUpdateInput) {
  if (!isReleaseBuild || (!force && config.updateChecksDisabled)) {
    return Option.none<AvailableUpdate>();
  }

  const state = yield* stateStore.get;
  const now = yield* Clock.currentTimeMillis;

  if (
    !force &&
    state.lastAttemptedAt !== undefined &&
    now - state.lastAttemptedAt < updateCheckIntervalMillis
  ) {
    return Option.none<AvailableUpdate>();
  }

  yield* stateStore.set({ ...state, lastAttemptedAt: now });
  const result = yield* github.list(state.etag);
  const available =
    result._tag === "NotModified"
      ? state.available
      : selectAvailableUpdate(
          result.releases,
          DHW_BUILD_TARGET as ReleaseBuildTarget
        );
  const nextState: UpdateState = {
    lastAttemptedAt: now,
    lastSuccessfulAt: now,
    ...(result.etag === undefined && state.etag === undefined
      ? {}
      : { etag: result.etag ?? state.etag }),
    ...(available === undefined ? {} : { available }),
  };

  yield* stateStore.set(nextState);

  return available !== undefined && gt(available.version, DHW_VERSION)
    ? Option.some(available)
    : Option.none<AvailableUpdate>();
});

export const selectAvailableUpdate = (
  releases: ReadonlyArray<GithubRelease>,
  target: ReleaseBuildTarget
): AvailableUpdate | undefined => {
  const candidates = releases
    .flatMap((release) => {
      if (
        release.draft ||
        release.prerelease ||
        !release.immutable ||
        !release.tag_name.startsWith(cliTagPrefix)
      ) {
        return [];
      }

      const version = valid(release.tag_name.slice(cliTagPrefix.length));
      const asset = release.assets.find(
        (candidate) => candidate.name === `dhw-${target}`
      );

      if (
        version === null ||
        asset === undefined ||
        asset.digest === null ||
        prerelease(version) !== null ||
        !Number.isSafeInteger(asset.size) ||
        asset.size <= 0 ||
        !/^sha256:[a-f0-9]{64}$/.test(asset.digest) ||
        !isGithubReleaseUrl(release.html_url) ||
        !isGithubReleaseUrl(asset.browser_download_url)
      ) {
        return [];
      }

      return [
        {
          version,
          releaseUrl: release.html_url.href,
          assetUrl: asset.browser_download_url.href,
          assetDigest: asset.digest,
          assetSize: asset.size,
          target,
        } satisfies AvailableUpdate,
      ];
    })
    .sort((left, right) => rcompare(left.version, right.version));

  return candidates[0];
};

const isGithubReleaseUrl = (url: URL) =>
  url.protocol === "https:" &&
  url.hostname === "github.com" &&
  url.pathname.startsWith("/totalolage/deskohub-site/releases/");
