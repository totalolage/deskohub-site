import { Config, Effect } from "effect";

/**
 * The Cloudinary account campaign images must come from, read from config
 * when a body is decoded. Scripts and CLI contracts run without it, and their
 * image-free bodies still decode. Server-only: browser bundles can't carry
 * the config provider.
 */
export const campaignImageCloudName = Config.option(
  Config.string("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME")
).pipe(Effect.orDie);
