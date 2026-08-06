import { Console, Effect, Option } from "effect";
import { Command, Flag, Prompt } from "effect/unstable/cli";
import { WorkspaceAdminApiClient } from "./api/workspace-admin-api-client.service";
import { DHW_BUILD_TARGET, DHW_VERSION, isReleaseBuild } from "./build-info";
import { DhwConfig } from "./config/dhw-config.service";
import { UpdateService } from "./update/update.service";
import type { AvailableUpdate } from "./update/update-state-store.service";

const rootCommand = Command.make("dhw").pipe(
  Command.withSharedFlags({
    json: Flag.boolean("json").pipe(
      Flag.withDescription("Print machine-readable JSON output")
    ),
  }),
  Command.withDescription("Deskohub Workspace administration")
);

const versionCommand = Command.make("version", {}, () =>
  runCommand((json) =>
    Console.log(
      json
        ? JSON.stringify({ version: DHW_VERSION, target: DHW_BUILD_TARGET })
        : `dhw ${DHW_VERSION} (${DHW_BUILD_TARGET})`
    )
  )
).pipe(Command.withDescription("Show CLI version and build target"));

const apiInfoCommand = Command.make("info", {}, () =>
  runCommand((json) =>
    Effect.gen(function* () {
      const client = yield* WorkspaceAdminApiClient;
      const info = yield* client.getInfo;

      yield* Console.log(
        json
          ? JSON.stringify(info)
          : `${info.service} administration API ${info.apiVersion}`
      );
    })
  )
).pipe(Command.withDescription("Check the administration API contract"));

const apiCommand = Command.make("api").pipe(
  Command.withDescription("Inspect the administration API"),
  Command.withSubcommands([apiInfoCommand])
);

const updateCommand = Command.make(
  "update",
  {
    yes: Flag.boolean("yes").pipe(
      Flag.withDescription("Install an available update without prompting")
    ),
  },
  ({ yes }) =>
    Effect.gen(function* () {
      const { json } = yield* rootCommand;
      const updateService = yield* UpdateService;

      if (!isReleaseBuild) {
        yield* Console.log(
          json
            ? JSON.stringify({ status: "development-build" })
            : "Self-update is unavailable in development builds."
        );
        return;
      }

      const available = yield* updateService.check(true);

      if (Option.isNone(available)) {
        yield* Console.log(
          json
            ? JSON.stringify({ status: "current", version: DHW_VERSION })
            : `dhw ${DHW_VERSION} is current.`
        );
        return;
      }

      if (json && !yes) {
        yield* Console.log(
          JSON.stringify({ status: "available", ...available.value })
        );
        return;
      }

      const shouldInstall = yes || (yield* confirmUpdate(available.value));
      if (!shouldInstall) return;

      yield* installAndReport(available.value, json);
    })
).pipe(Command.withDescription("Check for and install a CLI update"));

export const dhwCommand = rootCommand.pipe(
  Command.withSubcommands([versionCommand, apiCommand, updateCommand])
);

const runCommand = <A, E, R>(
  operation: (json: boolean) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    const { json } = yield* rootCommand;
    const result = yield* operation(json);
    yield* offerAutomaticUpdate(json);
    return result;
  });

const offerAutomaticUpdate = (json: boolean) =>
  Effect.gen(function* () {
    const config = yield* DhwConfig;

    if (
      json ||
      config.isCi ||
      process.stdin.isTTY !== true ||
      process.stdout.isTTY !== true
    ) {
      return;
    }

    const updateService = yield* UpdateService;
    const available = yield* updateService
      .check(false)
      .pipe(Effect.orElseSucceed(() => Option.none<AvailableUpdate>()));

    if (Option.isNone(available)) return;

    const shouldInstall = yield* confirmUpdate(available.value);
    if (shouldInstall) {
      yield* installAndReport(available.value, false);
    }
  });

const confirmUpdate = (update: AvailableUpdate) =>
  Prompt.confirm({
    message: `Update dhw ${DHW_VERSION} to ${update.version}?`,
    initial: true,
  }).pipe(Prompt.run);

const installAndReport = (update: AvailableUpdate, json: boolean) =>
  Effect.gen(function* () {
    const updateService = yield* UpdateService;
    yield* updateService.install(update);
    yield* Console.log(
      json
        ? JSON.stringify({ status: "updated", version: update.version })
        : `Updated dhw to ${update.version}.`
    );
  });
