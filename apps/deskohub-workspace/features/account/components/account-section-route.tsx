import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AccountContentLoading } from "@/features/account/components/account-loading";
import { AccountPage } from "@/features/account/components/account-page";
import { loadCustomerAccountPage } from "@/features/account/page-data.server";
import { getAccountPageTitle } from "@/features/account/page-title";
import { findAccountSectionOfPathname } from "@/features/account/routes";
import {
  isAccountPageSection,
  isAccountSectionReleased,
} from "@/features/account/sections";
import { arePasskeysEnabled } from "@/features/account/server/account-feature-flag.server";
import { type Locale, m } from "@/features/i18n";
import { areReferralsEnabled } from "@/features/referrals/referral-feature-flag.server";
import { getRequestPathname } from "@/shared/backend/utils/request-pathname";

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
 *
 * The layout receives no section param, so it checks the requested path's
 * section itself before loading the account: an unknown or withheld section is
 * not found before any account content, or the signed-out redirect to sign-in,
 * renders.
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
  const pathname = await getRequestPathname();
  await ensureAccountPageSectionShown(
    pathname === undefined
      ? undefined
      : findAccountSectionOfPathname(locale, pathname)
  );
  const state = await loadCustomerAccountPage();

  return <AccountPage locale={locale} state={state} />;
}

/**
 * A section path's own page, which renders nothing besides the sections'
 * layout: an unknown or unreleased section is not found. The layout checks the
 * same on every render; this check covers a client navigation, which renders
 * the page without the already rendered layout.
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
  await ensureAccountPageSectionShown(await section);

  return null;
}

/** Not found unless the section is an account page section that is released. */
async function ensureAccountPageSectionShown(section: string | undefined) {
  if (section === undefined || !isAccountPageSection(section)) notFound();
  const [passkeysEnabled, referralsEnabled] = await Promise.all([
    arePasskeysEnabled(),
    areReferralsEnabled(),
  ]);
  if (
    !isAccountSectionReleased(section, { passkeysEnabled, referralsEnabled })
  ) {
    notFound();
  }
}
