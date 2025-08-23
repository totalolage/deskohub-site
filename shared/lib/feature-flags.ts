import { createStatsigAdapter, type StatsigUser } from "@flags-sdk/statsig";
import { flag } from "flags/next";
import { cache } from "react";
import { env } from "@/env";
import {
  FEATURE_FLAGS_CONFIG,
  type FeatureFlagKey,
  MANUAL_BUCKETING_USER_IDS,
} from "@/shared/config/feature-flags";
import { isDev } from "@/shared/utils/environment";
import { getFeatureFlagOverride } from "@/shared/utils/feature-flags/cookies";

/**
 * Statsig adapter configuration - direct API connection (no Edge Config)
 */
const statsigAdapter = createStatsigAdapter({
  statsigServerApiKey: env.STATSIG_SERVER_API_KEY,
  statsigOptions: {
    // Longer sync intervals since we're not using Edge Config
    rulesetsSyncIntervalMs: isDev() ? 10000 : 60000, // 10s in dev, 60s in prod
    // Enable in-memory caching
    initStrategyForIDLists: "none",
    disableIdListsSync: true,
  },
});

/**
 * Base flag creator with manual bucketing support
 */
const createFeatureFlag = (key: FeatureFlagKey) =>
  flag<boolean, StatsigUser>({
    key,
    adapter: statsigAdapter.featureGate((gate) => gate.value, {
      exposureLogging: true,
    }),
    // Identify function that checks for manual overrides
    identify: async () => {
      // Always check for cookie-based manual override first
      const override = await getFeatureFlagOverride(key);

      // If there's a cookie override, use the corresponding user ID
      if (override === "true") {
        return {
          userID: MANUAL_BUCKETING_USER_IDS.OPTIN,
        };
      } else if (override === "false") {
        return {
          userID: MANUAL_BUCKETING_USER_IDS.OPTOUT,
        };
      }

      // If no cookie override, use environment-specific defaults
      if (isDev()) {
        return {
          userID: "developer",
        };
      }

      // In production without override, use default anonymous user
      return {
        userID: MANUAL_BUCKETING_USER_IDS.DEFAULT,
      };
    },
  });

/**
 * Define all feature flags
 */
const _boardGamesListFlag = createFeatureFlag(
  FEATURE_FLAGS_CONFIG.board_games_list.key
);
const _boardroomReservationsFlag = createFeatureFlag(
  FEATURE_FLAGS_CONFIG.boardroom_reservations.key
);
const _contactFormFlag = createFeatureFlag(
  FEATURE_FLAGS_CONFIG.contact_form.key
);
const _tableReservationsFlag = createFeatureFlag(
  FEATURE_FLAGS_CONFIG.table_reservations.key
);
const _galleryFlag = createFeatureFlag(FEATURE_FLAGS_CONFIG.gallery.key);
const _menuPdfFlag = createFeatureFlag(
  FEATURE_FLAGS_CONFIG.menu_pdf_download.key
);

/**
 * Batch fetch all feature flags in a single API call.
 * This is cached at the request level using React's cache().
 */
const getAllFlags = cache(async () => {
  const [
    boardGamesList,
    boardroomReservations,
    contactForm,
    tableReservations,
    gallery,
    menuPdf,
  ] = await Promise.all([
    _boardGamesListFlag(),
    _boardroomReservationsFlag(),
    _contactFormFlag(),
    _tableReservationsFlag(),
    _galleryFlag(),
    _menuPdfFlag(),
  ]);

  return {
    boardGamesList,
    boardroomReservations,
    contactForm,
    tableReservations,
    gallery,
    menuPdf,
  };
});

/**
 * Public API - Individual flag functions that use the cached batch result.
 * These ensure only one API call to Statsig per request.
 */
export const boardGamesListFlag = async () => {
  const flags = await getAllFlags();
  return flags.boardGamesList;
};

export const boardroomReservationsFlag = async () => {
  const flags = await getAllFlags();
  return flags.boardroomReservations;
};

export const contactFormFlag = async () => {
  const flags = await getAllFlags();
  return flags.contactForm;
};

export const tableReservationsFlag = async () => {
  const flags = await getAllFlags();
  return flags.tableReservations;
};

export const galleryFlag = async () => {
  const flags = await getAllFlags();
  return flags.gallery;
};

export const menuPdfFlag = async () => {
  const flags = await getAllFlags();
  return flags.menuPdf;
};

/**
 * Export batch function for cases where multiple flags are needed at once
 */
export { getAllFlags };
