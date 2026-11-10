import type { Metadata } from "next";
import { siteIcons } from "@/features/public-pages/site-icons";

/**
 * Metadata for the pages that offer the install bar, so adding one of them
 * to an iPhone or iPad Home Screen gives the web app's own icon and name:
 * Safari prefers a page's touch icon over the manifest's icons, and without
 * a web app title it may name the icon after the page title.
 */
export const homeScreenAppMetadata = {
  icons: {
    ...siteIcons,
    apple: {
      url: "/app/icons/apple-touch-icon.png",
      type: "image/png",
      sizes: "180x180",
    },
  },
  appleWebApp: { title: "Deskohub" },
} as const satisfies Metadata;
