import type { TranslatableString } from "@/types/translatable-string";
import { SORT_OPTIONS, type SortOption } from "../constants/sort-options";
import type { BoardGame } from "../types/board-games.types";

const getLocalizedText = (
  text: TranslatableString | undefined,
  locale: string
): string => {
  if (!text) return "";
  if (typeof text === "string") return text;
  return text[locale] || "";
};

const getMinPlayers = (players: string | undefined): number => {
  if (!players || typeof players !== "string") return 0;
  return parseInt(players.split("-")[0] || "0");
};

const getMaxPlayers = (players: string | undefined): number => {
  if (!players || typeof players !== "string") return 0;
  const parts = players.split("-");
  return parseInt(parts[1] || parts[0] || "0");
};

const getMinDuration = (
  duration: number | [number, number] | undefined
): number => {
  if (!duration) return 0;
  return Array.isArray(duration) ? duration[0] : duration;
};

const getMaxDuration = (
  duration: number | [number, number] | undefined
): number => {
  if (!duration) return 0;
  return Array.isArray(duration) ? duration[1] || duration[0] : duration;
};

export const sortGames = (
  games: BoardGame[],
  sortOption: SortOption,
  locale: string
): BoardGame[] => {
  return games.toSorted((a, b) => {
    switch (sortOption) {
      case SORT_OPTIONS.NAME_ASC:
        return getLocalizedText(a.name, locale).localeCompare(
          getLocalizedText(b.name, locale),
          locale
        );

      case SORT_OPTIONS.NAME_DESC:
        return getLocalizedText(b.name, locale).localeCompare(
          getLocalizedText(a.name, locale),
          locale
        );

      case SORT_OPTIONS.RATING_ASC:
        return a.rating - b.rating;

      case SORT_OPTIONS.RATING_DESC:
        return b.rating - a.rating;

      case SORT_OPTIONS.PLAYERS_ASC:
        return getMinPlayers(a.players) - getMinPlayers(b.players);

      case SORT_OPTIONS.PLAYERS_DESC:
        return getMaxPlayers(b.players) - getMaxPlayers(a.players);

      case SORT_OPTIONS.DURATION_ASC:
        return getMinDuration(a.duration) - getMinDuration(b.duration);

      case SORT_OPTIONS.DURATION_DESC:
        return getMaxDuration(b.duration) - getMaxDuration(a.duration);

      default:
        return 0;
    }
  });
};
