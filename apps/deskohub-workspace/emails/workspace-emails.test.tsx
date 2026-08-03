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
    expect(customerReservation).not.toContain("customer@example.com");
    expect(staffNotification).toContain("customer@example.com");
    expect(staffNotification).not.toContain(
      customerReservationPreviewProps.accessCode
    );
  });
});
