import * as Schema from "effect/Schema";
import { CloudinaryAssetSchema } from "./schema";

/** Decodes a raw provider asset response, failing with the schema parse error. */
export const decodeCloudinaryAsset = Schema.decodeUnknownEffect(
  CloudinaryAssetSchema
);
