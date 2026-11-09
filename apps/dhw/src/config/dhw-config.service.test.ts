import { describe, expect, test } from "bun:test";
import { ConfigProvider, Effect, Layer, Path } from "effect";
import { DhwConfig, productionOrigin } from "./dhw-config.service";

const loadBaseUrl = (
  build: { readonly isRelease: boolean },
  env: Record<string, string>
) =>
  DhwConfig.pipe(
    Effect.map((config) => config.baseUrl.href),
    Effect.provide(
      DhwConfig.layer(build).pipe(
        Layer.provide(
          Layer.mergeAll(
            Path.layer,
            ConfigProvider.layer(
              ConfigProvider.fromEnv({ env: { HOME: "/home/test", ...env } })
            )
          )
        )
      )
    )
  );

describe("DhwConfig", () => {
  test("defaults a released binary to production", async () => {
    const baseUrl = await loadBaseUrl({ isRelease: true }, {}).pipe(
      Effect.runPromise
    );

    expect(baseUrl).toBe(productionOrigin.href);
  });

  test("fails closed when a development build has no selected Workspace", async () => {
    const error = await loadBaseUrl({ isRelease: false }, {}).pipe(
      Effect.flip,
      Effect.runPromise
    );

    expect(error).toMatchObject({
      _tag: "DhwConfigError",
      message: expect.stringContaining("Set DHW_BASE"),
    });
  });

  test("uses the selected Workspace in a development build", async () => {
    const baseUrl = await loadBaseUrl(
      { isRelease: false },
      { DHW_BASE: "http://127.0.0.1:3000" }
    ).pipe(Effect.runPromise);

    expect(baseUrl).toBe("http://127.0.0.1:3000/");
  });

  test("lets a development build opt into production explicitly", async () => {
    const baseUrl = await loadBaseUrl(
      { isRelease: false },
      { DHW_BASE: productionOrigin.origin }
    ).pipe(Effect.runPromise);

    expect(baseUrl).toBe(productionOrigin.href);
  });

  test("prefers the selected Workspace over the release default", async () => {
    const baseUrl = await loadBaseUrl(
      { isRelease: true },
      { DHW_BASE: "http://localhost:3000" }
    ).pipe(Effect.runPromise);

    expect(baseUrl).toBe("http://localhost:3000/");
  });
});
