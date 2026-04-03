import { createStandaloneEmailServiceLayer } from "@deskohub/email/backend/standalone-email-service";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";

export const StandaloneEmailServiceLive =
  createStandaloneEmailServiceLayer(EmailConfigLayer);
