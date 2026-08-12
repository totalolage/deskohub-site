import { afterEach, describe, expect, test } from "bun:test";
import type { ConfigContext } from "expo/config";
import createConfig from "../../app.config";

const originalBuildTag = process.env.DW_BUILD_TAG;
const originalBuildChannel = process.env.DW_BUILD_CHANNEL;
const originalAppScheme = process.env.DW_APP_SCHEME;

afterEach(() => {
  if (originalBuildTag === undefined) delete process.env.DW_BUILD_TAG;
  else process.env.DW_BUILD_TAG = originalBuildTag;
  if (originalBuildChannel === undefined) delete process.env.DW_BUILD_CHANNEL;
  else process.env.DW_BUILD_CHANNEL = originalBuildChannel;
  if (originalAppScheme === undefined) delete process.env.DW_APP_SCHEME;
  else process.env.DW_APP_SCHEME = originalAppScheme;
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

  test("uses a server-accepted preview scheme for local development", () => {
    delete process.env.DW_BUILD_CHANNEL;
    delete process.env.DW_APP_SCHEME;

    expect(configFor("development").scheme).toBe(
      "deskohub-workspace-preview-p0-s00000000"
    );
  });

  test("defaults to the hosted Workspace API", () => {
    expect(configFor("development").extra).toMatchObject({
      apiOrigin: "https://app.workspace.deskohub.cz",
    });
  });
});
