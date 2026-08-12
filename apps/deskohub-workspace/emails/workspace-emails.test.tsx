import { describe, expect, test } from "bun:test";
import { render } from "react-email";
import {
  contactBusinessPreviewProps,
  contactConfirmationPreviewProps,
  customerReservationPreviewProps,
  invoiceDeliveryPreviewProps,
  reservationNotificationPreviewProps,
} from "./_fixtures/preview-props";
import { ContactBusinessEmail } from "./contact-business";
import { ContactConfirmationEmail } from "./contact-confirmation";
import { CustomerReservationEmail } from "./customer-reservation";
import { InvoiceDeliveryEmail } from "./invoice-delivery";
import { ReservationNotificationEmail } from "./reservation-notification";

describe("Workspace React Email templates", () => {
  test("renders every preview with the shared design and channel-specific data boundaries", async () => {
    const [
      business,
      confirmation,
      customerReservation,
      staffNotification,
      invoiceDelivery,
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
    ]);

    for (const email of [
      business,
      confirmation,
      customerReservation,
      staffNotification,
      invoiceDelivery,
    ]) {
      expect(email).toContain("Deskohub");
      expect(email).toContain("Turnovská 430/10");
      expect(email).toContain("font-size:26px");
      expect(email).toContain("line-height:34px");
    }

    expect(business).toContain(contactBusinessPreviewProps.heading);
    expect(confirmation).toContain(contactConfirmationPreviewProps.heading);
    expect(customerReservation).toContain("Open reservation and show PIN");
    expect(customerReservation).toContain("statusToken=preview-token");
    expect(customerReservation).not.toContain("4829");
    expect(customerReservation).toContain('bgcolor="#00024f"');
    expect(customerReservation).toContain("background-color:#00024f");
    expect(customerReservation).toContain(
      'content="width=device-width, initial-scale=1.0" name="viewport"'
    );
    expect(customerReservation).toContain(
      "padding-right:8px;padding-left:8px;padding-bottom:16px;padding-top:16px"
    );
    expect(customerReservation).not.toContain("Where to sit");
    expect(customerReservation).not.toContain("customer@example.com");
    expect(staffNotification).toContain("customer@example.com");
    expect(staffNotification).not.toContain("4829");
    expect(invoiceDelivery).toContain(invoiceDeliveryPreviewProps.body);
  });
});
