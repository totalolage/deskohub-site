import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type { CapturedNetworkRequest } from "posthog-js";
import {
  createPostHogConfig,
  isPostHogTelemetryHostAllowed,
} from "./posthog-config";

const syntheticAddress = testEmailAddress("synthetic");

describe("isPostHogTelemetryHostAllowed", () => {
  test.each([
    ["https://posthog.example/ingest", "deskohub.test", true],
    ["https://deskohub.test/ingest", "deskohub.test", false],
    ["https://DESKOHUB.TEST./ingest", "deskohub.test", false],
    ["https://deskohub.test/ingest", "DESKOHUB.TEST.", false],
    ["https://deskohub.test:3211/ingest", "deskohub.test", false],
    ["https://user:password@posthog.example/ingest", "deskohub.test", false],
    ["/ingest", "deskohub.test", false],
    ["http://.", "deskohub.test", false],
    ["ftp://posthog.example/ingest", "deskohub.test", false],
  ] as const)(
    "accepts %s on application host %s: %p",
    (telemetryHost, applicationHostname, allowed) => {
      expect(
        isPostHogTelemetryHostAllowed(telemetryHost, applicationHostname)
      ).toBe(allowed);
    }
  );
});

describe("createPostHogConfig", () => {
  test("masks captured network requests down to a private-value-free URL", () => {
    const { maskCapturedNetworkRequestFn } = createPostHogConfig({
      apiHost: "https://posthog.example",
      beforeSend: (event) => event,
      optOutUseragentFilter: false,
    }).session_recording;
    const request: CapturedNetworkRequest = {
      duration: 1,
      entryType: "resource",
      name: `https://deskohub.test/account?email=${encodeURIComponent(syntheticAddress)}#secret`,
      requestBody: "synthetic-request-body",
      requestHeaders: { authorization: "synthetic-token" },
      responseBody: "synthetic-response-body",
      responseHeaders: { "x-private": "synthetic-header" },
      startTime: 0,
    };
    const maskedRequest = maskCapturedNetworkRequestFn(request);

    expect(maskedRequest).toMatchObject({
      name: "https://deskohub.test/account",
      requestBody: undefined,
      requestHeaders: undefined,
      responseBody: undefined,
      responseHeaders: undefined,
    });
    expect(JSON.stringify(maskedRequest)).not.toContain("synthetic");
  });

  test("drops captured network requests whose URL cannot be parsed", () => {
    const { maskCapturedNetworkRequestFn } = createPostHogConfig({
      apiHost: "https://posthog.example",
      beforeSend: (event) => event,
      optOutUseragentFilter: false,
    }).session_recording;

    expect(
      maskCapturedNetworkRequestFn({
        duration: 1,
        entryType: "resource",
        name: "not a url synthetic-request",
        requestBody: "synthetic-request-body",
        startTime: 0,
      })
    ).toBeNull();
  });
});
