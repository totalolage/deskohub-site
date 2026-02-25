import { m } from "@/features/i18n";

export function Stats() {
  return (
    <section className="py-16 bg-white">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          <div>
            <div className="text-4xl md:text-6xl font-bold text-gray-900 mb-2">
              500+
            </div>
            <div className="text-gray-600 font-medium">
              {m.boardGamesCount({ count: 500 })}
            </div>
          </div>
          <div>
            <div className="text-4xl md:text-6xl font-bold text-gray-900 mb-2">
              200+
            </div>
            <div className="text-gray-600 font-medium">
              {m.happyPlayersCount({ count: 200 })}
            </div>
          </div>
          <div>
            <div className="text-4xl md:text-6xl font-bold text-gray-900 mb-2">
              5+
            </div>
            <div className="text-gray-600 font-medium">
              {m.yearsExperienceCount({ count: 5 })}
            </div>
          </div>
          <div>
            <div className="text-4xl md:text-6xl font-bold text-gray-900 mb-2">
              100+
            </div>
            <div className="text-gray-600 font-medium">
              {m.gameNightsCount({ count: 100 })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
