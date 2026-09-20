import type { Locale } from "@/features/i18n";
import { formatDate } from "./date-formatting";

export const ENTRANCE_FEE_TIERS_VISIBLE_AT = Date.UTC(2026, 10, 30, 23);

export const ENTRANCE_FEE_TIERS_START_AT = Date.UTC(2026, 11, 31, 23);

export type EntranceFeeTiersPhase = "current" | "announced" | "active";

export const getEntranceFeeTiersPhase = (
  nowMs = Date.now()
): EntranceFeeTiersPhase => {
  if (nowMs < ENTRANCE_FEE_TIERS_VISIBLE_AT) return "current";
  if (nowMs < ENTRANCE_FEE_TIERS_START_AT) return "announced";
  return "active";
};

export const formatEntranceFeeTiersStartDate = (locale: Locale) =>
  formatDate(new Date(ENTRANCE_FEE_TIERS_START_AT), locale, {
    dateStyle: "long",
  });
