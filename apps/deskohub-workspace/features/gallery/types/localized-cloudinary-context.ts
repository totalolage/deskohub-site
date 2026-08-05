import type { Locale } from "@/features/i18n";
import type { CloudinaryAsset } from "../backend/cloudinary.service";

type LocalizedCloudinaryContextField = "alt" | "caption" | "detail";

export function getLocalizedCloudinaryContextValue(
  asset: CloudinaryAsset,
  field: LocalizedCloudinaryContextField,
  locale: Locale
): string | undefined {
  const custom = asset.context?.custom;

  return custom?.[`${field}-${locale}`]?.trim() || custom?.[field]?.trim();
}
