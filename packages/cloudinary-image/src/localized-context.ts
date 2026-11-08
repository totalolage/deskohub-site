import type {
  CloudinaryAsset,
  LocalizedContextField,
} from "@deskohub/cloudinary";
import {
  baseLocale,
  type SupportedLocale,
} from "@deskohub/i18n/locale-registry";

/**
 * An asset's context value for a locale: the locale's own value, else the
 * base locale's, else the bare field.
 */
export function getLocalizedCloudinaryContextValue(
  asset: CloudinaryAsset,
  field: LocalizedContextField,
  locale: SupportedLocale
): string | undefined {
  const custom = asset.context?.custom;

  return (
    custom?.[`${field}-${locale}`]?.trim() ||
    custom?.[`${field}-${baseLocale}`]?.trim() ||
    custom?.[field]?.trim() ||
    undefined
  );
}
