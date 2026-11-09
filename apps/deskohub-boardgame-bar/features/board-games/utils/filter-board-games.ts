import type { Game } from "@deskohub/games";

export type GameLanguage = NonNullable<Game["language"]>;

export type DurationFilter = "upTo30" | "upTo60" | "upTo120" | "over120";

type FilterableGame = Pick<
  Game,
  | "name"
  | "minPlayers"
  | "maxPlayers"
  | "playingTimeMinutes"
  | "inStock"
  | "language"
>;

interface BoardGameFilters {
  playerCount: number | null;
  durations: ReadonlyArray<DurationFilter>;
  search: string;
  language?: GameLanguage | null;
}

export function filterBoardGames<T extends FilterableGame>(
  games: ReadonlyArray<T>,
  filters: BoardGameFilters
): ReadonlyArray<T> {
  const query = filters.search.trim().toLocaleLowerCase();

  return games.filter(
    (game) =>
      game.inStock &&
      matchesLanguage(game, filters.language) &&
      matchesPlayerCount(game, filters.playerCount) &&
      matchesDurations(game, filters.durations) &&
      matchesSearch(game, query)
  );
}

/** Adds the duration to the selection, or removes it when already selected. */
export function toggleDurationFilter(
  selected: ReadonlyArray<DurationFilter>,
  duration: DurationFilter
): ReadonlyArray<DurationFilter> {
  return selected.includes(duration)
    ? selected.filter((value) => value !== duration)
    : [...selected, duration];
}

function matchesLanguage(
  game: FilterableGame,
  language: GameLanguage | null | undefined
): boolean {
  return language == null || game.language === language;
}

function matchesPlayerCount(
  game: FilterableGame,
  playerCount: number | null
): boolean {
  if (playerCount === null) return true;

  const { minPlayers, maxPlayers } = game;
  if (typeof minPlayers !== "number" || typeof maxPlayers !== "number") {
    return false;
  }

  return playerCount === 7
    ? maxPlayers >= 7
    : minPlayers <= playerCount && maxPlayers >= playerCount;
}

function matchesDurations(
  game: FilterableGame,
  durations: ReadonlyArray<DurationFilter>
): boolean {
  if (durations.length === 0) return true;

  const minutes = game.playingTimeMinutes;
  return (
    typeof minutes === "number" &&
    durations.some((duration) => matchesDuration(minutes, duration))
  );
}

function matchesSearch(game: FilterableGame, query: string): boolean {
  return !query || game.name.toLocaleLowerCase().includes(query);
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
