import type { Game } from "@deskohub/games";

export type DurationFilter = "upTo30" | "upTo60" | "upTo120" | "over120";

type FilterableGame = Pick<
  Game,
  "name" | "minPlayers" | "maxPlayers" | "playingTimeMinutes" | "inStock"
>;

interface BoardGameFilters {
  playerCount: number | null;
  durations: ReadonlyArray<DurationFilter>;
  search: string;
}

export function filterBoardGames<T extends FilterableGame>(
  games: ReadonlyArray<T>,
  filters: BoardGameFilters
): ReadonlyArray<T> {
  const query = filters.search.trim().toLocaleLowerCase();

  return games.filter((game) => {
    if (!game.inStock) return false;

    if (filters.playerCount !== null) {
      if (game.minPlayers === null || game.maxPlayers === null) return false;

      const matchesPlayers =
        filters.playerCount === 7
          ? game.maxPlayers >= 7
          : game.minPlayers <= filters.playerCount &&
            game.maxPlayers >= filters.playerCount;
      if (!matchesPlayers) return false;
    }

    if (filters.durations.length > 0) {
      const minutes = game.playingTimeMinutes;
      if (
        minutes === null ||
        !filters.durations.some((duration) =>
          matchesDuration(minutes, duration)
        )
      ) {
        return false;
      }
    }

    return !query || game.name.toLocaleLowerCase().includes(query);
  });
}

function matchesDuration(minutes: number, duration: DurationFilter): boolean {
  switch (duration) {
    case "upTo30":
      return minutes <= 30;
    case "upTo60":
      return minutes > 30 && minutes <= 60;
    case "upTo120":
      return minutes > 60 && minutes <= 120;
    case "over120":
      return minutes > 120;
  }
}
