import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

const webhookTokenPurpose = "deskohub-bar:opening-hours-calendar-webhook";

export const deriveOpeningHoursCalendarWebhookToken = (secret: string) =>
  createHmac("sha256", secret).update(webhookTokenPurpose).digest("hex");

export const verifyOpeningHoursCalendarWebhookToken = (
  token: string,
  secret: string
) => {
  const provided = Buffer.from(token);
  const expected = Buffer.from(deriveOpeningHoursCalendarWebhookToken(secret));

  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
};
