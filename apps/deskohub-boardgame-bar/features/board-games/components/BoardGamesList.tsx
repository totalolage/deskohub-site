"use client";

import { useMemo } from "react";
import { m } from "@/features/i18n";
import { boardGamesData } from "../data/board-games-data";
import { useBoardGamesFilters } from "../hooks/use-board-games-filters";
import { BoardGamesCard } from "./BoardGamesCard";
import { BoardGamesFilters } from "./BoardGamesFilters";

const normalizeRating = (rating: string | number): number => {
  if (typeof rating === "number") return rating;
  const ratingStr = String(rating);
  const match = ratingStr.match(/(\d+\.?\d*)/);
  return match?.[1] ? parseFloat(match[1]) : 0;
};

export const BoardGamesList = () => {
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

  const { filters, filteredGames, updateFilter } = useBoardGamesFilters({
    games: boardGames,
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <BoardGamesFilters
        filters={filters}
        onFilterChange={updateFilter}
        filteredCount={filteredGames.length}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredGames.map((game) => (
          <BoardGamesCard key={game.id} game={game} />
        ))}
      </div>

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
