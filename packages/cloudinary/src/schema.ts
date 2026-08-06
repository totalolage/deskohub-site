import * as Schema from "effect/Schema";

export const CloudinaryAssetSchema = Schema.Struct({
  public_id: Schema.String,
  secure_url: Schema.String,
  url: Schema.String,
  width: Schema.Finite,
  height: Schema.Finite,
  format: Schema.String,
  resource_type: Schema.String,
  created_at: Schema.String,
  folder: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  context: Schema.optional(
    Schema.Struct({
      custom: Schema.optional(
        Schema.Struct({
          alt: Schema.optional(Schema.String),
          "alt-cs-CZ": Schema.optional(Schema.String),
          "alt-en-US": Schema.optional(Schema.String),
          caption: Schema.optional(Schema.String),
          "caption-cs-CZ": Schema.optional(Schema.String),
          "caption-en-US": Schema.optional(Schema.String),
          detail: Schema.optional(Schema.String),
          "detail-cs-CZ": Schema.optional(Schema.String),
          "detail-en-US": Schema.optional(Schema.String),
        })
      ),
    })
  ),
});

export type CloudinaryAsset = Schema.Schema.Type<typeof CloudinaryAssetSchema>;

export const CloudinarySearchResponseSchema = Schema.Struct({
  next_cursor: Schema.optional(Schema.String),
  resources: Schema.Array(CloudinaryAssetSchema),
});

export const SearchOptionsSchema = Schema.Struct({
  maxResults: Schema.optional(Schema.Finite.check(Schema.isGreaterThan(0))),
  sortBy: Schema.optional(
    Schema.Literals(["created_at", "updated_at", "public_id"])
  ),
  sortDirection: Schema.optional(Schema.Literals(["asc", "desc"])),
});

export type SearchOptions = Schema.Schema.Type<typeof SearchOptionsSchema>;
