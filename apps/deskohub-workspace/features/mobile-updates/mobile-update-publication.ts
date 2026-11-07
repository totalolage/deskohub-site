import { Schema } from "effect";

/** The native platforms the mobile app ships over-the-air updates to. */
export const MobileUpdatePlatform = Schema.Literals(["android", "ios"]);
export type MobileUpdatePlatform = typeof MobileUpdatePlatform.Type;

/**
 * One file of an update as the Expo Updates protocol describes it: `hash` is
 * the base64url SHA-256 of the file's bytes, which the app checks after the
 * download, and `url` is where the app downloads it.
 */
export const MobileUpdateAsset = Schema.Struct({
  hash: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/)),
  key: Schema.NonEmptyString,
  contentType: Schema.String.check(Schema.isPattern(/^[\w.+-]+\/[\w.+-]+$/)),
  fileExtension: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^\.[A-Za-z0-9]+$/))
  ),
  url: Schema.String.check(Schema.isPattern(/^https:\/\/[^\s]+$/)),
});
export type MobileUpdateAsset = typeof MobileUpdateAsset.Type;

const publicationTarget = {
  /** Unique per publication, so a retried publish request is idempotent. */
  id: Schema.String.check(Schema.isUUID()),
  platform: MobileUpdatePlatform,
  runtimeVersion: Schema.NonEmptyString,
};

/**
 * What the release pipeline publishes for one platform and runtime version:
 * a JavaScript update whose files already sit at their URLs, or a rollback
 * that sends installed apps back to the update embedded in their build. The
 * newest publication for a platform and runtime version is what apps get.
 */
export const MobileUpdatePublication = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("update"),
    ...publicationTarget,
    launchAsset: MobileUpdateAsset,
    assets: Schema.Array(MobileUpdateAsset),
    metadata: Schema.Record(Schema.String, Schema.String),
    extra: Schema.Record(Schema.String, Schema.Json),
  }),
  Schema.Struct({
    type: Schema.Literal("rollBackToEmbedded"),
    ...publicationTarget,
  }),
]);
export type MobileUpdatePublication = typeof MobileUpdatePublication.Type;
