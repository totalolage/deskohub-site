import { createCloudinaryCacheTags } from "@deskohub/cloudinary";
import { cacheTag } from "next/cache";

export function applyCacheTags(...tags: string[]) {
  for (const tag of tags) {
    cacheTag(tag);
  }
}

export const cloudinaryTags = createCloudinaryCacheTags({
  namespace: "workspace-cdn",
});
