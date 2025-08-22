import type { MenuItemWithCategory } from "@/features/dotypos/backend/service";

interface MenuSectionProps {
  categoryName: string;
  items: MenuItemWithCategory[];
}

export function MenuSection({ categoryName, items }: MenuSectionProps) {
  // Skip empty categories
  if (items.length === 0) return null;

  return (
    <div className="mb-12">
      <h2 className="text-3xl font-bold text-green-400 mb-6 text-center">
        {categoryName}
      </h2>
      <div className="grid gap-4 md:gap-6">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex justify-between items-start bg-black/40 backdrop-blur-sm rounded-lg p-4 border border-green-400/20 hover:border-green-400/40 transition-colors"
          >
            <div className="flex-1">
              <h3 className="text-xl font-semibold text-white mb-1">
                {item.name}
                {item.unit &&
                  ["g", "l"].some((unit) => item.unit.includes(unit)) && (
                    <span className="text-sm text-gray-300 ml-2">
                      ({item.unit})
                    </span>
                  )}
              </h3>
              {item.description && (
                <p className="text-gray-300 text-sm">{item.description}</p>
              )}
              {!item.available && (
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
        ))}
      </div>
    </div>
  );
}
