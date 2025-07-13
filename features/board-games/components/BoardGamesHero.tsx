import heroImage from "@/assets/images/hero.jpg";
import { m } from "@/i18n";

export const BoardGamesHero = () => {
  return (
    <div
      className="relative h-64 bg-cover bg-center"
      style={{ backgroundImage: `url(${heroImage.src})` }}
    >
      <div className="absolute inset-0 bg-black bg-opacity-60"></div>
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex items-center">
        <div>
          <h1 className="text-4xl md:text-6xl font-bold text-green-400 mb-4">
            {m["boardGames.hero.title"]()}
          </h1>
          <p className="text-xl text-gray-200 max-w-2xl">
            {m["boardGames.hero.subtitle"]()}
          </p>
        </div>
      </div>
    </div>
  );
};
