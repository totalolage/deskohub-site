/**
 * Email Template Service
 *
 * Renders email templates with data
 */

import { Effect, Layer } from "effect";
import type { EmailTemplateData } from "../types/email.types";
import { EmailTemplateServiceTag } from "./service";

/**
 * Email Template Service Implementation
 * TODO: Implement actual template rendering
 */
export const EmailTemplateServiceLive = Layer.succeed(EmailTemplateServiceTag, {
  render: (template: EmailTemplateData) =>
    Effect.gen(function* () {
      yield* Effect.logDebug("Rendering email template", {
        type: template.type,
      });

      // Placeholder implementation - replace with actual template rendering
      const result = {
        subject: `[${template.type}] Notification`,
        html: `<p>Template: ${template.type}</p><pre>${JSON.stringify(template.data, null, 2)}</pre>`,
        text: `Template: ${template.type}\n\n${JSON.stringify(template.data, null, 2)}`,
      };

      yield* Effect.logDebug("Template rendered successfully", {
        type: template.type,
        subjectLength: result.subject.length,
        htmlLength: result.html.length,
        textLength: result.text.length,
      });

      return result;
    }).pipe(Effect.withSpan("emailTemplateService.render")),
});
