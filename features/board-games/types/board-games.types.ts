export interface BoardGame {
  id: number;
  name: string;
  image: string;
  players: string;
  duration: string;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  rating: number;
  available: boolean;
  description: string;
}

export type ViewMode = "cards" | "table";

export interface BoardGamesFilterState {
  searchTerm: string;
  selectedCategory: string;
  selectedDifficulty: string;
  showAvailableOnly: boolean;
}
