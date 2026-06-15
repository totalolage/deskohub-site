type BaseCloudinaryTag =
  | "Workspace gallery"
  | "workspace"
  | "gallery"
  | "landing-carousel";

export type CloudinaryTag = BaseCloudinaryTag | `!${BaseCloudinaryTag}`;
