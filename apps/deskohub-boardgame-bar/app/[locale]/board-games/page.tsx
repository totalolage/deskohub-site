import { GamesService } from "@deskohub/games";
import { Effect } from "effect";
import { cacheLife } from "next/cache";
import { connection } from "next/server";
import { BoardGamesHero, BoardGamesList } from "@/features/board-games";
import { m, setLocale } from "@/features/i18n";
import { applyCacheTags, gamesTags } from "@/shared/utils/cache-tags";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../route";

export const generateMetadata = metadata({
  title: m["boardGames.pageTitle"](),
  description: m["boardGames.pageDescription"](),
});

export default async function BoardGamesPage({ params }: RouteProps_locale) {
  setLocale((await params).locale);
  await connection();

  const games = await loadGames().catch(() => null);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <BoardGamesHero />
      {games ? (
        <BoardGamesList games={games} />
      ) : (
        <section
          className="mx-auto max-w-3xl px-4 py-16 text-center"
          role="alert"
        >
          <h2 className="font-bold text-2xl">
            {m["boardGames.unavailable.title"]()}
          </h2>
          <p className="mt-3 text-gray-300">
            {m["boardGames.unavailable.hint"]()}
          </p>
        </section>
      )}
    </div>
  );
}

async function loadGames() {
  "use cache";

  cacheLife("minutes");
  applyCacheTags(gamesTags.catalog());

  return Effect.runPromise(
    Effect.gen(function* () {
      const gamesService = yield* GamesService;
      const games = yield* gamesService.listGames;

      return games.map(
        ({
          id,
          name,
          imageUrl,
          description,
          minPlayers,
          maxPlayers,
          playingTimeMinutes,
          rating,
        }) => ({
          id,
          name,
          imageUrl,
          description,
          minPlayers,
          maxPlayers,
          playingTimeMinutes,
          rating,
        })
      );
    }).pipe(
      Effect.tapError(Effect.logError),
      Effect.annotateLogs({ page: "BoardGamesPage" }),
      Effect.provide(GamesService.Live)
    )
  );
}
