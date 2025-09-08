// Base tags that exist in Cloudinary
type BaseCloudinaryTag =
  | "Domovská stránka"
  | "Školící místnost"
  | "Web galerie"
  | "Menu"
  | "Kontakt"
  | "Deskové hry"
  | "hero"
  | "galerie";

// CloudinaryTag can be either positive or negative (prefixed with !)
export type CloudinaryTag = BaseCloudinaryTag | `!${BaseCloudinaryTag}`;
