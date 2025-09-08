import { m } from "@/features/i18n";
import { SORT_OPTIONS, type SortOption } from "../constants/sort-options";

export interface SortOptionItem {
  value: SortOption;
  label: string;
}

export const getSortOptions = (): SortOptionItem[] => [
  {
    value: SORT_OPTIONS.NAME_ASC,
    label: m["boardGames.filters.sort.nameAsc"](),
  },
  {
    value: SORT_OPTIONS.NAME_DESC,
    label: m["boardGames.filters.sort.nameDesc"](),
  },
  {
    value: SORT_OPTIONS.RATING_DESC,
    label: m["boardGames.filters.sort.ratingDesc"](),
  },
  {
    value: SORT_OPTIONS.RATING_ASC,
    label: m["boardGames.filters.sort.ratingAsc"](),
  },
  {
    value: SORT_OPTIONS.PLAYERS_ASC,
    label: m["boardGames.filters.sort.playersAsc"](),
  },
  {
    value: SORT_OPTIONS.PLAYERS_DESC,
    label: m["boardGames.filters.sort.playersDesc"](),
  },
  {
    value: SORT_OPTIONS.DURATION_ASC,
    label: m["boardGames.filters.sort.durationAsc"](),
  },
  {
    value: SORT_OPTIONS.DURATION_DESC,
    label: m["boardGames.filters.sort.durationDesc"](),
  },
];
