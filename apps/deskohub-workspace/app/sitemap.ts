import { Effect } from "effect";
import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { env } from "@/env";
import { getWorkspaceAlternates, locales } from "@/features/i18n";
import { PublishedPublicPagesService } from "@/features/public-pages/backend";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (env.VERCEL_ENV !== "production") return [];

  // Release gates change without a deploy. Evaluate them per request, as the
  // gated pages do, so a build-time value never lists a page that 404s.
  await connection();
  const pages = await PublishedPublicPagesService.pipe(
    Effect.flatMap((publishedPages) => publishedPages.list),
    Effect.provide(PublishedPublicPagesService.Live),
    runWorkspaceEffect("sitemap.published-pages", { boundary: "route" })
  );

  return pages.flatMap(({ pathname }) =>
    locales.map((locale) => {
      const { canonical, languages } = getWorkspaceAlternates(locale, pathname);
      return { url: canonical, alternates: { languages } };
    })
  );
}
