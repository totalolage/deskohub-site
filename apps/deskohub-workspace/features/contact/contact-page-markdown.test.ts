import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { getPublicOpeningHours } from "@/features/checkout/public-offerings";
import { locales, m } from "@/features/i18n";
import { serializeMarkdown } from "@/shared/markdown/markdown";
import {
  markdownLinkUrls,
  markdownPlainText,
} from "@/shared/markdown/markdown.test-utils";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { contactPageMarkdown } from "./contact-page-markdown";

// Left out on purpose: the metadata title and description, which the page
// sends as metadata, and the whole contact form (contactFormTitle, the
// field labels and placeholders, validation, submit, privacy note and result
// messages), whose controls need a browser.
describe.each(locales)("contactPageMarkdown in %s", (locale) => {
  const { brand, company, contact, location } = workspaceSiteConstants;

  test("lists every contact detail with its label, then the booking links", async () => {
    const markdown = serializeMarkdown(
      await Effect.runPromise(contactPageMarkdown(locale))
    );

    expect(markdownPlainText(markdown)).toBe(
      [
        m.contactDetailsTitle({}, { locale }),
        `${m.contactCompanyLabel({}, { locale })}: ${brand.legalName}`,
        `${m.contactAddressLabel({}, { locale })}: ${location.address.street}, ${location.address.cityDistrict}, ${location.address.postalCode} ${location.address.city}`,
        `${m.contactOpeningHoursLabel({}, { locale })}: ${getPublicOpeningHours(locale)}`,
        `${m.contactTransportLabel({}, { locale })}: ${m.contactTransport({}, { locale })}`,
        `${m.contactAccessLabel({}, { locale })}: ${m.contactAccess({}, { locale })}`,
        `${m.contactEmailLabel({}, { locale })}: ${contact.infoEmail}`,
        `${m.footerCompanyIdLabel({}, { locale })}: ${company.identificationNumber}`,
        `${m.contactTaxIdLabel({}, { locale })}: ${company.taxIdentificationNumber}`,
        m.contactBookingLabel({}, { locale }),
        m.coworkReservationLink({}, { locale }),
        m.meetingRoomReservationLink({}, { locale }),
      ].join("\n")
    );
    expect(markdown).toStartWith(`# ${m.contactDetailsTitle({}, { locale })}`);
    expect(markdownLinkUrls(markdown)).toEqual([
      `mailto:${contact.infoEmail}`,
      "https://workspace.deskohub.cz/reservation/cowork",
      "https://workspace.deskohub.cz/reservation/meeting-room",
    ]);
  });
});
