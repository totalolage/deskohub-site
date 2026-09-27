import * as Schema from "effect/Schema";
import { CloudinaryPublicIdSchema } from "./schema";

export class CloudinaryConfigError extends Schema.TaggedErrorClass<CloudinaryConfigError>()(
  "CloudinaryConfigError",
  {
    message: Schema.String,
  }
) {}

export class CloudinarySearchError extends Schema.TaggedErrorClass<CloudinarySearchError>()(
  "CloudinarySearchError",
  {
    message: Schema.String,
    expression: Schema.String,
    httpCode: Schema.optional(Schema.Finite),
  }
) {}

export class CloudinaryUploadError extends Schema.TaggedErrorClass<CloudinaryUploadError>()(
  "CloudinaryUploadError",
  {
    message: Schema.String,
    publicId: CloudinaryPublicIdSchema,
    httpCode: Schema.optional(Schema.Finite),
  }
) {}

export class CloudinaryDestroyError extends Schema.TaggedErrorClass<CloudinaryDestroyError>()(
  "CloudinaryDestroyError",
  {
    message: Schema.String,
    publicId: CloudinaryPublicIdSchema,
    outcome: Schema.Literals(["uncertain", "failed"]),
    httpCode: Schema.optional(Schema.Finite),
  }
) {}

export class CloudinaryPrefixDeleteError extends Schema.TaggedErrorClass<CloudinaryPrefixDeleteError>()(
  "CloudinaryPrefixDeleteError",
  {
    message: Schema.String,
    outcome: Schema.Literals(["uncertain", "failed"]),
    httpCode: Schema.optional(Schema.Finite),
  }
) {}

export class CloudinaryRenameError extends Schema.TaggedErrorClass<CloudinaryRenameError>()(
  "CloudinaryRenameError",
  {
    message: Schema.String,
    fromPublicId: CloudinaryPublicIdSchema,
    toPublicId: CloudinaryPublicIdSchema,
    reason: Schema.Literals(["target-exists", "source-missing", "failed"]),
    httpCode: Schema.optional(Schema.Finite),
  }
) {}
