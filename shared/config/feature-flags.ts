/**
 * Centralized feature flag configuration
 * This provides a single source of truth for all feature flags
 */

export const FEATURE_FLAGS_CONFIG = {
  board_games_list: {
    key: "board_games_list",
    label: "Board Games List",
    description: "Enable the board games list feature in the gallery",
  },
  boardroom_reservations: {
    key: "boardroom_reservations",
    label: "Boardroom Reservations",
    description: "Enable boardroom reservation functionality",
  },
  contact_form: {
    key: "contact_form",
    label: "Contact Form",
    description: "Enable the contact form feature",
  },
  table_reservations: {
    key: "table_reservations",
    label: "Table Reservations",
    description: "Enable table reservation functionality",
  },
  gallery: {
    key: "gallery",
    label: "Gallery",
    description: "Enable the image gallery feature",
  },
  menu_pdf_download: {
    key: "menu_pdf_download",
    label: "Menu PDF Download",
    description: "Enable PDF download for menus",
  },
} as const;

// Type-safe feature flag keys
export type FeatureFlagKey = keyof typeof FEATURE_FLAGS_CONFIG;

// Export as array for iteration
export const FEATURE_FLAGS_LIST = Object.values(FEATURE_FLAGS_CONFIG);

// Constants for special user IDs
export const MANUAL_BUCKETING_USER_IDS = {
  OPTIN: "manual_optin",
  OPTOUT: "manual_optout",
  DEFAULT: "anonymous",
} as const;

// Cookie configuration
export const FEATURE_FLAG_COOKIE_CONFIG = {
  PREFIX: "FF_",
  MAX_AGE: 30 * 24 * 60 * 60, // 30 days in seconds
  SAME_SITE: "lax" as const,
  PATH: "/",
} as const;

// Type for feature flag override values
export type FeatureFlagOverride = "true" | "false" | null;
