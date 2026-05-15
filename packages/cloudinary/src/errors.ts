import * as Schema from "@effect/schema/Schema";

export class CloudinaryConfigError extends Schema.TaggedError<CloudinaryConfigError>()(
  "CloudinaryConfigError",
  {
    message: Schema.String,
  }
) {}

export class CloudinarySearchError extends Schema.TaggedError<CloudinarySearchError>()(
  "CloudinarySearchError",
  {
    message: Schema.String,
    expression: Schema.String,
    httpCode: Schema.optional(Schema.Number),
  }
) {}
