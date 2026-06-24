import * as Schema from "effect/Schema";

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
    httpCode: Schema.optional(Schema.Number),
  }
) {}
