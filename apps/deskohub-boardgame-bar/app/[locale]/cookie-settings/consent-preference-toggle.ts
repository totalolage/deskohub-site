import type { ConsentCategory } from "@/features/cookie-consent";

export type ConsentPreferences = Record<ConsentCategory, boolean>;

type ConsentPreferenceToggle = {
  preferences: ConsentPreferences;
  setPreferences: (
    update: (previous: ConsentPreferences) => ConsentPreferences
  ) => void;
  acceptCategory: (category: ConsentCategory) => void;
  rejectCategory: (category: ConsentCategory) => void;
};

/**
 * Flips one optional consent category and records the new choice.
 * Necessary cookies are always on and cannot be toggled.
 */
export const toggleConsentPreference = (
  category: ConsentCategory,
  {
    preferences,
    setPreferences,
    acceptCategory,
    rejectCategory,
  }: ConsentPreferenceToggle
) => {
  if (category === "necessary") return;

  const newValue = !preferences[category];
  setPreferences((previous) => ({ ...previous, [category]: newValue }));

  if (newValue) {
    acceptCategory(category);
  } else {
    rejectCategory(category);
  }
};
