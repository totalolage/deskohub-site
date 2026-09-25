import { describe, expect, test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { ConfigProvider, Effect, Layer } from "effect";
import { DhwConfig } from "./dhw-config.service";

const readConfig = (env: Record<string, string>) => {
  const dhwConfigLayer = DhwConfig.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        BunServices.layer,
        Layer.succeed(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown(env)
        )
      )
    )
  );

  return DhwConfig.pipe(Effect.provide(dhwConfigLayer), Effect.runPromise);
};

describe("DhwConfig", () => {
  test("uses DHW_STATE_DIR without requiring HOME", async () => {
    const config = await readConfig({
      DHW_STATE_DIR: "/var/lib/dhw",
    });

    expect(config.stateDirectory).toBe("/var/lib/dhw");
  });
});
