import { Effect } from "effect";
import type { PhrasingContent } from "mdast";
import { getPublicOpeningHours } from "@/features/checkout/public-offerings";
import { getWorkspacePageUrl, type Locale, m } from "@/features/i18n";
import {
  coworkReservationPath,
  meetingRoomReservationPath,
} from "@/features/reservation/routes";
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
        m.contactOpeningHoursLabel({}, { locale }),
        getPublicOpeningHours(locale)
      ),
      detail(
        m.contactTransportLabel({}, { locale }),
        m.contactTransport({}, { locale })
      ),
      detail(
        m.contactAccessLabel({}, { locale }),
        m.contactAccess({}, { locale })
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
    markdownHeading(2, m.contactBookingLabel({}, { locale })),
    markdownList([
      markdownListItem(
        markdownLink(
          getWorkspacePageUrl(coworkReservationPath),
          m.coworkReservationLink({}, { locale })
        )
      ),
      markdownListItem(
        markdownLink(
          getWorkspacePageUrl(meetingRoomReservationPath),
          m.meetingRoomReservationLink({}, { locale })
        )
      ),
    ]),
  ]);
};
