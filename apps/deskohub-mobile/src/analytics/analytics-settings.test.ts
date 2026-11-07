import { describe, expect, test } from "bun:test";
import {
  classifyDeploymentEnvironment,
  parsePostHogHost,
  resolveAnalyticsSettings,
} from "./analytics-settings";

describe("classifyDeploymentEnvironment", () => {
  test("treats native release builds as production", () => {
    expect(
      classifyDeploymentEnvironment({
        hostname: undefined,
        isDevelopmentBuild: false,
      })
    ).toBe("production");
    expect(
      classifyDeploymentEnvironment({
        hostname: undefined,
        isDevelopmentBuild: true,
      })
    ).toBe("development");
  });

  test("treats only the production hostname as production on the web", () => {
    expect(
      classifyDeploymentEnvironment({
        hostname: "workspace.deskohub.cz",
        isDevelopmentBuild: false,
      })
    ).toBe("production");
    expect(
      classifyDeploymentEnvironment({
        hostname: "deskohub-workspace-site-git-x.vercel.app",
        isDevelopmentBuild: false,
      })
    ).toBe("preview");
    expect(
      classifyDeploymentEnvironment({
        hostname: "localhost",
        isDevelopmentBuild: true,
      })
    ).toBe("development");
  });
});

describe("parsePostHogHost", () => {
  test("accepts an absolute http(s) host and returns its origin", () => {
    expect(parsePostHogHost("https://t.example.test/", undefined)).toBe(
      "https://t.example.test"
    );
    expect(parsePostHogHost(" http://localhost:8010 ", undefined)).toBe(
      "http://localhost:8010"
    );
  });

  test("rejects missing, relative, non-http and credentialed hosts", () => {
    for (const value of [
      undefined,
      "",
      "/ingest",
      "t.example.test",
      "ftp://t.example.test",
      "https://user:secret@t.example.test",
    ]) {
      expect(parsePostHogHost(value, undefined)).toBeNull();
    }
  });

  test("rejects the app's own hostname", () => {
    expect(
      parsePostHogHost("https://workspace.deskohub.cz", "workspace.deskohub.cz")
    ).toBeNull();
  });
});

describe("resolveAnalyticsSettings", () => {
  const base = {
    host: "https://t.example.test",
    appHostname: undefined,
    environment: "production",
  } as const;

  test("leaves analytics off without a key", () => {
    expect(resolveAnalyticsSettings({ ...base, apiKey: undefined })).toBeNull();
    expect(resolveAnalyticsSettings({ ...base, apiKey: " " })).toBeNull();
  });

  test("leaves analytics off with an unusable host", () => {
    expect(
      resolveAnalyticsSettings({ ...base, apiKey: "phc_x", host: undefined })
    ).toBeNull();
  });

  test("returns the key, host origin and environment", () => {
    expect(resolveAnalyticsSettings({ ...base, apiKey: "phc_x" })).toEqual({
      apiKey: "phc_x",
      host: "https://t.example.test",
      environment: "production",
    });
  });
});
