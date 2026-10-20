import { Effect } from "effect";
import type { PhrasingContent } from "mdast";
import { type Locale, m } from "@/features/i18n";
import {
  type MarkdownBlocks,
  markdownHeading,
  markdownLink,
  markdownList,
  markdownListItem,
  markdownStrong,
} from "@/shared/markdown/markdown";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

/**
 * The contact page's details as Markdown. The contact form is left out: its
 * controls have nothing to read without a browser.
 */
export const contactPageMarkdown = (
  locale: Locale
): Effect.Effect<MarkdownBlocks> => {
  const { brand, company, contact, location } = workspaceSiteConstants;
  const detail = (label: string, value: PhrasingContent | string) =>
    markdownListItem(markdownStrong(`${label}:`), " ", value);

  return Effect.succeed([
    markdownHeading(1, m.contactDetailsTitle({}, { locale })),
    markdownList([
      detail(m.contactCompanyLabel({}, { locale }), brand.legalName),
      detail(
        m.contactAddressLabel({}, { locale }),
        `${location.address.street}, ${location.address.cityDistrict}, ${location.address.postalCode} ${location.address.city}`
      ),
      detail(
        m.contactEmailLabel({}, { locale }),
        markdownLink(`mailto:${contact.infoEmail}`, contact.infoEmail)
      ),
      detail(
        m.footerCompanyIdLabel({}, { locale }),
        company.identificationNumber
      ),
      detail(
        m.contactTaxIdLabel({}, { locale }),
        company.taxIdentificationNumber
      ),
    ]),
  ]);
};
