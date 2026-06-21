import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";
import { cloudinaryTags } from "@/shared/utils/cache-tags";

type VerifyCloudinaryWebhookRequest = (request: Request) => Effect.Effect<
  { readonly payload: unknown; readonly timestamp: number },
  | { readonly _tag: "CloudinaryWebhookAuthError"; readonly message: string }
  | {
      readonly _tag: "CloudinaryWebhookValidationError";
      readonly message: string;
    }
>;

const verifyCloudinaryWebhookRequest = mock<VerifyCloudinaryWebhookRequest>(
  () => Effect.succeed({ payload: {}, timestamp: 123 })
);
const revalidateTag = mock(() => undefined);

mock.module("@deskohub/cloudinary/server", () => ({
  CloudinaryWebhookVerifier: { Live: Layer.empty },
  makeCloudinaryRuntimeConfigLayer: () => Layer.empty,
  verifyCloudinaryWebhookRequest,
}));

mock.module("next/cache", () => ({
  revalidateTag,
}));

describe("Cloudinary webhook route", () => {
  beforeEach(() => {
    setBoardgameTestEnv();
    revalidateTag.mockClear();
    verifyCloudinaryWebhookRequest.mockClear();
    verifyCloudinaryWebhookRequest.mockImplementation(() =>
      Effect.succeed({ payload: {}, timestamp: 123 })
    );
  });

  test("auth error returns 401", async () => {
    const { POST } = await import("./route");
    verifyCloudinaryWebhookRequest.mockImplementationOnce(() =>
      Effect.fail({
        _tag: "CloudinaryWebhookAuthError",
        message: "bad signature",
      })
    );

    const response = await POST(
      new Request("https://bar.example.test/api/webhooks/cloudinary")
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Unauthorized",
      message: "bad signature",
    });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  test("validation error returns 400", async () => {
    const { POST } = await import("./route");
    verifyCloudinaryWebhookRequest.mockImplementationOnce(() =>
      Effect.fail({
        _tag: "CloudinaryWebhookValidationError",
        message: "bad payload",
      })
    );

    const response = await POST(
      new Request("https://bar.example.test/api/webhooks/cloudinary")
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid payload",
      message: "bad payload",
    });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  test("success revalidates all Cloudinary tags", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("https://bar.example.test/api/webhooks/cloudinary")
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "Webhook received" });
    expect(revalidateTag).toHaveBeenCalledWith(cloudinaryTags.all(), "max");
  });
});
