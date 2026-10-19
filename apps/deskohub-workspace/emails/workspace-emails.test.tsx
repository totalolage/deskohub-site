import { describe, expect, test } from "bun:test";
import { render } from "react-email";
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
import { InvoiceDeliveryEmail } from "./invoice-delivery";
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

    expect(business).toContain(contactBusinessPreviewProps.heading);
    expect(confirmation).toContain(contactConfirmationPreviewProps.heading);
    expect(customerReservation).toContain(
      customerReservationPreviewProps.heading
    );
    expect(customerReservation).toContain(
      `href="${customerReservationPreviewProps.access.url}"`
    );
    expect(staffNotification).toContain(
      reservationNotificationPreviewProps.heading
    );
    expect(invoiceDelivery).toContain(invoiceDeliveryPreviewProps.heading);
    expect(campaign).toContain("Podzim ve Workspace");
    expect(campaign).toContain(
      `href="${workspaceCampaignPreviewProps.footer.link.href}"`
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
