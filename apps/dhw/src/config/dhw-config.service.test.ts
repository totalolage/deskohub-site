import { describe, expect, test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { ConfigProvider, Effect } from "effect";
import { DhwConfig } from "./dhw-config.service";

const readConfig = (env: Record<string, string>) =>
  DhwConfig.pipe(
    Effect.provide(DhwConfig.Default),
    Effect.provide(BunServices.layer),
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromUnknown(env)
    ),
    Effect.runPromise
  );

describe("DhwConfig", () => {
  test("uses DHW_STATE_DIR without requiring HOME", async () => {
    const config = await readConfig({
      DHW_STATE_DIR: "/var/lib/dhw",
    });

    expect(config.stateDirectory).toBe("/var/lib/dhw");
  });
});
