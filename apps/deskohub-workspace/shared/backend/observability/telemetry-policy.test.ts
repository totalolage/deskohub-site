import { describe, expect, test } from "bun:test";
import { workspaceMinimumLogLevel } from "./telemetry-policy";

describe("workspaceMinimumLogLevel", () => {
  test("keeps production at Info", () => {
    expect(
      workspaceMinimumLogLevel({ deploymentEnvironment: "production" })
    ).toBe("Info");
  });

  test("includes Debug everywhere else", () => {
    for (const deploymentEnvironment of ["preview", "development", undefined]) {
      expect(workspaceMinimumLogLevel({ deploymentEnvironment })).toBe("Debug");
    }
  });

  test("honors an explicit level in any environment", () => {
    expect(
      workspaceMinimumLogLevel({
        deploymentEnvironment: "production",
        logLevel: "Debug",
      })
    ).toBe("Debug");
    expect(
      workspaceMinimumLogLevel({
        deploymentEnvironment: "preview",
        logLevel: "Warn",
      })
    ).toBe("Warn");
  });
});
