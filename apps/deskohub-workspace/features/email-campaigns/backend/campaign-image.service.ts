import "server-only";

import { CloudinaryPublicIdSchema } from "@deskohub/cloudinary";
import {
  CloudinaryService,
  type CloudinarySignedImageUpload,
} from "@deskohub/cloudinary/server";
import { Context, Effect, Layer, Schema } from "effect";
import { env } from "@/env";
import { WorkspaceCloudinaryLayer } from "@/shared/backend/cloudinary";
import { campaignImageMaxWidth } from "../body/campaign-image";
import { campaignImageFolder } from "../body/campaign-image-account";

/**
 * What Cloudinary does to a body image before it stores it, keeping only the
 * result: it narrows the picture to `campaignImageMaxWidth`, turns it upright
 * as its EXIF orientation says, strips its metadata (camera details and GPS
 * position; the colour profile stays), and recompresses it at quality 85.
 * `fl_lossy` stores a PNG without an alpha channel as a JPEG, usually far
 * smaller, and recompresses GIF frames, keeping an animation.
 */
export const campaignImageTransformation = `c_limit,fl_force_strip.lossy,q_85,w_${campaignImageMaxWidth}`;

/**
 * Formats every email client shows, stored as they are. An image in any other
 * format, such as WebP or HEIC, becomes a PNG, which `fl_lossy` turns into a
 * JPEG when it has no alpha channel.
 */
const campaignImageFormats = ["gif", "jpg", "png"];
const campaignImageFallbackFormat = "png";

/**
 * Lets the admin's browser upload one body image straight to Cloudinary,
 * which stores it as `publicId`. The signature covers the folder, the public
 * ID and the transformation, so the browser can't change them.
 */
export interface CampaignImageUploadAuthorization
  extends CloudinarySignedImageUpload {
  readonly publicId: string;
}

interface ICampaignImageService {
  /** Authorizes the upload of one body image under a fresh public ID. */
  readonly authorizeUpload: Effect.Effect<CampaignImageUploadAuthorization>;
}

/** Campaign body images in the Deskohub Cloudinary account. */
export class CampaignImageService extends Context.Service<
  CampaignImageService,
  ICampaignImageService
>()("@deskohub-workspace/email-campaigns/CampaignImageService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const cloudinary = yield* CloudinaryService;
      const folder = campaignImageFolder(env.VERCEL_ENV);

      const authorizeUpload = Effect.Do.pipe(
        // A UUID is never empty, so it is always a public ID.
        Effect.bind("publicId", () =>
          Schema.decodeEffect(CloudinaryPublicIdSchema)(
            crypto.randomUUID()
          ).pipe(Effect.orDie)
        ),
        Effect.bind("upload", ({ publicId }) =>
          cloudinary.signImageUpload({
            publicId,
            folder,
            transformation: campaignImageTransformation,
            allowedFormats: campaignImageFormats,
            fallbackFormat: campaignImageFallbackFormat,
          })
        ),
        Effect.map(({ publicId, upload }) => ({
          ...upload,
          publicId: `${folder}/${publicId}`,
        })),
        Effect.withSpan("CampaignImageService.authorizeUpload")
      );

      return { authorizeUpload } satisfies ICampaignImageService;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceCloudinaryLayer));
}
