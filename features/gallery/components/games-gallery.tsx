import Image, { type ImageProps } from "next/image";
import Link from "next/link";
import placeholderImage from "@/assets/images/placeholder/placeholder.svg";
import { m } from "@/i18n";
import { Button } from "@/shared/components/ui/button";
import { boardGamesListFlag } from "@/shared/lib/feature-flags";

export async function GamesGallery() {
  const boardGamesListEnabled = await boardGamesListFlag();

  const games = [
    {
      nameKey: "gameCategories.strategic",
      image: placeholderImage,
    },
    {
      nameKey: "gameCategories.party",
      image: placeholderImage,
    },
    {
      nameKey: "gameCategories.cooperative",
      image: placeholderImage,
    },
    {
      nameKey: "gameCategories.family",
      image: placeholderImage,
    },
    {
      nameKey: "gameCategories.logic",
      image: placeholderImage,
    },
    {
      nameKey: "gameCategories.card",
      image: placeholderImage,
    },
    {
      nameKey: "gameCategories.economic",
      image: placeholderImage,
    },
    {
      nameKey: "gameCategories.adventure",
      image: placeholderImage,
    },
    {
      nameKey: "gameCategories.abstract",
      image: placeholderImage,
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
                    <Image
                      src={game.image}
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
