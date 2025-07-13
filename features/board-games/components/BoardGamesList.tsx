"use client";

import { useState } from "react";
import { m } from "@/i18n";
import type { BoardGame, ViewMode } from "../types/board-games.types";
import { BoardGamesCard } from "./BoardGamesCard";
import { BoardGamesFilters } from "./BoardGamesFilters";
import { BoardGamesTable } from "./BoardGamesTable";

// Temporary mock data - should be replaced with actual data fetching
const boardGames: BoardGame[] = [
  {
    id: 1,
    name: "Catan",
    image: "/placeholder.svg?height=200&width=200",
    players: "3-4",
    duration: "60-90 min",
    difficulty: "medium",
    category: "Strategic",
    rating: 4.5,
    available: true,
    description:
      "Classic strategy game about building civilization on the island of Catan.",
  },
  {
    id: 2,
    name: "Azul",
    image: "/placeholder.svg?height=200&width=200",
    players: "2-4",
    duration: "30-45 min",
    difficulty: "easy",
    category: "Family",
    rating: 4.8,
    available: true,
    description:
      "Beautiful game about creating mosaics inspired by Portuguese tiles.",
  },
  {
    id: 3,
    name: "Wingspan",
    image: "/placeholder.svg?height=200&width=200",
    players: "1-5",
    duration: "40-70 min",
    difficulty: "medium",
    category: "Strategic",
    rating: 4.7,
    available: false,
    description:
      "Engine-building game about birds with stunning illustrations.",
  },
  {
    id: 4,
    name: "Ticket to Ride",
    image: "/placeholder.svg?height=200&width=200",
    players: "2-5",
    duration: "30-60 min",
    difficulty: "easy",
    category: "Family",
    rating: 4.4,
    available: true,
    description: "Adventure railway journey across continents.",
  },
  {
    id: 5,
    name: "Gloomhaven",
    image: "/placeholder.svg?height=200&width=200",
    players: "1-4",
    duration: "60-120 min",
    difficulty: "hard",
    category: "Dungeon Crawler",
    rating: 4.9,
    available: true,
    description: "Epic tactical RPG adventure in a dark fantasy world.",
  },
  {
    id: 6,
    name: "Splendor",
    image: "/placeholder.svg?height=200&width=200",
    players: "2-4",
    duration: "30 min",
    difficulty: "easy",
    category: "Strategic",
    rating: 4.3,
    available: true,
    description: "Elegant game about gem trading and building an empire.",
  },
];

export const BoardGamesList = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(
    m["boardGames.filters.categories.all"]()
  );
  const [selectedDifficulty, setSelectedDifficulty] = useState(
    m["boardGames.filters.difficulties.all"]()
  );
  const [showAvailableOnly, setShowAvailableOnly] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("cards");

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
    const matchesSearch = game.name
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesCategory =
      selectedCategory === categories.all || game.category === selectedCategory;
    const matchesDifficulty =
      selectedDifficulty === difficulties.all ||
      m[`boardGames.filters.difficulties.${game.difficulty}`]() ===
        selectedDifficulty;
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
