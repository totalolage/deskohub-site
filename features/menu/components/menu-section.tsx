import type { MenuItemWithCategory } from "@/features/dotypos/backend/service";
import { getLocale } from "@/i18n";
import { getLocalizedText } from "@/shared/utils/localization";

interface MenuSectionProps {
  categoryName: string;
  items: MenuItemWithCategory[];
  categoryTranslatedName?: Record<string, unknown> | null;
}

export function MenuSection({
  categoryName,
  items,
  categoryTranslatedName,
}: MenuSectionProps) {
  // Skip empty categories
  if (items.length === 0) return null;

  const locale = getLocale();

  // Get localized category name if available
  const localizedCategoryName =
    getLocalizedText(categoryTranslatedName as Record<string, string> | undefined, locale, categoryName) ?? categoryName;

  return (
    <div className="mb-12">
      <h2 className="text-3xl font-bold text-green-400 mb-6 text-center">
        {localizedCategoryName}
      </h2>
      <div className="grid gap-4 md:gap-6">
        {items.map((item) => {
          // Get localized name and description if available
          const localizedName =
            getLocalizedText(item.translatedName as Record<string, string> | undefined, locale, item.name) ?? item.name;
          const localizedDescription =
            getLocalizedText(item.translatedDescription as Record<string, string> | undefined, locale) ||
            item.description ||
            item.subtitle;

          // Determine availability - if stock tracking is disabled, item is always available
          const isAvailable =
            item.stockDeduct === false ||
            item.stockQuantity == null ||
            Number(item.stockQuantity) > 0;

          return (
            <div
              key={item.id}
              className="flex justify-between items-start bg-black/40 backdrop-blur-sm rounded-lg p-4 border border-green-400/20 hover:border-green-400/40 transition-colors"
            >
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-white mb-1">
                  {localizedName}
                  {item.unit &&
                    ["g", "l"].some((unit) => item.unit.includes(unit)) && (
                      <span className="text-sm text-gray-300 ml-2">
                        ({item.unit})
                      </span>
                    )}
                </h3>
                {localizedDescription && (
                  <p className="text-gray-300 text-sm">
                    {localizedDescription}
                  </p>
                )}
                {!isAvailable && (
                  <span className="inline-block mt-2 px-2 py-1 text-xs bg-red-900/50 text-red-300 rounded">
                    Momentálně nedostupné
                  </span>
                )}
              </div>
              <div className="text-2xl font-bold text-green-400 ml-4">
                {item.priceWithVat && Number(item.priceWithVat) > 0
                  ? `${Math.round(Number(item.priceWithVat))} Kč`
                  : "Na dotaz"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
