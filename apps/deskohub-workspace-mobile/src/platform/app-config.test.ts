import { afterEach, describe, expect, test } from "bun:test";
import type { ConfigContext } from "expo/config";
import createConfig from "../../app.config";

const originalBuildTag = process.env.DW_BUILD_TAG;

afterEach(() => {
  if (originalBuildTag === undefined) delete process.env.DW_BUILD_TAG;
  else process.env.DW_BUILD_TAG = originalBuildTag;
});

const configFor = (buildTag: string) => {
  process.env.DW_BUILD_TAG = buildTag;
  return createConfig({ config: {} } as ConfigContext);
};

describe("mobile app configuration", () => {
  test("keeps the native runtime compatible across commit-tagged builds", () => {
    const first = configFor("a".repeat(40));
    const second = configFor("b".repeat(40));

    expect(first.version).not.toBe(second.version);
    expect(first.runtimeVersion).toEqual(second.runtimeVersion);
    expect(first.runtimeVersion).toEqual("0.1.0");
  });
});
