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
import { arePasskeysEnabled } from "@/features/account/server/account-feature-flag.server";
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
 * The account page: every section, which the account layout's navigation
 * switches between in place by replacing the URL. The sections' route-group
 * layout renders it for the bare account path and every section's path, so a
 * Server Action or refresh after an in-place switch keeps it mounted, with its
 * open dialogs and drafts: it re-renders the switched path's route, and only
 * the section paths' own pages differ.
 */
export function AccountSections({ locale }: { readonly locale: Locale }) {
  return (
    <Suspense fallback={<AccountContentLoading locale={locale} />}>
      <AccountSectionsContent locale={locale} />
    </Suspense>
  );
}

async function AccountSectionsContent({ locale }: { readonly locale: Locale }) {
  await connection();
  const state = await loadCustomerAccountPage();

  return <AccountPage locale={locale} state={state} />;
}

/**
 * A section path's own page, which renders nothing besides the sections'
 * layout: an unknown or unreleased section is not found.
 */
export function AccountSectionPathCheck({
  section,
}: {
  readonly section: Promise<string>;
}) {
  return (
    <Suspense fallback={null}>
      <AccountSectionPathCheckContent section={section} />
    </Suspense>
  );
}

async function AccountSectionPathCheckContent({
  section,
}: {
  readonly section: Promise<string>;
}) {
  await connection();
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

  return null;
}
