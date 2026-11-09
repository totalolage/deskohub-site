import { expect, test } from "bun:test";
import {
  CloudinaryWebhookAuthError,
  CloudinaryWebhookValidationError,
} from "@deskohub/cloudinary";
import { Effect } from "effect";
import { defineWebhookRoute } from "@/shared/backend/service-route";
import {
  cloudinaryWebhookDisposition,
  cloudinaryWebhookRefusal,
} from "./cloudinary-webhook-disposition";

let failure: CloudinaryWebhookAuthError | CloudinaryWebhookValidationError;
const POST = defineWebhookRoute(
  { operation: "test.cloudinaryWebhookDisposition", failureMessage: "Unused" },
  () => Effect.fail(cloudinaryWebhookRefusal(failure))
);

const respond = async (
  error: CloudinaryWebhookAuthError | CloudinaryWebhookValidationError
) => {
  failure = error;
  const response = await POST(new Request("https://workspace.test"));
  return { status: response.status, body: await response.text() };
};

test("answers an unauthenticated delivery with 401 and the verifier's message", async () => {
  await expect(
    respond(new CloudinaryWebhookAuthError({ message: "Missing signature" }))
  ).resolves.toEqual({
    status: 401,
    body: '{"error":"Unauthorized","message":"Missing signature"}',
  });
  expect(cloudinaryWebhookDisposition.CloudinaryWebhookAuthError.severity).toBe(
    "warning"
  );
});

test("answers an invalid payload with 400 and keeps the payload out of logs", async () => {
  const error = new CloudinaryWebhookValidationError({
    message: "Invalid JSON",
    payload: "cloudinary-payload-sentinel",
    cause: new Error("cloudinary-cause-sentinel"),
  });

  const { status, body } = await respond(error);

  expect(status).toBe(400);
  expect(body).toBe('{"error":"Invalid payload","message":"Invalid JSON"}');
  const refusal = cloudinaryWebhookRefusal(error);
  expect(refusal.cause).toBeUndefined();
  expect(refusal.details).toBeUndefined();
  expect(
    cloudinaryWebhookDisposition.CloudinaryWebhookValidationError.severity
  ).toBe("warning");
});
