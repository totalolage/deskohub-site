import vercel from "@astrojs/vercel";
import { defineConfig } from "astro/config";

export default defineConfig({
  compressHTML: true,
  adapter: vercel({
    imageService: true,
    webAnalytics: {
      enabled: true,
    },
  }),
  output: "server",
});
