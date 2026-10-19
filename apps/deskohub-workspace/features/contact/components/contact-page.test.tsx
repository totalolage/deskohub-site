import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { getPublicOpeningHours } from "@/features/checkout/public-offerings";
import { locales, m } from "@/features/i18n";

mock.module("@/features/contact/components/contact-form", () => ({
  ContactForm: () => null,
}));

const { ContactPage } = await import("./contact-page");

for (const locale of locales) {
  test(`shows the opening hours with the contact details in ${locale}`, () => {
    const html = renderToStaticMarkup(<ContactPage locale={locale} />);

    expect(html).toContain(m.contactOpeningHoursLabel({}, { locale }));
    expect(html).toContain(getPublicOpeningHours(locale));
    expect(html).toContain("17:00");
  });
}
