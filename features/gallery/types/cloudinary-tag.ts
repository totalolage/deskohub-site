// Base tags that exist in Cloudinary
type BaseCloudinaryTag =
  | "Domovská stránka"
  | "Školící místnost"
  | "Web galerie"
  | "hero"
  | "galerie"
  | "Menu"
  | "Kontakt"
  | "Deskové hry";

// CloudinaryTag can be either positive or negative (prefixed with !)
export type CloudinaryTag = BaseCloudinaryTag | `!${BaseCloudinaryTag}`;
