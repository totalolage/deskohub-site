import { Effect } from "effect";
import { NextResponse } from "next/server";
import { getWorkspaceAlternates, type Locale } from "@/features/i18n";
import { PublishedPublicPagesService } from "@/features/public-pages/backend";
import {
  decidePublicPageMarkdownReleases,
  renderPublicPageMarkdown,
} from "@/features/public-pages/backend/public-page-markdown.server";
import { findLocalizedPublicPage } from "@/features/public-pages/page-markdown-negotiation";
import type { PublicPagePathname } from "@/features/public-pages/public-pages";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";
import { markdownContentType } from "@/shared/markdown/markdown";

type PageMarkdownRouteContext = {
  readonly params: Promise<{
    readonly locale: string;
    readonly segments?: ReadonlyArray<string>;
  }>;
};

/**
 * The Markdown variant names its HTML page as canonical and stays out of
 * search indexes, which list the HTML page instead.
 */
const markdownHeaders = (locale: Locale, pathname: PublicPagePathname) => ({
  "Content-Type": markdownContentType,
  Vary: "Accept",
  Link: `<${getWorkspaceAlternates(locale, pathname).canonical}>; rel="canonical"`,
  "X-Robots-Tag": "noindex",
});

const notFound = () =>
  new NextResponse(null, {
    status: 404,
    headers: { "X-Robots-Tag": "noindex" },
  });

/**
 * A public page as Markdown. The proxy rewrites a page request whose `Accept`
 * header prefers Markdown here; the URL is never linked. Release gates are
 * read per request, as the HTML pages read them, so a gated page has no
 * Markdown while it is not served, and the render reads the decisions made
 * here.
 */
export const GET = defineWorkspaceRoute(
  {
    operation: "publicPageMarkdown.get",
    cancellation: "interrupt-on-disconnect",
    caller: "client",
  },
  Effect.fn("publicPageMarkdown.respond")(
    function* (_request: Request, { params }: PageMarkdownRouteContext) {
      const { locale, segments = [] } = yield* Effect.promise(() => params);
      const page = findLocalizedPublicPage(["", locale, ...segments].join("/"));
      if (!page) return notFound();

      const releases = yield* decidePublicPageMarkdownReleases;
      if (!releases.publishedPathnames.includes(page.pathname)) {
        return notFound();
      }

      const markdown = yield* Effect.tryPromise(() =>
        renderPublicPageMarkdown(page.locale, page.pathname, releases)
      );
      return new NextResponse(markdown, {
        headers: markdownHeaders(page.locale, page.pathname),
      });
    },
    Effect.provide(PublishedPublicPagesService.Live),
    Effect.mapError(
      WorkspaceRouteFailure.internal("The page could not be rendered.")
    )
  )
);
