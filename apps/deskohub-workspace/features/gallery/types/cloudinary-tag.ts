type BaseCloudinaryTag = "Workspace gallery" | "workspace" | "gallery";

export type CloudinaryTag = BaseCloudinaryTag | `!${BaseCloudinaryTag}`;
