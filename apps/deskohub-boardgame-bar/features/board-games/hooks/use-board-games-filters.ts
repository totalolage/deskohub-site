import { useMemo, useState } from "react";
import { getLocale, m } from "@/features/i18n";
import { getLocalizedText } from "@/shared/utils/localization";
import {
  DEFAULT_SORT_OPTION,
  type SortOption,
} from "../constants/sort-options";
import type { BoardGame } from "../types/board-games.types";
import { sortGames } from "../utils/sort-games";

interface UseFiltersOptions {
  games: BoardGame[];
}

interface FilterState {
  searchTerm: string;
  selectedCategory: string;
  selectedDifficulty: string;
  sortOption: SortOption;
}

export const useBoardGamesFilters = ({ games }: UseFiltersOptions) => {
  const locale = getLocale();

  const [filters, setFilters] = useState<FilterState>({
    searchTerm: "",
    selectedCategory: m["boardGames.filters.categories.all"](),
    selectedDifficulty: m["boardGames.filters.difficulties.all"](),
    sortOption: DEFAULT_SORT_OPTION,
  });

  const categories = useMemo(
    () => ({
      all: m["boardGames.filters.categories.all"](),
      strategic: m["boardGames.filters.categories.strategic"](),
      family: m["boardGames.filters.categories.family"](),
      dungeonCrawler: m["boardGames.filters.categories.dungeonCrawler"](),
      party: m["boardGames.filters.categories.party"](),
    }),
    []
  );

  const difficulties = useMemo(
    () => ({
      all: m["boardGames.filters.difficulties.all"](),
      easy: m["boardGames.filters.difficulties.easy"](),
      medium: m["boardGames.filters.difficulties.medium"](),
      hard: m["boardGames.filters.difficulties.hard"](),
    }),
    []
  );

  const filteredAndSortedGames = useMemo(() => {
    // Filter games
    const filtered = games.filter((game) => {
      const gameName = getLocalizedText(game.name, locale);
      const matchesSearch = gameName
        ?.toLowerCase()
        .includes(filters.searchTerm.toLowerCase());

      const matchesCategory =
        filters.selectedCategory === categories.all ||
        game.category === filters.selectedCategory;

      const matchesDifficulty =
        filters.selectedDifficulty === difficulties.all ||
        (game.difficulty &&
          m[`boardGames.filters.difficulties.${game.difficulty}`]() ===
            filters.selectedDifficulty);

      return matchesSearch && matchesCategory && matchesDifficulty;
    });

    // Sort games
    return sortGames(filtered, filters.sortOption, locale);
  }, [games, filters, locale, categories, difficulties]);

  const updateFilter = <K extends keyof FilterState>(
    key: K,
    value: FilterState[K]
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  return {
    filters,
    filteredGames: filteredAndSortedGames,
    updateFilter,
    categories,
    difficulties,
  };
};
