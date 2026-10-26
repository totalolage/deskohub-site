import "server-only";

import { Effect, Layer } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { isMeetingRoomPageEnabled } from "@/features/meeting-room/backend/meeting-room-page-feature-flag";
import { MeetingRoomPageFeatureFlagService } from "@/features/meeting-room/backend/meeting-room-page-feature-flag.service";
import { OfficeReservationFeatureFlagRenderLayer } from "@/features/office/backend/office-reservation-feature-flag.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { createPublicPageMetadata } from "../page-metadata";
import { publicPageDefinitions } from "../public-page-definitions";
import type { PublicPagePathname } from "../public-pages";
import { PublishedPublicPagesService } from "./published-public-pages.service";

// Each release gate evaluates once per render, shared with the page's other
// readers of that gate such as the header and the advertised prices.
const PublishedPublicPagesRenderLayer =
  PublishedPublicPagesService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(MeetingRoomPageFeatureFlagService, {
          isEnabled: Effect.promise(() => isMeetingRoomPageEnabled()),
        }),
        OfficeReservationFeatureFlagRenderLayer
      )
    )
  );

/**
 * Renders the not-found page while production doesn't serve the public
 * page. A gated page calls it in both its metadata and its body, so
 * crawlers get a real 404 and browsers the not-found boundary.
 *
 * A gate may read the request subject: on a Cache Components page, call it
 * inside the Suspense boundary after `connection()`. An ungated page reads
 * nothing.
 */
export async function requirePublishedPublicPage(pathname: PublicPagePathname) {
  if (publicPageDefinitions[pathname].releaseGate === undefined) return;

  const published = await PublishedPublicPagesService.pipe(
    Effect.flatMap((publishedPages) => publishedPages.isPublished(pathname)),
    Effect.provide(PublishedPublicPagesRenderLayer),
    runWorkspaceEffect("public-pages.require-published")
  );
  if (!published) notFound();
}

/**
 * A public page's `generateMetadata`: its title and description in the
 * request locale, self-canonical and hreflang alternates, and the share
 * card. A gated page's metadata is not found while its gate is off.
 */
export const publicPageMetadata =
  (pathname: PublicPagePathname) => async (): Promise<Metadata> =>
    runWithRequestLocale(async (locale) => {
      await requirePublishedPublicPage(pathname);
      const { title, description, article } = publicPageDefinitions[pathname];

      return createPublicPageMetadata({
        locale,
        pathname,
        title: { page: title({}, { locale }) },
        description: description?.({}, { locale }),
        type: article ? "article" : "website",
      });
    });
