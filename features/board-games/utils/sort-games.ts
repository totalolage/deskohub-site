import type { Locale } from "@/features/i18n";
import { getLocalizedText } from "@/shared/utils/localization";
import { SORT_OPTIONS, type SortOption } from "../constants/sort-options";
import type { BoardGame } from "../types/board-games.types";

const getMinPlayers = (players: string | undefined): number => {
  if (!players || typeof players !== "string") return 0;
  return parseInt(players.split("-")[0] || "0", 10);
};

const getMaxPlayers = (players: string | undefined): number => {
  if (!players || typeof players !== "string") return 0;
  const parts = players.split("-");
  return parseInt(parts[1] || parts[0] || "0", 10);
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
  locale: Locale
): BoardGame[] => {
  return games.toSorted((a, b) => {
    switch (sortOption) {
      case SORT_OPTIONS.NAME_ASC: {
        const aName = getLocalizedText(a.name, locale);
        if (!aName) return 1;
        const bName = getLocalizedText(b.name, locale);
        if (!bName) return -1;
        return aName.localeCompare(bName, locale);
      }

      case SORT_OPTIONS.NAME_DESC: {
        const aName = getLocalizedText(a.name, locale);
        if (!aName) return 1;
        const bName = getLocalizedText(b.name, locale);
        if (!bName) return -1;
        return bName.localeCompare(aName, locale);
      }

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
