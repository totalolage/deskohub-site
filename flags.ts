import {
  createDefaultStatsigAdapter,
  type StatsigUser,
} from "@flags-sdk/statsig";
import { flag } from "flags/next";

// Create the Statsig adapter using environment variables
const statsigAdapter = createDefaultStatsigAdapter();

// Helper function to create feature flags
export const createFeatureFlag = (key: string) =>
  flag<boolean, StatsigUser>({
    key,
    adapter: statsigAdapter.featureGate((gate) => gate.value, {
      exposureLogging: true,
    }),
    // Simple user identification - can be enhanced with actual user data
    identify: async () => ({
      userID: "anonymous",
    }),
  });

// Define our feature flags
export const boardGamesListFlag = createFeatureFlag("board_games_list");
export const boardroomReservationsFlag = createFeatureFlag(
  "boardroom_reservations"
);
export const contactFormFlag = createFeatureFlag("contact_form");
export const tableReservationsFlag = createFeatureFlag("table_reservations");
export const galleryFlag = createFeatureFlag("gallery");
export const menuPdfFlag = createFeatureFlag("menu_pdf_download");
