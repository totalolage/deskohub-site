import { Effect } from "effect";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { WorkspaceFeatureFlagServiceLive } from "@/features/feature-flags/backend/workspace-feature-flag.server";
import type { Locale } from "@/features/i18n";
import { isMeetingRoomPageEnabled } from "@/features/meeting-room/backend/meeting-room-page-feature-flag";
import { WorkspaceEffect } from "@/shared/backend/workspace-effect";
import { PublicSiteFooter } from "@/shared/components/public-site-footer";
import { SiteHeader } from "@/shared/components/site-header";
import { getSiteHeaderConfig } from "@/shared/components/site-header-config";

type FullHeaderLayoutProps = {
  children: ReactNode;
  params: Promise<{ locale: Locale }>;
};

export default WorkspaceEffect.page(
  {
    operation: "site.full-header.render",
    layer: WorkspaceFeatureFlagServiceLive,
  },
  ({ children, params }: FullHeaderLayoutProps) =>
    Effect.gen(function* () {
      yield* Effect.promise(() => connection());
      const { locale } = yield* Effect.promise(() => params);
      const meetingRoomPageEnabled = yield* isMeetingRoomPageEnabled;
      const siteHeaderConfig = getSiteHeaderConfig(locale, {
        meetingRoomPageEnabled,
      });

      return (
        <>
          <SiteHeader currentLocale={locale} {...siteHeaderConfig} />
          {children}
          <PublicSiteFooter locale={locale} />
        </>
      );
    })
);
