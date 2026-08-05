type BaseCloudinaryTag =
  | "Workspace gallery"
  | "workspace"
  | "gallery"
  | "landing-carousel"
  | "meeting-room-gallery"
  | "meeting-room-hero"
  | "ttrpg-room"
  | "ttrpg-room-bar"
  | "ttrpg-room-workspace";

export type CloudinaryTag = BaseCloudinaryTag | `!${BaseCloudinaryTag}`;
