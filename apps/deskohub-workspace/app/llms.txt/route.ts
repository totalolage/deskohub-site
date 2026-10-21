import { Effect, Layer } from "effect";
import { NextResponse } from "next/server";
import { SiteToolsFeatureFlagService } from "@/features/agent-tools/site-tools-feature-flag.service";
import { PublishedPublicPagesService } from "@/features/public-pages/backend";
import { renderLlmsTxt } from "@/features/public-pages/backend/llms-txt.server";
import { decidePublicPageMarkdownReleases } from "@/features/public-pages/backend/public-page-markdown.server";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";

/**
 * `/llms.txt`, listing the public pages production serves now and the agent
 * interfaces. Page release gates are read per request, as the sitemap reads
 * them; the site tools are described as released for every visitor.
 */
export const GET = defineWorkspaceRoute(
  {
    operation: "llmsTxt.get",
    cancellation: "interrupt-on-disconnect",
    caller: "client",
  },
  (_request: Request) =>
    Effect.all([
      decidePublicPageMarkdownReleases,
      SiteToolsFeatureFlagService.pipe(
        Effect.flatMap((siteTools) => siteTools.release)
      ),
    ]).pipe(
      Effect.flatMap(([releases, siteToolsRelease]) =>
        Effect.tryPromise(() => renderLlmsTxt(releases, siteToolsRelease))
      ),
      Effect.map(
        (llmsTxt) =>
          new NextResponse(llmsTxt, {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
      ),
      Effect.provide(
        Layer.mergeAll(
          PublishedPublicPagesService.Live,
          SiteToolsFeatureFlagService.Live
        )
      ),
      Effect.mapError(
        WorkspaceRouteFailure.internal("llms.txt could not be rendered.")
      )
    )
);
