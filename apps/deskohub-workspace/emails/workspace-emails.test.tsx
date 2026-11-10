import { describe, expect, test } from "bun:test";
import { render } from "react-email";
import type { Locale } from "@/features/i18n";
import { staffLocale } from "@/shared/backend/staff-locale";
import {
  contactBusinessPreviewProps,
  contactConfirmationPreviewProps,
  customerReservationPreviewProps,
  invoiceDeliveryPreviewProps,
  reservationAuthorPreviewProps,
  reservationCancellationPreviewProps,
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
import { ReservationCancellationEmail } from "./reservation-cancellation";
import { ReservationNotificationEmail } from "./reservation-notification";
import { WorkspaceCampaignEmail } from "./workspace-campaign";

describe("Workspace React Email templates", () => {
  test("renders every template preview", async () => {
    const [
      business,
      confirmation,
      customerReservation,
      staffNotification,
      cancellation,
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
      render(
        <ReservationCancellationEmail
          {...reservationCancellationPreviewProps}
        />
      ),
      render(<InvoiceDeliveryEmail {...invoiceDeliveryPreviewProps} />),
      render(<WorkspaceCampaignEmail {...workspaceCampaignPreviewProps} />),
    ]);

    expect(business).toContain(contactBusinessPreviewProps.name);
    expect(confirmation).toContain('lang="en-US"');
    expect(customerReservation).toContain(
      `href="${customerReservationPreviewProps.accessUrl}"`
    );
    expect(staffNotification).toContain(
      reservationNotificationPreviewProps.customer.email
    );
    expect(cancellation).toContain(
      reservationCancellationPreviewProps.reservation.id
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

    expect(html).toContain(`href="${reservationAuthorPreviewProps.statusUrl}"`);
    expect(html).toContain(
      reservationAuthorPreviewProps.reservation.placement.table.name
    );
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

    expect(html).toContain(`lang="${staffLocale}"`);
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

    expect(html).toContain(`lang="${staffLocale}"`);
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

describe("reservation emails", () => {
  test("write the customer confirmation in the customer's locale", async () => {
    const [czech, english] = await Promise.all(
      czechThenEnglish.map((locale) =>
        render(
          <CustomerReservationEmail
            {...customerReservationPreviewProps}
            locale={locale}
          />
        )
      )
    );

    expect(czech).toContain('lang="cs-CZ"');
    expect(english).toContain('lang="en-US"');
    expect(czech).not.toBe(english);
  });

  test("link the customer confirmation to its access page and invoice", async () => {
    const html = await render(
      <CustomerReservationEmail {...customerReservationPreviewProps} />
    );

    expect(html).toContain(
      `href="${customerReservationPreviewProps.accessUrl}"`
    );
    expect(html).toContain(
      `href="${customerReservationPreviewProps.invoiceUrl}"`
    );
  });

  test("show the Wi-Fi and its QR code only when the customer gets them", async () => {
    const { network, ...withoutNetwork } = customerReservationPreviewProps;
    const [withNetwork, withoutNetworkHtml] = await Promise.all([
      render(<CustomerReservationEmail {...customerReservationPreviewProps} />),
      render(<CustomerReservationEmail {...withoutNetwork} />),
    ]);

    const qrImageSrc = network.qrImageSrc.replaceAll("&", "&amp;");

    expect(withNetwork).toContain(network.password);
    expect(withNetwork).toContain(`src="${qrImageSrc}"`);
    expect(withoutNetworkHtml).not.toContain(network.password);
    expect(withoutNetworkHtml).not.toContain(qrImageSrc);
  });

  test("show the table only when the reservation has one", async () => {
    const { reservation } = customerReservationPreviewProps;
    const [assigned, unplaced] = await Promise.all([
      render(
        <CustomerReservationEmail {...customerReservationPreviewProps} />,
        {
          plainText: true,
        }
      ),
      render(
        <CustomerReservationEmail
          {...customerReservationPreviewProps}
          reservation={{ ...reservation, placement: {} }}
        />,
        { plainText: true }
      ),
    ]);

    expect(assigned).not.toBe(unplaced);
    expect(assigned).toContain(reservation.placement.table.name);
  });

  test("write the author confirmation in the author's locale", async () => {
    const [czech, english] = await Promise.all(
      czechThenEnglish.map((locale) =>
        render(
          <ReservationAuthorEmail
            {...reservationAuthorPreviewProps}
            locale={locale}
          />
        )
      )
    );

    expect(czech).toContain('lang="cs-CZ"');
    expect(english).toContain('lang="en-US"');
    expect(czech).not.toBe(english);
  });

  test("write the staff notification in the staff locale", async () => {
    const html = await render(
      <ReservationNotificationEmail {...reservationNotificationPreviewProps} />
    );

    expect(html).toContain(`lang="${staffLocale}"`);
    expect(html).toContain(reservationNotificationPreviewProps.reservation.id);
  });

  test("list the customer's phone only when they gave one", async () => {
    const { customer } = reservationNotificationPreviewProps;
    const [withPhone, withoutPhone] = await Promise.all([
      render(
        <ReservationNotificationEmail
          {...reservationNotificationPreviewProps}
        />,
        { plainText: true }
      ),
      render(
        <ReservationNotificationEmail
          {...reservationNotificationPreviewProps}
          customer={{ ...customer, phone: " " }}
        />,
        { plainText: true }
      ),
    ]);

    expect(withPhone).toContain(customer.phone);
    expect(withoutPhone).not.toContain(customer.phone);
  });

  test("write the cancellation in the customer's locale", async () => {
    const [czech, english] = await Promise.all(
      czechThenEnglish.map((locale) =>
        render(
          <ReservationCancellationEmail
            {...reservationCancellationPreviewProps}
            locale={locale}
          />
        )
      )
    );

    expect(czech).toContain('lang="cs-CZ"');
    expect(english).toContain('lang="en-US"');
    expect(czech).not.toBe(english);
  });
});
