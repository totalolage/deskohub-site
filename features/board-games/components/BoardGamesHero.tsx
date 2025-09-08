import { m } from "@/features/i18n";
import { Hero } from "@/shared/components";

export const BoardGamesHero = () => {
  return (
    <Hero tags="Deskové hry" alignment="left">
      <div>
        <h1 className="text-4xl md:text-6xl font-bold text-green-400 mb-4">
          {m["boardGames.hero.title"]()}
        </h1>
        <p className="text-xl text-gray-200 max-w-2xl">
          {m["boardGames.hero.subtitle"]()}
        </p>
      </div>
    </Hero>
  );
};
