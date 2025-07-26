export const SORT_OPTIONS = {
  NAME_ASC: "name-asc",
  NAME_DESC: "name-desc",
  RATING_ASC: "rating-asc",
  RATING_DESC: "rating-desc",
  PLAYERS_ASC: "players-asc",
  PLAYERS_DESC: "players-desc",
  DURATION_ASC: "duration-asc",
  DURATION_DESC: "duration-desc",
} as const;

export type SortOption = (typeof SORT_OPTIONS)[keyof typeof SORT_OPTIONS];

export const DEFAULT_SORT_OPTION: SortOption = SORT_OPTIONS.NAME_ASC;
