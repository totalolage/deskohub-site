import type { ImageProps } from "next/image";
import { LocalizedLink as Link, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { ImageWithFallback } from "@/shared/components/ui/image-with-fallback";
import { siteConstants } from "@/shared/utils/constants";

export async function GamesGallery() {
  const boardGamesListEnabled = siteConstants.featureFlags.boardGamesList;

  const games = [
    {
      nameKey: "gameCategories.strategic",
      image: "/images/games/categories/strategic.jpg",
    },
    {
      nameKey: "gameCategories.party",
      image: "/images/games/categories/party.jpg",
    },
    {
      nameKey: "gameCategories.cooperative",
      image: "/images/games/categories/cooperative.jpg",
    },
    {
      nameKey: "gameCategories.family",
      image: "/images/games/categories/family.jpg",
    },
    {
      nameKey: "gameCategories.logic",
      image: "/images/games/categories/logic.jpg",
    },
    {
      nameKey: "gameCategories.card",
      image: "/images/games/categories/card.jpg",
    },
    {
      nameKey: "gameCategories.economic",
      image: "/images/games/categories/economic.jpg",
    },
    {
      nameKey: "gameCategories.adventure",
      image: "/images/games/categories/adventure.jpg",
    },
    {
      nameKey: "gameCategories.abstract",
      image: "/images/games/categories/abstract.jpg",
    },
  ] satisfies {
    nameKey: keyof typeof m;
    image: ImageProps["src"];
  }[];

  return (
    <section className="py-16 bg-amber-50">
      <div className="max-w-7xl mx-auto px-6 text-center">
        <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
          {m["gamesSection.title"]()}
        </h2>
        <h3 className="text-4xl md:text-5xl font-bold text-gray-900 mb-16">
          {m["gamesSection.subtitle"]()}
        </h3>

        {boardGamesListEnabled ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
              {games.map((game) => (
                <div key={game.nameKey} className="text-center">
                  <div className="rounded-full overflow-hidden aspect-square mb-4 mx-auto w-48 h-48">
                    <ImageWithFallback
                      src={game.image}
                      fallbackSrc="/assets/images/placeholder/placeholder.svg"
                      alt={m[game.nameKey]()}
                      width={200}
                      height={200}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <h4 className="font-bold text-gray-900">
                    {m[game.nameKey]()}
                  </h4>
                </div>
              ))}
            </div>

            <Button className="bg-green-500 hover:bg-green-600 text-white px-8 py-3 rounded-full">
              {m["buttons.showMore"]()}
            </Button>
          </>
        ) : (
          <Link
            className="bg-green-500 hover:bg-green-600 text-white px-8 py-3 rounded-full"
            href="/board-games"
          >
            {m["buttons.seeList"]()}
          </Link>
        )}
      </div>
    </section>
  );
}
