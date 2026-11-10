import {
  type SupportedLocale,
  supportedLocales,
} from "@deskohub/i18n/locale-registry";
import * as Schema from "effect/Schema";

export const CloudinaryPublicIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("CloudinaryPublicId")
).annotate({
  identifier: "CloudinaryPublicId",
  description: "Opaque public identifier assigned to a Cloudinary asset.",
});

export type CloudinaryPublicId = typeof CloudinaryPublicIdSchema.Type;

export const CloudinarySearchCursorSchema = Schema.NonEmptyString.pipe(
  Schema.brand("CloudinarySearchCursor")
).annotate({
  identifier: "CloudinarySearchCursor",
  description: "Opaque cursor identifying a Cloudinary search result page.",
});
export type CloudinarySearchCursor = typeof CloudinarySearchCursorSchema.Type;

/** A context field an asset carries per locale, beside a bare fallback. */
export type LocalizedContextField = "alt" | "caption" | "detail";

const optionalContextValue = Schema.optional(Schema.String);

/**
 * The bare `alt`, `caption` and `detail` context fields and one
 * `<field>-<locale>` field each per supported locale, such as `alt-cs-CZ`.
 */
const localizedContextFields = Object.fromEntries(
  (["alt", "caption", "detail"] as const).flatMap((field) => [
    [field, optionalContextValue],
    ...supportedLocales.map((locale) => [
      `${field}-${locale}`,
      optionalContextValue,
    ]),
  ])
) as {
  readonly [Key in
    | LocalizedContextField
    | `${LocalizedContextField}-${SupportedLocale}`]: typeof optionalContextValue;
};

export const CloudinaryAssetSchema = Schema.Struct({
  public_id: CloudinaryPublicIdSchema,
  /**
   * The provider's immutable asset identity. Unlike `public_id`, it survives
   * renames, so callers can verify that the asset now living at a public ID
   * is really the one they put there.
   */
  asset_id: Schema.optional(Schema.NonEmptyString),
  secure_url: Schema.String,
  url: Schema.String,
  width: Schema.Finite,
  height: Schema.Finite,
  format: Schema.String,
  resource_type: Schema.String,
  version: Schema.optional(Schema.Finite),
  created_at: Schema.String,
  folder: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  context: Schema.optional(
    Schema.Struct({
      custom: Schema.optional(Schema.Struct(localizedContextFields)),
    })
  ),
});

export type CloudinaryAsset = Schema.Schema.Type<typeof CloudinaryAssetSchema>;

export const CloudinarySearchResponseSchema = Schema.Struct({
  next_cursor: Schema.optional(CloudinarySearchCursorSchema),
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

export const CloudinaryDestroyOutcomeSchema = Schema.Literals([
  "destroyed",
  "not-found",
]);

export type CloudinaryDestroyOutcome = Schema.Schema.Type<
  typeof CloudinaryDestroyOutcomeSchema
>;
