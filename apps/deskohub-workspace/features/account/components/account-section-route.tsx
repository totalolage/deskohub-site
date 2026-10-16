import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AccountContentLoading } from "@/features/account/components/account-loading";
import { AccountPage } from "@/features/account/components/account-page";
import { loadCustomerAccountPage } from "@/features/account/page-data.server";
import { getAccountPageTitle } from "@/features/account/page-title";
import {
  isAccountPageSection,
  isAccountSectionReleased,
} from "@/features/account/sections";
import {
  areAccountsEnabled,
  arePasskeysEnabled,
} from "@/features/account/server/account-feature-flag.server";
import { type Locale, m } from "@/features/i18n";
import { areReferralsEnabled } from "@/features/referrals/referral-feature-flag.server";

export function getAccountSectionMetadata(
  locale: Locale,
  section: string
): Metadata {
  if (!isAccountPageSection(section)) notFound();

  return {
    title: getAccountPageTitle(locale, section),
    description: m.accountMetadataDescription({}, { locale }),
    robots: { index: false, follow: false },
  };
}

/**
 * The account page. Every section renders the same page, which the account
 * layout's navigation switches between in place; `section` is the requested
 * path segment, absent on the bare account path. An unknown or unreleased
 * section is not found.
 */
export function AccountSectionRoute({
  locale,
  section,
}: {
  readonly locale: Locale;
  readonly section?: Promise<string>;
}) {
  return (
    <Suspense fallback={<AccountContentLoading locale={locale} />}>
      <AccountSectionContent locale={locale} section={section} />
    </Suspense>
  );
}

async function AccountSectionContent({
  locale,
  section,
}: {
  readonly locale: Locale;
  readonly section?: Promise<string>;
}) {
  await connection();
  if (!(await areAccountsEnabled())) notFound();
  if (section !== undefined) {
    const requestedSection = await section;
    if (!isAccountPageSection(requestedSection)) notFound();
    const [passkeysEnabled, referralsEnabled] = await Promise.all([
      arePasskeysEnabled(),
      areReferralsEnabled(),
    ]);
    if (
      !isAccountSectionReleased(requestedSection, {
        passkeysEnabled,
        referralsEnabled,
      })
    ) {
      notFound();
    }
  }

  const state = await loadCustomerAccountPage();

  return <AccountPage locale={locale} state={state} />;
}
