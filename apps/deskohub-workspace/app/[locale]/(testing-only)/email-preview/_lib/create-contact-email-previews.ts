import "server-only";

import {
  EmailDeliveryIdSchema,
  type EmailMessage,
  type EmailProviderConfig,
  type EmailSendResult,
} from "@deskohub/email";
import type { EmailService } from "@deskohub/email/backend/service";
import {
  EmailConfigTag,
  EmailServiceTag,
} from "@deskohub/email/backend/service";
import { Effect, Layer } from "effect";
import { ContactService } from "@/features/contact/backend/contact.service";
import type { Locale } from "@/features/i18n";

const previewSubmission = {
  name: "Ada Lovelace",
  email: "customer@example.com",
  phone: "+420 123 456 789",
  message:
    "Hello,\n\nI'd like to confirm that the Profi pass includes both monitors and coffee. Thank you!",
} as const;

const emailConfig: EmailProviderConfig = {
  provider: "console",
  defaultFrom: {
    email: "reservations@workspace.deskohub.cz",
    name: "Deskohub Workspace",
  },
};

export const createContactEmailPreviews = (locale: Locale) => {
  const sentMessages: EmailMessage[] = [];
  const emailService: EmailService = {
    send: (message) =>
      Effect.sync(() => {
        sentMessages.push(message);

        return {
          id: EmailDeliveryIdSchema.make(`preview-${sentMessages.length}`),
          status: "sent",
          provider: "preview",
          timestamp: new Date(),
        } satisfies EmailSendResult;
      }),
    sendTemplate: () => Effect.die("Contact preview does not use templates."),
    verify: Effect.succeed(true),
  };

  const PreviewContactService = ContactService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(EmailServiceTag, emailService),
        Layer.succeed(EmailConfigTag, emailConfig)
      )
    )
  );

  return Effect.gen(function* () {
    const contactService = yield* ContactService;
    yield* contactService.submit(previewSubmission, locale);

    const business = sentMessages.find((message) =>
      message.tags?.includes("workspace-contact-form")
    );
    const confirmation = sentMessages.find((message) =>
      message.tags?.includes("workspace-contact-confirmation")
    );

    if (!(business?.html && confirmation?.html)) {
      return yield* Effect.die(
        "Contact preview did not capture both rendered emails."
      );
    }

    return {
      business: business.html,
      confirmation: confirmation.html,
    } as const;
  }).pipe(Effect.provide(PreviewContactService));
};
