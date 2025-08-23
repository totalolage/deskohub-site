import {
  createDefaultStatsigAdapter,
  type StatsigUser,
} from "@flags-sdk/statsig";
import { flag } from "flags/next";
import {
  FEATURE_FLAGS_CONFIG,
  type FeatureFlagKey,
  MANUAL_BUCKETING_USER_IDS,
} from "@/shared/config/feature-flags";
import { isDev } from "@/shared/utils/environment";
import { getFeatureFlagOverride } from "@/shared/utils/feature-flags/cookies";

// Create the Statsig adapter using environment variables
const statsigAdapter = createDefaultStatsigAdapter();

// Helper function to create feature flags with manual bucketing support
export const createFeatureFlag = (key: FeatureFlagKey) =>
  flag<boolean, StatsigUser>({
    key,
    adapter: statsigAdapter.featureGate((gate) => gate.value, {
      exposureLogging: true,
    }),
    // Identify function that checks for manual overrides
    identify: async () => {
      // In development, always use "developer" userID
      if (isDev()) {
        return {
          userID: "developer",
        };
      }

      // In production/deployed environments, check for cookie-based manual override
      const override = await getFeatureFlagOverride(key);

      // Determine the user ID based on override
      let userID: string = MANUAL_BUCKETING_USER_IDS.DEFAULT;
      if (override === "true") {
        userID = MANUAL_BUCKETING_USER_IDS.OPTIN;
      } else if (override === "false") {
        userID = MANUAL_BUCKETING_USER_IDS.OPTOUT;
      }

      return {
        userID,
      };
    },
  });

// Define our feature flags with type safety
export const boardGamesListFlag = createFeatureFlag(
  FEATURE_FLAGS_CONFIG.board_games_list.key
);
export const boardroomReservationsFlag = createFeatureFlag(
  FEATURE_FLAGS_CONFIG.boardroom_reservations.key
);
export const contactFormFlag = createFeatureFlag(
  FEATURE_FLAGS_CONFIG.contact_form.key
);
export const tableReservationsFlag = createFeatureFlag(
  FEATURE_FLAGS_CONFIG.table_reservations.key
);
export const galleryFlag = createFeatureFlag(FEATURE_FLAGS_CONFIG.gallery.key);
export const menuPdfFlag = createFeatureFlag(
  FEATURE_FLAGS_CONFIG.menu_pdf_download.key
);
