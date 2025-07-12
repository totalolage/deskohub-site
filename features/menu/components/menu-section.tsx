import type { MenuSection } from "../menu-data";

interface MenuSectionProps {
  section: MenuSection;
}

export function MenuSectionComponent({ section }: MenuSectionProps) {
  return (
    <div className="mb-12">
      <h2 className="text-3xl font-bold text-green-400 mb-6 text-center">
        {section.title}
      </h2>
      <div className="grid gap-4 md:gap-6">
        {section.items.map((item) => (
          <div
            key={`${item.name}-${item.price}`}
            className="flex justify-between items-start bg-black/40 backdrop-blur-sm rounded-lg p-4 border border-green-400/20"
          >
            <div className="flex-1">
              <h3 className="text-xl font-semibold text-white mb-1">
                {item.name}
                {item.weight && (
                  <span className="text-sm text-gray-300 ml-2">
                    ({item.weight})
                  </span>
                )}
              </h3>
              {item.description && (
                <p className="text-gray-300 text-sm">{item.description}</p>
              )}
            </div>
            <div className="text-2xl font-bold text-green-400 ml-4">
              {item.price} Kč
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
