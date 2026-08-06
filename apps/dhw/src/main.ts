import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { Command } from "effect/unstable/cli";
import { FetchHttpClient, Headers } from "effect/unstable/http";
import { WorkspaceAdminApiClient } from "./api/workspace-admin-api-client.service";
import { DHW_VERSION } from "./build-info";
import { dhwCommand } from "./command";
import { DhwConfig } from "./config/dhw-config.service";
import { CredentialStore } from "./credentials/credential-store.service";
import { ExecutableInstaller } from "./update/executable-installer.service";
import { GithubReleaseService } from "./update/github-release.service";
import { UpdateService } from "./update/update.service";
import { UpdateStateStore } from "./update/update-state-store.service";

const UpdateLive = UpdateService.Live.pipe(
  Layer.provide(UpdateStateStore.Live),
  Layer.provide(GithubReleaseService.Live),
  Layer.provide(ExecutableInstaller.Live)
);

const ApplicationLive = Layer.mergeAll(
  WorkspaceAdminApiClient.Live,
  CredentialStore.Live,
  UpdateLive
).pipe(
  Layer.provideMerge(DhwConfig.Live),
  Layer.provide(FetchHttpClient.layer)
);

const RuntimeLive = ApplicationLive.pipe(Layer.provideMerge(BunServices.layer));

Command.run(dhwCommand, { version: DHW_VERSION }).pipe(
  Effect.provide(RuntimeLive),
  Effect.updateService(Headers.CurrentRedactedNames, (names) => [
    ...names,
    "x-vercel-protection-bypass",
  ]),
  BunRuntime.runMain
);
