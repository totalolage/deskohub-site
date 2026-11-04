import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer, Option } from "effect";
import { Command } from "effect/unstable/cli";
import { DHW_VERSION } from "./build-info";
import { dhwCommand } from "./command";
import { DhwConfig } from "./config/dhw-config.service";
import { UpdateService } from "./update/update.service";
import type { AvailableUpdate } from "./update/update-state-store.service";
import { checkAndInstallUpdate } from "./update.command";

const availableUpdate: AvailableUpdate = {
  version: "99.0.0",
  releaseUrl: "https://example.test/releases/dhw-v99.0.0",
  assetUrl: "https://example.test/releases/dhw-v99.0.0/dhw-linux-x64-baseline",
  assetDigest: `sha256:${"0".repeat(64)}`,
  assetSize: 1024,
  target: "linux-x64-baseline",
};

/** A fake update service that records forced checks and installs. */
const makeUpdateLayer = (available: Option.Option<AvailableUpdate>) => {
  const checks: boolean[] = [];
  const installs: AvailableUpdate[] = [];
  const output: string[] = [];
  const layer = Layer.mergeAll(
    Layer.succeed(UpdateService, {
      check: (force) =>
        Effect.sync(() => {
          checks.push(force);
          return available;
        }),
      install: (update) =>
        Effect.sync(() => {
          installs.push(update);
        }),
    }),
    Layer.succeed(Console.Console, {
      ...globalThis.console,
      log: (...parts: ReadonlyArray<unknown>) => {
        output.push(parts.join(" "));
      },
    } satisfies Console.Console)
  ).pipe(Layer.provideMerge(BunServices.layer));
  return { checks, installs, layer, output };
};

describe("checkAndInstallUpdate", () => {
  test("reports the current version when no update is available", async () => {
    const json = makeUpdateLayer(Option.none());
    const text = makeUpdateLayer(Option.none());

    await checkAndInstallUpdate({ json: true, yes: false }).pipe(
      Effect.provide(json.layer),
      Effect.runPromise
    );
    await checkAndInstallUpdate({ json: false, yes: false }).pipe(
      Effect.provide(text.layer),
      Effect.runPromise
    );

    expect(json.checks).toEqual([true]);
    expect(json.output).toEqual([
      JSON.stringify({ status: "current", version: DHW_VERSION }),
    ]);
    expect(text.output).toEqual([`dhw ${DHW_VERSION} is current.`]);
    expect([...json.installs, ...text.installs]).toEqual([]);
  });

  test("only reports an available update as JSON without --yes", async () => {
    const { installs, layer, output } = makeUpdateLayer(
      Option.some(availableUpdate)
    );

    await checkAndInstallUpdate({ json: true, yes: false }).pipe(
      Effect.provide(layer),
      Effect.runPromise
    );

    expect(output).toEqual([
      JSON.stringify({ status: "available", ...availableUpdate }),
    ]);
    expect(installs).toEqual([]);
  });

  test("installs an available update with --yes", async () => {
    const json = makeUpdateLayer(Option.some(availableUpdate));
    const text = makeUpdateLayer(Option.some(availableUpdate));

    await checkAndInstallUpdate({ json: true, yes: true }).pipe(
      Effect.provide(json.layer),
      Effect.runPromise
    );
    await checkAndInstallUpdate({ json: false, yes: true }).pipe(
      Effect.provide(text.layer),
      Effect.runPromise
    );

    expect(json.installs).toEqual([availableUpdate]);
    expect(json.output).toEqual([
      JSON.stringify({ status: "updated", version: "99.0.0" }),
    ]);
    expect(text.installs).toEqual([availableUpdate]);
    expect(text.output).toEqual(["Updated dhw to 99.0.0."]);
  });
});

describe("dhw update", () => {
  test("refuses to update a build that is not a published release", async () => {
    const run = async (args: ReadonlyArray<string>) => {
      const updates = makeUpdateLayer(Option.some(availableUpdate));
      await Command.runWith(dhwCommand, { version: "1.3.0" })(args).pipe(
        Effect.provide(
          updates.layer.pipe(
            Layer.provideMerge(
              Layer.succeed(DhwConfig, {
                baseUrl: new URL("https://workspace.example.test"),
                requestHeaders: {},
                isCi: true,
                stateDirectory: join(
                  process.env.TMPDIR ?? "/tmp",
                  "dhw-update-command-test"
                ),
                updateChecksDisabled: true,
              })
            )
          )
        ),
        Effect.runPromise
      );
      return updates;
    };

    const json = await run(["--json", "update", "--yes"]);
    const text = await run(["update"]);

    expect(json.output).toEqual([
      JSON.stringify({ status: "development-build" }),
    ]);
    expect(text.output).toEqual([
      "Self-update is available only in published releases.",
    ]);
    expect([...json.checks, ...text.checks]).toEqual([]);
    expect([...json.installs, ...text.installs]).toEqual([]);
  });
});
