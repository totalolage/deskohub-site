import type {
  CloudinaryWebhookAuthError,
  CloudinaryWebhookValidationError,
} from "@deskohub/cloudinary";
import {
  type WebhookDisposition,
  WebhookRefusal,
} from "@/shared/backend/service-route";

type CloudinaryWebhookFailure =
  | CloudinaryWebhookAuthError
  | CloudinaryWebhookValidationError;

export const cloudinaryWebhookDisposition = {
  CloudinaryWebhookAuthError: {
    kind: "rejected",
    status: 401,
    severity: "warning",
  },
  CloudinaryWebhookValidationError: {
    kind: "rejected",
    status: 400,
    severity: "warning",
  },
} satisfies Record<CloudinaryWebhookFailure["_tag"], WebhookDisposition>;

const publicMessages = {
  CloudinaryWebhookAuthError: "Unauthorized",
  CloudinaryWebhookValidationError: "Invalid payload",
} satisfies Record<CloudinaryWebhookFailure["_tag"], string>;

/**
 * The verifier's message is public; its cause and payload stay out of the
 * response and the logs.
 */
export const cloudinaryWebhookRefusal = (error: CloudinaryWebhookFailure) =>
  new WebhookRefusal({
    disposition: cloudinaryWebhookDisposition[error._tag],
    publicMessage: publicMessages[error._tag],
    publicDetail: error.message,
  });
