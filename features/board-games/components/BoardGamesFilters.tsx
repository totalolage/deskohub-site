"use client";

import { Search } from "lucide-react";
import { m } from "@/i18n";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import type { SortOption } from "../constants/sort-options";
import type { ViewMode } from "../types/board-games.types";
import { getSortOptions } from "../utils/get-sort-options";
import { ViewModeToggle } from "./ViewModeToggle";

interface FilterState {
  searchTerm: string;
  selectedCategory: string;
  selectedDifficulty: string;
  sortOption: SortOption;
}

interface BoardGamesFiltersProps {
  filters: FilterState;
  onFilterChange: <K extends keyof FilterState>(
    key: K,
    value: FilterState[K]
  ) => void;
  viewMode: ViewMode;
  setViewMode: (value: ViewMode) => void;
  filteredCount: number;
}

export const BoardGamesFilters = ({
  filters,
  onFilterChange,
  viewMode,
  setViewMode,
  filteredCount,
}: BoardGamesFiltersProps) => {
  const categories = [
    m["boardGames.filters.categories.all"](),
    m["boardGames.filters.categories.strategic"](),
    m["boardGames.filters.categories.family"](),
    m["boardGames.filters.categories.dungeonCrawler"](),
    m["boardGames.filters.categories.party"](),
  ];

  const difficulties = [
    m["boardGames.filters.difficulties.all"](),
    m["boardGames.filters.difficulties.easy"](),
    m["boardGames.filters.difficulties.medium"](),
    m["boardGames.filters.difficulties.hard"](),
  ];

  const sortOptions = getSortOptions();

  return (
    <div className="bg-gray-800 rounded-lg p-6 mb-8">
      <div className="flex flex-col gap-4">
        {/* First row: Search, Category, Difficulty, Available filter */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              placeholder={m["boardGames.filters.searchPlaceholder"]()}
              value={filters.searchTerm}
              onChange={(e) => onFilterChange("searchTerm", e.target.value)}
              className="pl-10 bg-gray-700 border-gray-600 text-white placeholder-gray-400"
            />
          </div>
          <Select
            value={filters.selectedCategory}
            onValueChange={(value) => onFilterChange("selectedCategory", value)}
          >
            <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
              <SelectValue placeholder={m["boardGames.filters.category"]()} />
            </SelectTrigger>
            <SelectContent className="bg-gray-700 border-gray-600">
              {categories.map((category) => (
                <SelectItem
                  key={category}
                  value={category}
                  className="text-white hover:bg-gray-600"
                >
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.selectedDifficulty}
            onValueChange={(value) =>
              onFilterChange("selectedDifficulty", value)
            }
          >
            <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
              <SelectValue placeholder={m["boardGames.filters.difficulty"]()} />
            </SelectTrigger>
            <SelectContent className="bg-gray-700 border-gray-600">
              {difficulties.map((difficulty) => (
                <SelectItem
                  key={difficulty}
                  value={difficulty}
                  className="text-white hover:bg-gray-600"
                >
                  {difficulty}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Second row: Sort dropdown and View Toggle */}
        <div className="flex items-center justify-between gap-4">
          <Select
            value={filters.sortOption}
            onValueChange={(value: SortOption) =>
              onFilterChange("sortOption", value)
            }
          >
            <SelectTrigger className="bg-gray-700 border-gray-600 text-white w-full md:w-64">
              <SelectValue placeholder={m["boardGames.filters.sortBy"]()} />
            </SelectTrigger>
            <SelectContent className="bg-gray-700 border-gray-600">
              {sortOptions.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className="text-white hover:bg-gray-600"
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
        </div>
      </div>
      <p className="text-gray-400 text-sm mt-4">
        {m["boardGames.filters.foundGames"]({ count: filteredCount })}
      </p>
    </div>
  );
};
