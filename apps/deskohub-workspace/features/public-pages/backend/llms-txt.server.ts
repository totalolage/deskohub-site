import "server-only";

import { Effect } from "effect";
import { customerAgentCatalog } from "@/features/agent-tools/customer-agent-catalog";
import type { GlobalRelease } from "@/features/feature-flags/backend/global-release";
import { llmsTxtLocale, llmsTxtMarkdown } from "../llms-txt";
import {
  type PublicPageMarkdownReleases,
  readSharedMarkdown,
  renderFromMarkdownSources,
} from "./public-page-markdown.server";

/**
 * `llms.txt` for the published pages and the published agent tools. It reads
 * no per-request data, so it is shared like other public content; a render
 * that had to fall back to catalog prices is not shared.
 */
export async function renderLlmsTxt(
  releases: PublicPageMarkdownReleases,
  siteToolsRelease: GlobalRelease
): Promise<string> {
  "use cache";

  return await readSharedMarkdown(
    "llmsTxt.render",
    renderFromMarkdownSources(llmsTxtLocale, releases, ({ offerings }) =>
      Effect.map(offerings, (loaded) =>
        llmsTxtMarkdown({
          pages: releases.publishedPathnames,
          offerings: loaded,
          agentInterfaces: {
            ...customerAgentCatalog.published,
            siteToolsRelease,
          },
        })
      )
    )
  );
}
