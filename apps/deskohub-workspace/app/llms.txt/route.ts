import { Effect } from "effect";
import { NextResponse } from "next/server";
import { PublishedPublicPagesService } from "@/features/public-pages/backend";
import { renderLlmsTxt } from "@/features/public-pages/backend/llms-txt.server";
import { getMarkdownReleases } from "@/features/public-pages/backend/public-page-markdown.server";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";

/**
 * `/llms.txt`, listing the public pages production serves now. Release gates
 * are read per request, as the sitemap reads them.
 */
export const GET = defineWorkspaceRoute(
  {
    operation: "llmsTxt.get",
    cancellation: "interrupt-on-disconnect",
    caller: "client",
  },
  (_request: Request) =>
    PublishedPublicPagesService.pipe(
      Effect.flatMap((published) => published.list),
      Effect.flatMap((pages) =>
        Effect.tryPromise(() =>
          renderLlmsTxt(
            pages.map(({ pathname }) => pathname),
            getMarkdownReleases(pages)
          )
        )
      ),
      Effect.map(
        (llmsTxt) =>
          new NextResponse(llmsTxt, {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
      ),
      Effect.provide(PublishedPublicPagesService.Live),
      Effect.mapError(
        WorkspaceRouteFailure.internal("llms.txt could not be rendered.")
      )
    )
);
