import "@/shared/testing/workspace-test-env";

import { beforeEach, expect, mock, spyOn, test } from "bun:test";
import type { VerifiedCloudinaryWebhook } from "@deskohub/cloudinary/server";
import type { LoggerProvider } from "@opentelemetry/api-logs";
import { Effect, Layer } from "effect";
import { NextResponse } from "next/server";
import { cloudinaryTags } from "@/shared/utils/cache-tags";

const publicIdSentinel = "cloudinary-public-id-log-sentinel";
const assetIdSentinel = "cloudinary-asset-id-log-sentinel";
const secureUrlSentinel = "https://asset-log-sentinel.example.test/image.jpg";
type EmittedLog = Parameters<
  ReturnType<LoggerProvider["getLogger"]>["emit"]
>[0];

const emittedLogs: EmittedLog[] = [];
const emitLog = mock((record: EmittedLog) => {
  emittedLogs.push(record);
});

type VerifyCloudinaryWebhookRequest = (
  request: Request
) => Effect.Effect<VerifiedCloudinaryWebhook>;

const verifyCloudinaryWebhookRequest = mock<VerifyCloudinaryWebhookRequest>(
  () => Effect.succeed({ payload: {}, timestamp: 123 })
);
const revalidateTag = mock(() => undefined);

mock.module("@deskohub/cloudinary/server", () => ({
  CloudinaryWebhookVerifier: { Default: Layer.empty },
  makeCloudinaryRuntimeConfigLayer: () => Layer.empty,
  verifyCloudinaryWebhookRequest,
}));

mock.module("next/cache", () => ({ revalidateTag }));

mock.module("next/server", () => ({
  NextResponse,
  after: () => undefined,
}));

mock.module("@/instrumentation", () => ({
  postHogLoggerProvider: {
    forceFlush: () => Promise.resolve(),
    getLogger: () => ({ emit: emitLog }),
  },
}));

const { POST } = await import("./route");

beforeEach(() => {
  emittedLogs.length = 0;
  revalidateTag.mockClear();
  verifyCloudinaryWebhookRequest.mockClear();
  verifyCloudinaryWebhookRequest.mockImplementation(() =>
    Effect.succeed({
      payload: {
        public_id: publicIdSentinel,
        asset_id: assetIdSentinel,
        secure_url: secureUrlSentinel,
      },
      timestamp: 123,
    })
  );
});

test("does not log webhook asset data and still invalidates gallery caches", async () => {
  const consoleInfo = spyOn(console, "info").mockImplementation(
    () => undefined
  );
  let capturedConsoleLogs = "";

  try {
    const response = await POST(
      new Request("https://workspace.example.test/api/webhooks/cloudinary", {
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "Webhook received" });
    expect(revalidateTag).toHaveBeenCalledWith(cloudinaryTags.all(), "max");
    capturedConsoleLogs = JSON.stringify(consoleInfo.mock.calls);
  } finally {
    consoleInfo.mockRestore();
  }

  expect(emittedLogs.length).toBeGreaterThan(0);

  const capturedLogs = JSON.stringify({ emittedLogs, capturedConsoleLogs });
  expect(capturedLogs).toContain(
    "Cloudinary webhook cache invalidation completed"
  );
  expect(capturedLogs).not.toContain(publicIdSentinel);
  expect(capturedLogs).not.toContain(assetIdSentinel);
  expect(capturedLogs).not.toContain(secureUrlSentinel);
});
