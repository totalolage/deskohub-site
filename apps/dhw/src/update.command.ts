import { Console, Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { DHW_VERSION, isReleaseBuild } from "./build-info";
import {
  confirmUpdate,
  installAndReport,
  rootCommand,
} from "./command-runtime";
import { UpdateService } from "./update/update.service";

/**
 * Forces an update check and installs a newer release once `--yes` or the
 * operator confirms it. With `--json` and no `--yes`, it only reports the
 * available update.
 */
export const checkAndInstallUpdate = ({
  json,
  yes,
}: {
  readonly json: boolean;
  readonly yes: boolean;
}) =>
  Effect.gen(function* () {
    const updateService = yield* UpdateService;
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
  });

export const updateCommand = Command.make(
  "update",
  {
    yes: Flag.boolean("yes").pipe(
      Flag.withDescription("Install an available update without prompting")
    ),
  },
  ({ yes }) =>
    Effect.gen(function* () {
      const { json } = yield* rootCommand;

      if (!isReleaseBuild) {
        yield* Console.log(
          json
            ? JSON.stringify({ status: "development-build" })
            : "Self-update is available only in published releases."
        );
        return;
      }

      yield* checkAndInstallUpdate({ json, yes });
    })
).pipe(Command.withDescription("Check for and install a CLI update"));
