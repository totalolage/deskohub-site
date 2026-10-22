import "server-only";

import { Effect } from "effect";
import { cacheLife } from "next/cache";
import { publishedCustomerAgentTools } from "@/features/agent-tools/customer-agent-tools";
import type { GlobalRelease } from "@/features/feature-flags/backend/global-release";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { serializeMarkdown } from "@/shared/markdown/markdown";
import { llmsTxtLocale, llmsTxtMarkdown } from "../llms-txt";
import {
  type PublicPageMarkdownReleases,
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

  const { value: blocks, complete } = await renderFromMarkdownSources(
    llmsTxtLocale,
    releases,
    ({ offerings }) =>
      Effect.map(offerings, (loaded) =>
        llmsTxtMarkdown({
          pages: releases.publishedPathnames,
          offerings: loaded,
          agentInterfaces: {
            tools: publishedCustomerAgentTools,
            siteToolsRelease,
          },
        })
      )
  ).pipe(runWorkspaceEffect("llmsTxt.render", { boundary: "route" }));

  if (complete) cacheLife("publicContent");
  else cacheLife({ expire: 0 });
  return serializeMarkdown(blocks);
}
