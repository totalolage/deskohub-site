import { BoardGamesHero, BoardGamesList } from "@/features/board-games";
import { m, setLocale } from "@/i18n";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../route";

export const generateMetadata = metadata({
  title: m["boardGames.pageTitle"](),
  description: m["boardGames.pageDescription"](),
});

export default async function BoardGamesPage({ params }: RouteProps_locale) {
  setLocale((await params).locale);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <BoardGamesHero />
      <BoardGamesList />
    </div>
  );
}
