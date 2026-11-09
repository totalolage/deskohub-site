import { Effect, Layer } from "effect";
import { NextResponse } from "next/server";
import { SiteToolsReleaseGate } from "@/features/agent-tools/site-tools-release-gate";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend";
import { PublishedPublicPagesService } from "@/features/public-pages/backend";
import { renderLlmsTxt } from "@/features/public-pages/backend/llms-txt.server";
import { decidePublicPageMarkdownReleases } from "@/features/public-pages/backend/public-page-markdown.server";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";
import { markUnindexedResponse } from "@/shared/utils/unindexed-response";

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
      SiteToolsReleaseGate.release,
    ]).pipe(
      Effect.flatMap(([releases, siteToolsRelease]) =>
        Effect.tryPromise(() => renderLlmsTxt(releases, siteToolsRelease))
      ),
      Effect.map((llmsTxt) =>
        markUnindexedResponse(
          new NextResponse(llmsTxt, {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
        )
      ),
      Effect.provide(
        Layer.mergeAll(
          PublishedPublicPagesService.Live,
          WorkspaceFeatureFlagService.Default
        )
      ),
      Effect.mapError(
        WorkspaceRouteFailure.internal("llms.txt could not be rendered.")
      )
    )
);
