type BaseCloudinaryTag =
  | "Workspace gallery"
  | "workspace"
  | "gallery"
  | "landing-carousel"
  | "ttrpg-room"
  | "ttrpg-room-bar"
  | "ttrpg-room-workspace";

export type CloudinaryTag = BaseCloudinaryTag | `!${BaseCloudinaryTag}`;
