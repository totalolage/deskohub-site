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
  description?: TranslatableString;
  // Additional fields from CSV
  expansions?: string;
  language?: "n/a" | (string & {});
  bggLink?: string;
}
