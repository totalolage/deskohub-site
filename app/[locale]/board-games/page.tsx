import type { Metadata } from "next";
import { BoardGamesHero, BoardGamesList } from "@/features/board-games";
import { m, setLocale } from "@/i18n";
import type { RouteProps_locale } from "../route";

export async function generateMetadata({
  params,
}: RouteProps_locale): Promise<Metadata> {
  setLocale((await params).locale);

  return {
    title: m["boardGames.pageTitle"](),
    description: m["boardGames.pageDescription"](),
  };
}

export default async function BoardGamesPage({ params }: RouteProps_locale) {
  setLocale((await params).locale);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <BoardGamesHero />
      <BoardGamesList />
    </div>
  );
}
