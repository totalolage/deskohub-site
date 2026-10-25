import { expect, test } from "bun:test";
import { Record } from "effect";
import { webhookResponseStatus } from "@/shared/backend/service-route";
import { cloudinaryWebhookDisposition } from "./cloudinary-webhook-disposition";

test("answers each Cloudinary failure with its pinned status and log severity", () => {
  expect(
    Record.map(cloudinaryWebhookDisposition, (disposition) => [
      webhookResponseStatus(disposition),
      disposition.severity,
    ])
  ).toEqual({
    CloudinaryWebhookAuthError: [401, "warning"],
    CloudinaryWebhookValidationError: [400, "warning"],
  });
});
