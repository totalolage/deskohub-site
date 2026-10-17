import { getAccountScreenCopy } from "@/features/account/components/account-screen-copy";
import type { AccountPageSection } from "@/features/account/sections";
import { type Locale, m } from "@/features/i18n";

/**
 * The account page's document title: the section's at
 * `/account/<section>`, the account's own on the bare `/account`. The page
 * metadata and the in-place section switch share it, so a switched section
 * keeps the title a reload of its path gives.
 */
export const getAccountPageTitle = (
  locale: Locale,
  section?: AccountPageSection
) =>
  section === undefined
    ? m.accountMetadataTitle({}, { locale })
    : m.accountSectionMetadataTitle(
        { section: getAccountScreenCopy(locale).shell.sections[section] },
        { locale }
      );
