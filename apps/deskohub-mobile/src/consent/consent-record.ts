import {
  type ConsentCategory,
  isConsentCategory,
  type StoredConsent,
} from "./analytics-consent";

/** The native storage key holding the consent answer. */
export const consentRecordKey = "deskohub:consent";

/**
 * Reads the stored native consent record. A missing record is no answer; a
 * malformed one, including one with an unknown category, reads as declined,
 * like a malformed site cookie.
 */
export const parseConsentRecord = (raw: string | null): StoredConsent => {
  if (raw === null) return { kind: "undecided" };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { kind: "decided", categories: [] };
  }
  const categories =
    typeof value === "object" && value !== null && "categories" in value
      ? value.categories
      : undefined;
  return {
    kind: "decided",
    categories:
      Array.isArray(categories) && categories.every(isConsentCategory)
        ? categories
        : [],
  };
};

export const serializeConsentRecord = (
  categories: readonly ConsentCategory[],
  decidedAt: Date
): string => JSON.stringify({ categories, decidedAt: decidedAt.toISOString() });
