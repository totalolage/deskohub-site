/**
 * Standalone Email Service Layer
 *
 * Complete email service that uses Resend in production (if configured)
 * or console provider for development.
 * Use this when you need to send emails directly without domain events.
 */

import { Layer } from "effect";
import { env } from "@/env";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";
import { ConsoleEmailProviderLive } from "./providers/console-provider";
import { ResendEmailProviderLive } from "./providers/resend-provider";
import { EmailServiceLive } from "./service";
import { EmailTemplateServiceLive } from "./template-service";

/**
 * Standalone Email Service Layer
 * Uses Resend if API key is configured, otherwise falls back to console
 */
export const StandaloneEmailServiceLive = EmailServiceLive.pipe(
  Layer.provide(EmailTemplateServiceLive),
  Layer.provide(
    env.RESEND_API_KEY 
      ? ResendEmailProviderLive 
      : ConsoleEmailProviderLive
  ),
  Layer.provide(EmailConfigLayer)
);
