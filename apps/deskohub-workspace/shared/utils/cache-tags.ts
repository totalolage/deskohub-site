import { createCloudinaryCacheTags } from "@deskohub/cloudinary";

export const cloudinaryTags = createCloudinaryCacheTags({
  namespace: "workspace-cdn",
});

export const activePublicSalesCacheTag = "workspace-active-public-sales";
