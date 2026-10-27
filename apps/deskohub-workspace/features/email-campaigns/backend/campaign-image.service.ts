import "server-only";

import {
  CloudinaryPublicIdSchema,
  type CloudinaryUploadError,
} from "@deskohub/cloudinary";
import { CloudinaryService } from "@deskohub/cloudinary/server";
import { Context, Effect, Layer, Schema } from "effect";
import { env } from "@/env";
import { WorkspaceCloudinaryLayer } from "@/features/gallery/backend/cloudinary.service";

interface ICampaignImageService {
  /**
   * Uploads a body image and returns its public Cloudinary URL and its width
   * in pixels.
   */
  readonly upload: (
    file: File
  ) => Effect.Effect<
    { readonly url: string; readonly width: number },
    CloudinaryUploadError | Schema.SchemaError
  >;
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

      const upload = Effect.fn("CampaignImageService.upload")(function* (
        file: File
      ) {
        const bytes = yield* Effect.promise(() => file.arrayBuffer());
        const publicId = yield* Schema.decodeEffect(CloudinaryPublicIdSchema)(
          crypto.randomUUID()
        );
        const asset = yield* cloudinary.uploadImage({
          bytes: new Uint8Array(bytes),
          publicId,
          folder: `email-campaigns/${env.VERCEL_ENV}`,
        });
        return { url: asset.secure_url, width: asset.width };
      });

      return { upload } satisfies ICampaignImageService;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceCloudinaryLayer));
}
