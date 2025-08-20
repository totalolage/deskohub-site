/**
 * Standalone Email Service Layer
 *
 * Complete email service with console provider for development.
 * Use this when you need to send emails directly without domain events.
 */

import { Layer } from "effect";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";
import { ConsoleEmailProviderLive } from "./providers/console-provider";
import { EmailServiceLive } from "./service";
import { EmailTemplateServiceLive } from "./template-service";

/**
 * Standalone Email Service Layer
 * Properly composes layers with their dependencies
 */
export const StandaloneEmailServiceLive = EmailServiceLive.pipe(
  Layer.provide(EmailTemplateServiceLive),
  Layer.provide(ConsoleEmailProviderLive),
  Layer.provide(EmailConfigLayer)
);
