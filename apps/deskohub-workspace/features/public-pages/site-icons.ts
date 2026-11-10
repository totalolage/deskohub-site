import type { Metadata } from "next";

/** The site's favicons and Home Screen icon, as page metadata. */
export const siteIcons = {
  icon: [
    {
      url: "/favicon.ico",
      type: "image/x-icon",
      sizes: "16x16 32x32 48x48",
    },
    { url: "/favicon.svg", type: "image/svg+xml" },
    { url: "/favicon.png", type: "image/png", sizes: "512x512" },
  ],
  apple: {
    url: "/apple-touch-icon.png",
    type: "image/png",
    sizes: "180x180",
  },
} as const satisfies Metadata["icons"];
