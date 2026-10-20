import { type ReactNode, Suspense } from "react";
import { env } from "@/env";
import { SiteToolsWhenEnabled } from "@/features/agent-tools/site-tools-when-enabled";
import { ConsentAwareAnalytics } from "@/features/cookie-consent/components/consent-aware-analytics";
import { CookieConsentProvider } from "@/features/cookie-consent/components/cookie-consent-provider";
import { DeferredTagManager } from "@/features/cookie-consent/components/deferred-tag-manager";
import { PostHogProvider } from "@/features/cookie-consent/components/posthog-analytics";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import heroImage from "@/features/landing-page/images/hero.jpeg";
import { RememberSharedReferralCodeWhenEnabled } from "@/features/referrals/remember-shared-referral-code-when-enabled";
import { postHogRuntimeConfig } from "@/shared/backend/config/posthog.config";
import { LocalBusinessStructuredData } from "@/shared/components/structured-data";
import { UnsavedChangesProvider } from "@/shared/components/unsaved-changes-guard";

// Customer-only providers live here so the admin suite under [locale]/admin stays outside them.
export default async function SiteLayout({
  children,
  modal,
}: {
  readonly children: ReactNode;
  /** The sign-in and verify modals a client navigation opens over a page. */
  readonly modal: ReactNode;
}) {
  const locale = await getRequestLocale();
  const gtmId = env.NEXT_PUBLIC_GTM_ID;

  return (
    <>
      <LocalBusinessStructuredData image={heroImage} locale={locale} />
      {gtmId && <DeferredTagManager gtmId={gtmId} />}
      <PostHogProvider>
        <CookieConsentProvider locale={locale} />
        <RememberSharedReferralCodeWhenEnabled />
        <SiteToolsWhenEnabled locale={locale} />
        <Suspense fallback={null}>
          <ConsentAwareAnalytics
            featureFlagOverrides={postHogRuntimeConfig.featureFlagOverrides}
            posthogEnvironment={env.VERCEL_ENV}
          />
        </Suspense>
        <UnsavedChangesProvider>
          {children}
          {modal}
        </UnsavedChangesProvider>
      </PostHogProvider>
    </>
  );
}
