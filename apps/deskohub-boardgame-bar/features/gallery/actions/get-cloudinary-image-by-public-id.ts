"use server";

import type { CloudinaryAsset } from "@deskohub/cloudinary";
import { CloudinaryService } from "@deskohub/cloudinary/server";
import { Effect } from "effect";
import { applyCacheTags, cloudinaryTags } from "@/shared/utils/cache-tags";
import { CloudinaryServiceLive } from "../backend/cloudinary.service";

export async function getCloudinaryImageByPublicId(
  publicId: string
): Promise<CloudinaryAsset | undefined> {
  "use cache";

  applyCacheTags(cloudinaryTags.all(), cloudinaryTags.image(publicId));

  const getImageEffect = Effect.provide(
    Effect.gen(function* () {
      const service = yield* CloudinaryService;
      return yield* service.getByPublicId(publicId);
    }),
    CloudinaryServiceLive
  ).pipe(
    Effect.catch((error) =>
      Effect.logError("Cloudinary public ID lookup failed", error).pipe(
        Effect.as(undefined)
      )
    )
  );

  return Effect.runPromise(getImageEffect);
}
