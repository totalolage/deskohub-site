import { describe, expect, test } from "bun:test";
import type { ConfigContext } from "expo/config";
import appConfig, { androidVersionCode, parseAppVersion } from "./app.config";

describe("parseAppVersion", () => {
  test("reads a plain major.minor.patch version", () => {
    expect(parseAppVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  test.each([
    "1.2",
    "1.2.3.4",
    "v1.2.3",
    "1.2.3-rc.1",
    "1.2.3+build",
    "01.2.3",
    "1.02.3",
    " 1.2.3",
    "",
  ])("rejects %p", (version) => {
    expect(() => parseAppVersion(version)).toThrow();
  });

  test("rejects components the version code cannot hold", () => {
    expect(() => parseAppVersion("1.1000.0")).toThrow();
    expect(() => parseAppVersion("1.0.1000")).toThrow();
    expect(() => parseAppVersion("2100.0.0")).toThrow();
  });
});

describe("androidVersionCode", () => {
  test("packs major, minor and patch into one integer", () => {
    expect(androidVersionCode("0.1.0")).toBe(1000);
    expect(androidVersionCode("1.2.3")).toBe(1_002_003);
    expect(androidVersionCode("2099.999.999")).toBe(2_099_999_999);
  });

  test("rejects 0.0.0 because Android needs a positive version code", () => {
    expect(() => androidVersionCode("0.0.0")).toThrow();
  });

  test("rejects a missing version", () => {
    expect(() => androidVersionCode(undefined)).toThrow();
  });

  test("grows with every later version and stays within the Android maximum", () => {
    const ordered = [
      "0.1.0",
      "0.1.1",
      "0.1.999",
      "0.2.0",
      "0.999.999",
      "1.0.0",
      "1.0.1",
      "1.10.0",
      "10.0.0",
      "2099.999.999",
    ];
    const codes = ordered.map(androidVersionCode);
    for (const [index, code] of codes.entries()) {
      if (index > 0) {
        expect(code).toBeGreaterThan(codes[index - 1] ?? 0);
      }
      expect(code).toBeLessThanOrEqual(2_100_000_000);
    }
  });
});

describe("app config", () => {
  const context = (config: ConfigContext["config"]): ConfigContext => ({
    config,
    projectRoot: import.meta.dir,
    staticConfigPath: null,
    packageJsonPath: null,
  });

  test("sets the Android version code from the version and keeps the rest", () => {
    const resolved = appConfig(
      context({
        name: "Deskohub",
        slug: "deskohub-mobile",
        version: "1.2.3",
        android: { package: "cz.deskohub.workspace" },
      })
    );
    expect(resolved.android?.versionCode).toBe(1_002_003);
    expect(resolved.android?.package).toBe("cz.deskohub.workspace");
    expect(resolved.version).toBe("1.2.3");
  });

  test("fails when the static config has no usable version", () => {
    expect(() =>
      appConfig(context({ name: "Deskohub", slug: "deskohub-mobile" }))
    ).toThrow();
  });
});
