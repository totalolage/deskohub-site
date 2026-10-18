import type { MetadataRoute } from "next";
import { env } from "@/env";
import {
  getWorkspaceAlternates,
  locales,
  publicPagePathnames,
} from "@/features/i18n";

export default function sitemap(): MetadataRoute.Sitemap {
  if (env.VERCEL_ENV !== "production") return [];

  return publicPagePathnames.flatMap((pathname) =>
    locales.map((locale) => {
      const { canonical, languages } = getWorkspaceAlternates(locale, pathname);
      return { url: canonical, alternates: { languages } };
    })
  );
}
