import Link from "next/link";
import { BoardGamesHero, BoardGamesList } from "@/features/board-games";
import { boardGamesListFlag } from "@/flags";
import { m, setLocale } from "@/i18n";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../route";

export const generateMetadata = metadata({
  title: m["boardGames.pageTitle"](),
  description: m["boardGames.pageDescription"](),
});

export default async function BoardGamesPage({ params }: RouteProps_locale) {
  setLocale((await params).locale);
  const boardGamesListEnabled = await boardGamesListFlag();

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <BoardGamesHero />
      {boardGamesListEnabled ? (
        <BoardGamesList />
      ) : (
        <div className="container mx-auto px-4 py-16 text-center">
          <h2 className="text-2xl font-bold mb-6">{m["boardGames.title"]()}</h2>
          <p className="mb-8">{m["boardGames.viewListPrompt"]()}</p>
          <Link
            href="https://docs.google.com/spreadsheets/d/1COMEk06pF2a1gqVaFvrH0PspCA0W5kyfbMGqD3vVCS8/edit?usp=sharing"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-md bg-primary px-8 py-3 text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {m["boardGames.viewSpreadsheet"]()}
          </Link>
        </div>
      )}
    </div>
  );
}
