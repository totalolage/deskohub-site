import type { TranslatableString } from "@/types/translatable-string";

export interface BoardGame {
  id?: number;
  name: TranslatableString;
  image?: string;
  players?: string;
  duration?: number | [number, number]; // Minutes
  difficulty?: "easy" | "medium" | "hard";
  category?: string;
  rating: number; // Out of 10
  available: boolean;
  description?: TranslatableString;
  // Additional fields from CSV
  expansions?: string;
  language?: "n/a" | (string & {});
  bggLink?: string;
}

export type ViewMode = "cards" | "table";

export interface BoardGamesFilterState {
  searchTerm: string;
  selectedCategory: string;
  selectedDifficulty: string;
  showAvailableOnly: boolean;
}
