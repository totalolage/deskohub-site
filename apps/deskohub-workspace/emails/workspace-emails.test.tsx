import { describe, expect, test } from "bun:test";
import { render } from "react-email";
import type { Locale } from "@/features/i18n";
import { staffEmailLocale } from "@/shared/backend/email/staff-email-locale";
import {
  contactBusinessPreviewProps,
  contactConfirmationPreviewProps,
  customerReservationPreviewProps,
  invoiceDeliveryPreviewProps,
  reservationAuthorPreviewProps,
  reservationNotificationPreviewProps,
  workspaceCampaignPreviewProps,
} from "./_fixtures/preview-props";
import { ContactBusinessEmail } from "./contact-business";
import { ContactConfirmationEmail } from "./contact-confirmation";
import { CustomerReservationEmail } from "./customer-reservation";
import {
  InvoiceDeliveryEmail,
  type InvoiceDeliveryEmailProps,
} from "./invoice-delivery";
import { ReservationAuthorEmail } from "./reservation-author";
import { ReservationNotificationEmail } from "./reservation-notification";
import { WorkspaceCampaignEmail } from "./workspace-campaign";

describe("Workspace React Email templates", () => {
  test("renders every template preview", async () => {
    const [
      business,
      confirmation,
      customerReservation,
      staffNotification,
      invoiceDelivery,
      campaign,
    ] = await Promise.all([
      render(<ContactBusinessEmail {...contactBusinessPreviewProps} />),
      render(<ContactConfirmationEmail {...contactConfirmationPreviewProps} />),
      render(<CustomerReservationEmail {...customerReservationPreviewProps} />),
      render(
        <ReservationNotificationEmail
          {...reservationNotificationPreviewProps}
        />
      ),
      render(<InvoiceDeliveryEmail {...invoiceDeliveryPreviewProps} />),
      render(<WorkspaceCampaignEmail {...workspaceCampaignPreviewProps} />),
    ]);

    expect(business).toContain(contactBusinessPreviewProps.name);
    expect(confirmation).toContain('lang="en-US"');
    expect(customerReservation).toContain(
      customerReservationPreviewProps.heading
    );
    expect(customerReservation).toContain(
      `href="${customerReservationPreviewProps.access.url}"`
    );
    expect(staffNotification).toContain(
      reservationNotificationPreviewProps.heading
    );
    expect(invoiceDelivery).toContain(
      invoiceDeliveryPreviewProps.invoiceNumber
    );
    expect(campaign).toContain("Podzim ve Workspace");
    expect(campaign).toContain(
      `href="${workspaceCampaignPreviewProps.footer.marketingPreferencesUrl}"`
    );
  });

  test("renders the author confirmation with only its status link", async () => {
    const html = await render(
      <ReservationAuthorEmail {...reservationAuthorPreviewProps} />
    );

    expect(html).toContain(reservationAuthorPreviewProps.heading);
    expect(html).toContain(
      `href="${reservationAuthorPreviewProps.status.url}"`
    );
    expect(html).toContain(reservationAuthorPreviewProps.table.name);
    expect(html).not.toContain("accessToken");
    expect(html).not.toContain(
      customerReservationPreviewProps.network.password
    );
  });
});

const czechThenEnglish = ["cs-CZ", "en-US"] as const satisfies Locale[];

describe("contact emails", () => {
  test("write the staff notification in the staff locale", async () => {
    const html = await render(
      <ContactBusinessEmail {...contactBusinessPreviewProps} />
    );

    expect(html).toContain(`lang="${staffEmailLocale}"`);
    expect(html).toContain(contactBusinessPreviewProps.email);
  });

  test("list the phone only when the visitor gave one", async () => {
    const { phone, ...withoutPhone } = contactBusinessPreviewProps;
    const [withPhoneText, withoutPhoneText] = await Promise.all([
      render(<ContactBusinessEmail {...contactBusinessPreviewProps} />, {
        plainText: true,
      }),
      render(<ContactBusinessEmail {...withoutPhone} />, { plainText: true }),
    ]);

    expect(withPhoneText).toContain(phone);
    expect(withoutPhoneText).not.toContain(phone);
  });

  test("quote the visitor's message line by line in their locale", async () => {
    const message = "First line\nSecond line";
    const [czech, english] = await Promise.all(
      czechThenEnglish.map((locale) =>
        render(<ContactConfirmationEmail locale={locale} message={message} />)
      )
    );

    expect(czech).toContain('lang="cs-CZ"');
    expect(english).toContain('lang="en-US"');
    expect(czech).not.toBe(english);
    expect(english).toContain("First line<br/>Second line");
  });
});

describe("invoice delivery email", () => {
  const manualInvoice = (requestsPayment: boolean) =>
    ({
      ...invoiceDeliveryPreviewProps,
      invoice: { source: "manual", requestsPayment },
    }) satisfies InvoiceDeliveryEmailProps;

  test("writes the customer copy in the invoice's locale", async () => {
    const [czech, english] = await Promise.all(
      czechThenEnglish.map((locale) =>
        render(
          <InvoiceDeliveryEmail
            {...invoiceDeliveryPreviewProps}
            recipient={{ audience: "customer", locale }}
          />
        )
      )
    );

    expect(czech).toContain('lang="cs-CZ"');
    expect(english).toContain('lang="en-US"');
    expect(czech).not.toBe(english);
  });

  test("writes the staff copy in the staff locale", async () => {
    const html = await render(
      <InvoiceDeliveryEmail
        {...invoiceDeliveryPreviewProps}
        recipient={{ audience: "internal" }}
      />
    );

    expect(html).toContain(`lang="${staffEmailLocale}"`);
    expect(html).toContain(invoiceDeliveryPreviewProps.invoiceNumber);
  });

  test("asks a manual invoice's customer for payment only when it is due", async () => {
    const [requested, settled] = await Promise.all([
      render(<InvoiceDeliveryEmail {...manualInvoice(true)} />, {
        plainText: true,
      }),
      render(<InvoiceDeliveryEmail {...manualInvoice(false)} />, {
        plainText: true,
      }),
    ]);

    expect(requested).not.toBe(settled);
  });

  test("names the order of a reservation invoice", async () => {
    const html = await render(
      <InvoiceDeliveryEmail {...invoiceDeliveryPreviewProps} />
    );

    expect(html).toContain(invoiceDeliveryPreviewProps.invoice.orderId);
  });
});
