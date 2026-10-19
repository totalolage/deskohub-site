import "server-only";

import { cacheLife } from "next/cache";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { serializeMarkdown } from "@/shared/markdown/markdown";
import { llmsTxtLocale, llmsTxtMarkdown } from "../llms-txt";
import type { PublicPagePathname } from "../public-pages";
import {
  createMarkdownSources,
  type PublicPageMarkdownReleases,
} from "./public-page-markdown.server";

/**
 * `llms.txt` for the published pages. It reads no per-request data, so it is
 * shared like other public content; a render that had to fall back to
 * catalog prices is not shared.
 */
export async function renderLlmsTxt(
  pages: ReadonlyArray<PublicPagePathname>,
  releases: PublicPageMarkdownReleases
): Promise<string> {
  "use cache";
  cacheLife("publicContent");

  const { sources, isComplete } = createMarkdownSources(
    llmsTxtLocale,
    releases
  );
  const offerings = await sources.offerings.pipe(
    runWorkspaceEffect("llmsTxt.render", { boundary: "route" })
  );

  if (!isComplete()) cacheLife({ expire: 0 });
  return serializeMarkdown(llmsTxtMarkdown({ pages, offerings }));
}
