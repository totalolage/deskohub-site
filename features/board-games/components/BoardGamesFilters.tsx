import { track } from "@vercel/analytics";
import { Search } from "lucide-react";
import { m } from "@/features/i18n";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import type { SortOption } from "../constants/sort-options";
import { getSortOptions } from "../utils/get-sort-options";

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
  filteredCount: number;
}

export const BoardGamesFilters = ({
  filters,
  onFilterChange,
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
      {/* First row: Search, Category, Difficulty, Available filter */}
      <div className="flex justify-between gap-4 md:flex-row flex-col items-stretch">
        <div className="flex-1 space-y-2">
          <Label htmlFor="sort-select" className="text-gray-300">
            {m["boardGames.filters.sortBy"]()}
          </Label>
          <Select
            value={filters.sortOption}
            onValueChange={(value: SortOption) => {
              track("Board Games Sort", { sortBy: value });
              onFilterChange("sortOption", value);
            }}
          >
            <SelectTrigger
              id="sort-select"
              className="bg-gray-700 border-gray-600 text-white"
            >
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
        </div>
        <div className="flex-1 space-y-2">
          <Label htmlFor="search-input" className="text-gray-300">
            {m["boardGames.filters.search"]()}
          </Label>
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              id="search-input"
              type="search"
              name="searchTerm"
              placeholder={m["boardGames.filters.searchPlaceholder"]()}
              value={filters.searchTerm}
              onChange={(e) => onFilterChange("searchTerm", e.target.value)}
              className="pl-10 bg-gray-700 border-gray-600 text-white placeholder-gray-400"
            />
          </div>
        </div>
        <div className="flex-1 space-y-2">
          <Label htmlFor="category-select" className="text-gray-300">
            {m["boardGames.filters.category"]()}
          </Label>
          <Select
            value={filters.selectedCategory}
            onValueChange={(value) => onFilterChange("selectedCategory", value)}
          >
            <SelectTrigger
              id="category-select"
              className="bg-gray-700 border-gray-600 text-white"
            >
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
        </div>
        <div className="flex-1 space-y-2">
          <Label htmlFor="difficulty-select" className="text-gray-300">
            {m["boardGames.filters.difficulty"]()}
          </Label>
          <Select
            value={filters.selectedDifficulty}
            onValueChange={(value) =>
              onFilterChange("selectedDifficulty", value)
            }
          >
            <SelectTrigger
              id="difficulty-select"
              className="bg-gray-700 border-gray-600 text-white"
            >
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
      </div>
      <p className="text-gray-400 text-sm mt-4">
        {m["boardGames.filters.foundGames"]({ count: filteredCount })}
      </p>
    </div>
  );
};
