import type { CloudinaryAsset } from "@deskohub/cloudinary";

type LocalizedContextField = "alt" | "caption" | "detail";
type ContextLocale = "cs-CZ" | "en-US";

export function getLocalizedCloudinaryContextValue(
  asset: CloudinaryAsset,
  field: LocalizedContextField,
  locale: ContextLocale
): string | undefined {
  const custom = asset.context?.custom;

  return (
    custom?.[`${field}-${locale}`]?.trim() ||
    custom?.[field]?.trim() ||
    undefined
  );
}
