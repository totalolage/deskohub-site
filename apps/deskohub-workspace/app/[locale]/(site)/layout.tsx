import { type ReactNode, Suspense } from "react";
import { env } from "@/env";
import { ConsentAwareAnalytics } from "@/features/cookie-consent/components/consent-aware-analytics";
import { CookieConsentProvider } from "@/features/cookie-consent/components/cookie-consent-provider";
import { DeferredTagManager } from "@/features/cookie-consent/components/deferred-tag-manager";
import { PostHogProvider } from "@/features/cookie-consent/components/posthog-analytics";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { RememberSharedReferralCodeWhenEnabled } from "@/features/referrals/remember-shared-referral-code-when-enabled";
import { postHogRuntimeConfig } from "@/shared/backend/config/posthog.config";
import { UnsavedChangesProvider } from "@/shared/components/unsaved-changes-guard";

// Customer-only providers live here so the admin suite under [locale]/admin stays outside them.
export default async function SiteLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const locale = await getRequestLocale();
  const gtmId = env.NEXT_PUBLIC_GTM_ID;

  return (
    <>
      {gtmId && <DeferredTagManager gtmId={gtmId} />}
      <PostHogProvider>
        <CookieConsentProvider locale={locale} />
        <RememberSharedReferralCodeWhenEnabled />
        <Suspense fallback={null}>
          <ConsentAwareAnalytics
            featureFlagOverrides={postHogRuntimeConfig.featureFlagOverrides}
            posthogEnvironment={env.VERCEL_ENV}
          />
        </Suspense>
        <UnsavedChangesProvider>{children}</UnsavedChangesProvider>
      </PostHogProvider>
    </>
  );
}
