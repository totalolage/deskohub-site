import type { CloudinaryAsset } from "@deskohub/cloudinary";
import { getLocalizedCloudinaryContextValue } from "@deskohub/cloudinary-image/localized-context";
import { type Locale, m } from "@/features/i18n";

export const getImageAlt = (image: CloudinaryAsset, locale: Locale) =>
  getLocalizedCloudinaryContextValue(image, "alt", locale) ||
  m["altText.venue"]({}, { locale });
