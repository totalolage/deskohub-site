import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";

const appManifest = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
) as { readonly dependencies: Readonly<Record<string, string>> };

describe("native auth client packaging", () => {
  // The Expo plugin's online manager imports `expo-network` the first time a
  // client's session atom mounts, which every session read does. Metro fails
  // that import synchronously when the package is missing, so each sign-in
  // client's session read failed on a device and every reauthentication
  // ended as "unavailable". Bun's import rejects instead, which the plugin
  // catches, so only the packaging shows the failure here.
  test("bundles the network module the Expo auth plugin loads", () => {
    expect(appManifest.dependencies).toHaveProperty("expo-network");
    const plugin = dirname(
      Bun.resolveSync("@better-auth/expo/package.json", import.meta.dir)
    );
    expect(() => Bun.resolveSync("expo-network", plugin)).not.toThrow();
  });
});
