import type { Category, Product } from "@deskohub/dotypos/generated";
import { useLocale } from "@/features/i18n/utils/use-locale";
import { formatPrice } from "@/shared/utils/currency";
import { formatCategory, formatMenuItem } from "../utils/format-menu-item";

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

  // Format category with localized text
  const formattedCategory = formatCategory(category, locale);

  return (
    <div className="mb-12">
      <h2 className="text-3xl font-bold text-green-400 mb-6 text-center">
        {emoji && <span className="mr-2">{emoji}</span>}
        {formattedCategory.name}
      </h2>
      <div className="grid gap-4 md:gap-6">
        {categoryProducts.map((product) => {
          // Format product with localized text
          const item = formatMenuItem(product, locale);

          return (
            <div
              key={item.id}
              className="flex justify-between items-start bg-black/40 backdrop-blur-sm rounded-lg p-4 border border-green-400/20 hover:border-green-400/40 transition-colors"
            >
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-white mb-1">
                  {item.name}
                  {item.unit &&
                    ["g", "l"].some((unit) => item.unit!.includes(unit)) && (
                      <span className="text-sm text-gray-300 ml-2">
                        ({item.unit})
                      </span>
                    )}
                </h3>
                {item.description && (
                  <p className="text-gray-300 text-sm">{item.description}</p>
                )}
              </div>
              <div className="text-2xl font-bold text-green-400 ml-4">
                {formatPrice(item.priceWithVat, locale)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
