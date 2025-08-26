import type { Category, Product } from "@/features/dotypos/generated";
import { useLocale } from "@/i18n/utils/use-locale";
import { getLocalizedText } from "@/shared/utils/localization";

interface MenuSectionProps {
  products: Product[];
  category: Category;
  emoji?: string;
}

export function MenuSection({ products, category, emoji }: MenuSectionProps) {
  const locale = useLocale();

  const categoryProducts = products.filter(
    (p) => p._categoryId === category.id
  );

  // Skip empty categories
  if (categoryProducts.length === 0) return null;

  // Get localized category name if available
  const localizedCategoryName =
    getLocalizedText(category.translatedName, locale, category.name) ??
    category.name;

  return (
    <div className="mb-12">
      <h2 className="text-3xl font-bold text-green-400 mb-6 text-center">
        {emoji && <span className="mr-2">{emoji}</span>}
        {localizedCategoryName}
      </h2>
      <div className="grid gap-4 md:gap-6">
        {categoryProducts.map((item) => {
          // Get localized name and description if available
          const localizedName =
            getLocalizedText(item.translatedName, locale, item.name) ??
            item.name;
          const localizedDescription =
            getLocalizedText(item.translatedDescription, locale) ||
            item.description ||
            item.subtitle;

          // Determine availability - items are always available for now
          // since we don't have stock quantity data from the API
          const isAvailable = true;

          return (
            <div
              key={item.id}
              className="flex justify-between items-start bg-black/40 backdrop-blur-sm rounded-lg p-4 border border-green-400/20 hover:border-green-400/40 transition-colors"
            >
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-white mb-1">
                  {localizedName}
                  {item.unit &&
                    ["g", "l"].some((unit) => item.unit!.includes(unit)) && (
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
