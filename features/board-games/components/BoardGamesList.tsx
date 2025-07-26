"use client";

import { useMemo, useState } from "react";
import { getLocale, m } from "@/i18n";
import type { TranslatableString } from "@/types/translatable-string";
import { boardGamesData } from "../data/board-games-data";
import type { ViewMode } from "../types/board-games.types";
import { BoardGamesCard } from "./BoardGamesCard";
import { BoardGamesFilters } from "./BoardGamesFilters";
import { BoardGamesTable } from "./BoardGamesTable";

// Convert rating string to number for compatibility
const normalizeRating = (rating: string | number): number => {
  if (typeof rating === "number") return rating;
  const ratingStr = String(rating);
  const match = ratingStr.match(/(\d+\.?\d*)/);
  return match?.[1] ? parseFloat(match[1]) : 0;
};

export const BoardGamesList = () => {
  const locale = getLocale();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(
    m["boardGames.filters.categories.all"]()
  );
  const [selectedDifficulty, setSelectedDifficulty] = useState(
    m["boardGames.filters.difficulties.all"]()
  );
  const [showAvailableOnly, setShowAvailableOnly] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("cards");

  // Helper to get localized text
  const getLocalizedText = (text: TranslatableString | undefined): string => {
    if (!text) return "";
    if (typeof text === "string") return text;
    return text[locale] || "";
  };

  // Normalize the data for display
  const boardGames = useMemo(
    () =>
      boardGamesData.map((game, index) => ({
        ...game,
        id: index + 1,
        rating: normalizeRating(game.rating),
        duration: game.duration,
        image: game.image || "/placeholder.svg?height=200&width=200",
      })),
    []
  );

  const categories = {
    all: m["boardGames.filters.categories.all"](),
    strategic: m["boardGames.filters.categories.strategic"](),
    family: m["boardGames.filters.categories.family"](),
    dungeonCrawler: m["boardGames.filters.categories.dungeonCrawler"](),
    party: m["boardGames.filters.categories.party"](),
  };

  const difficulties = {
    all: m["boardGames.filters.difficulties.all"](),
    easy: m["boardGames.filters.difficulties.easy"](),
    medium: m["boardGames.filters.difficulties.medium"](),
    hard: m["boardGames.filters.difficulties.hard"](),
  };

  const filteredGames = boardGames.filter((game) => {
    const gameName = getLocalizedText(game.name);
    const matchesSearch = gameName
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesCategory =
      selectedCategory === categories.all || game.category === selectedCategory;
    const matchesDifficulty =
      selectedDifficulty === difficulties.all ||
      (game.difficulty &&
        m[`boardGames.filters.difficulties.${game.difficulty}`]() ===
          selectedDifficulty);
    const matchesAvailability = !showAvailableOnly || game.available;

    return (
      matchesSearch &&
      matchesCategory &&
      matchesDifficulty &&
      matchesAvailability
    );
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <BoardGamesFilters
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        selectedCategory={selectedCategory}
        setSelectedCategory={setSelectedCategory}
        selectedDifficulty={selectedDifficulty}
        setSelectedDifficulty={setSelectedDifficulty}
        showAvailableOnly={showAvailableOnly}
        setShowAvailableOnly={setShowAvailableOnly}
        viewMode={viewMode}
        setViewMode={setViewMode}
        filteredCount={filteredGames.length}
      />

      {viewMode === "cards" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredGames.map((game) => (
            <BoardGamesCard key={game.id} game={game} />
          ))}
        </div>
      ) : (
        <BoardGamesTable games={filteredGames} />
      )}

      {filteredGames.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-400 text-lg">
            {m["boardGames.noGamesFound"]()}
          </p>
        </div>
      )}
    </div>
  );
};
