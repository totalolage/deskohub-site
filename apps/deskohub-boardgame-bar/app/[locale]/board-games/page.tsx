import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { BoardGamesHero, BoardGamesList } from "@/features/board-games";
import { m, setLocale } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { siteConstants } from "@/shared/utils/constants";
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
      {siteConstants.featureFlags.boardGamesList ? (
        <BoardGamesList />
      ) : (
        <div className="container mx-auto px-4 py-16">
          <h2 className="text-2xl font-bold mb-6 text-center">
            {m["boardGames.title"]()}
          </h2>
          <div className="mb-8 rounded-lg overflow-hidden shadow-2xl">
            <iframe
              src="https://docs.google.com/spreadsheets/d/e/2PACX-1vT7HtaX6X32lgWEYqcaf1qvAvdX1bbwKYe4lHLQjBvY3gUnhohb_bPsnaVQcWTygJdzxTayCJcjLSL0/pubhtml?gid=0&amp;single=true&amp;widget=true&amp;headers=false"
              className="w-full h-[600px] bg-white"
              title="Board Games List"
            />
          </div>

          <div className="text-center">
            <Button asChild size="lg">
              <Link
                href="https://docs.google.com/spreadsheets/d/1COMEk06pF2a1gqVaFvrH0PspCA0W5kyfbMGqD3vVCS8/edit?usp=sharing"
                target="_blank"
                rel="noopener noreferrer"
              >
                {m["boardGames.viewSpreadsheet"]()}
                <ExternalLink className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
