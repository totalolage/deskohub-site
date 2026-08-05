import { describe, expect, test } from "bun:test";
import { render } from "react-email";
import {
  contactBusinessPreviewProps,
  contactConfirmationPreviewProps,
  customerReservationPreviewProps,
  reservationNotificationPreviewProps,
} from "./_fixtures/preview-props";
import { ContactBusinessEmail } from "./contact-business";
import { ContactConfirmationEmail } from "./contact-confirmation";
import { CustomerReservationEmail } from "./customer-reservation";
import { ReservationNotificationEmail } from "./reservation-notification";

describe("Workspace React Email templates", () => {
  test("renders all four previews with their channel-specific data boundaries", async () => {
    const [business, confirmation, customerReservation, staffNotification] =
      await Promise.all([
        render(<ContactBusinessEmail {...contactBusinessPreviewProps} />),
        render(
          <ContactConfirmationEmail {...contactConfirmationPreviewProps} />
        ),
        render(
          <CustomerReservationEmail {...customerReservationPreviewProps} />
        ),
        render(
          <ReservationNotificationEmail
            {...reservationNotificationPreviewProps}
          />
        ),
      ]);

    expect(business).toContain(contactBusinessPreviewProps.heading);
    expect(confirmation).toContain(contactConfirmationPreviewProps.heading);
    expect(customerReservation).toContain(
      customerReservationPreviewProps.accessCode
    );
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
    expect(staffNotification).not.toContain(
      customerReservationPreviewProps.accessCode
    );
  });
});
