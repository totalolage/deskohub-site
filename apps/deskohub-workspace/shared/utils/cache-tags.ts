import { createCloudinaryCacheTags } from "@deskohub/cloudinary";
import { cacheTag } from "next/cache";

export const cloudinaryTags = createCloudinaryCacheTags({
  namespace: "workspace-cdn",
});

export const workspaceAvailabilityTags = {
  all: () => "workspace-availability:all",
};

export function applyCacheTags(...tags: string[]): void {
  for (const tag of tags) {
    cacheTag(tag);
  }
}
