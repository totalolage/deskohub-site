"use server";

import {
  type CloudinaryAsset,
  CloudinaryPublicIdSchema,
} from "@deskohub/cloudinary";
import { CloudinaryService } from "@deskohub/cloudinary/server";
import { Effect, Schema } from "effect";
import { applyCacheTags, cloudinaryTags } from "@/shared/utils/cache-tags";
import { GalleryCloudinaryLayer } from "../backend/cloudinary.service";

export async function getCloudinaryImageByPublicId(
  publicId: string
): Promise<CloudinaryAsset | undefined> {
  "use cache";

  const imageLookup = Effect.provide(
    Effect.gen(function* () {
      const decodedPublicId = yield* Schema.decodeUnknownEffect(
        CloudinaryPublicIdSchema
      )(publicId);

      applyCacheTags(
        cloudinaryTags.all(),
        cloudinaryTags.image(decodedPublicId)
      );

      const service = yield* CloudinaryService;
      return yield* service.getByPublicId(decodedPublicId);
    }),
    GalleryCloudinaryLayer
  ).pipe(
    Effect.catch((error) =>
      Effect.logError("Cloudinary public ID lookup failed", error).pipe(
        Effect.as(undefined)
      )
    )
  );

  return Effect.runPromise(imageLookup);
}
