"use client";

import { Filter, LayoutGrid, List, Search } from "lucide-react";
import { m } from "@/i18n";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import type { ViewMode } from "../types/board-games.types";

interface BoardGamesFiltersProps {
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  selectedCategory: string;
  setSelectedCategory: (value: string) => void;
  selectedDifficulty: string;
  setSelectedDifficulty: (value: string) => void;
  showAvailableOnly: boolean;
  setShowAvailableOnly: (value: boolean) => void;
  viewMode: ViewMode;
  setViewMode: (value: ViewMode) => void;
  filteredCount: number;
}

export const BoardGamesFilters = ({
  searchTerm,
  setSearchTerm,
  selectedCategory,
  setSelectedCategory,
  selectedDifficulty,
  setSelectedDifficulty,
  showAvailableOnly,
  setShowAvailableOnly,
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

  return (
    <div className="bg-gray-800 rounded-lg p-6 mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 flex-1 mr-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              placeholder={m["boardGames.filters.searchPlaceholder"]()}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-gray-700 border-gray-600 text-white placeholder-gray-400"
            />
          </div>
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
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
            value={selectedDifficulty}
            onValueChange={setSelectedDifficulty}
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
          <Button
            variant={showAvailableOnly ? "default" : "outline"}
            onClick={() => setShowAvailableOnly(!showAvailableOnly)}
            className={
              showAvailableOnly
                ? "bg-green-500 hover:bg-green-600"
                : "border-gray-600 text-white hover:bg-gray-700"
            }
          >
            <Filter className="w-4 h-4 mr-2" />
            {m["boardGames.filters.onlyAvailable"]()}
          </Button>
        </div>

        {/* View Toggle */}
        <div className="flex items-center bg-gray-700 rounded-lg p-1">
          <Button
            variant={viewMode === "cards" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewMode("cards")}
            className={`${
              viewMode === "cards"
                ? "bg-green-500 hover:bg-green-600 text-white"
                : "text-gray-400 hover:text-white hover:bg-gray-600"
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
          </Button>
          <Button
            variant={viewMode === "table" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewMode("table")}
            className={`${
              viewMode === "table"
                ? "bg-green-500 hover:bg-green-600 text-white"
                : "text-gray-400 hover:text-white hover:bg-gray-600"
            }`}
          >
            <List className="w-4 h-4" />
          </Button>
        </div>
      </div>
      <p className="text-gray-400 text-sm">
        {m["boardGames.filters.foundGames"]({ count: filteredCount })}
      </p>
    </div>
  );
};
