/**
 * Standalone Email Service Layer
 *
 * Complete email service that automatically selects the appropriate provider.
 * Use this when you need to send emails directly without domain events.
 */

import { Layer } from "effect";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";
import { EmailProviderLive } from "./provider-factory";
import { EmailServiceLive } from "./service";
import { EmailTemplateServiceLive } from "./template-service";

/**
 * Standalone Email Service Layer
 * Properly composes layers with their dependencies
 *
 * Automatically selects the appropriate email provider based on configuration:
 * - Uses Resend if RESEND_API_KEY is set
 * - Falls back to Console provider otherwise
 */
export const StandaloneEmailServiceLive = EmailServiceLive.pipe(
  Layer.provide(EmailTemplateServiceLive),
  Layer.provide(EmailProviderLive),
  Layer.provide(EmailConfigLayer)
);
