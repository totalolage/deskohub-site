import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
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
import { m } from "@/features/i18n";
import { ContactService, ContactServiceLive } from "./contact.service";

const sentResult = (id: string): EmailSendResult => ({
  id: EmailDeliveryIdSchema.make(id),
  status: "sent",
  provider: "test",
  timestamp: new Date(),
});

describe("ContactService", () => {
  test("always sends the business notification in Czech", async () => {
    const sentMessages: EmailMessage[] = [];
    const send = mock((message: EmailMessage) => {
      sentMessages.push(message);

      return Effect.succeed(sentResult(`email-${sentMessages.length}`));
    });
    const emailService: EmailService = {
      send,
      sendTemplate: mock(() => Effect.die("sendTemplate is not used")),
      verify: Effect.succeed(true),
    };
    const emailConfig: EmailProviderConfig = {
      provider: "console",
      defaultFrom: {
        email: "reservations@workspace.deskohub.cz",
        name: "Deskohub Workspace",
      },
    };

    const ContactServiceTest = ContactServiceLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(EmailServiceTag, emailService),
          Layer.succeed(EmailConfigTag, emailConfig)
        )
      )
    );

    await Effect.gen(function* () {
      const service = yield* ContactService;
      return yield* service.submit(
        {
          name: "Ada Lovelace",
          email: "ada@example.com",
          phone: "+420 123 456 789",
          message: "Please help with a workspace reservation.",
        },
        "en-US"
      );
    }).pipe(Effect.provide(ContactServiceTest), Effect.runPromise);

    expect(send).toHaveBeenCalledTimes(2);

    const businessEmail = sentMessages[0];
    const confirmationEmail = sentMessages[1];
    if (!businessEmail || !confirmationEmail) {
      throw new Error("Contact emails were not sent.");
    }

    expect(businessEmail.subject).toBe(
      `[TESTING] ${m.contactEmailBusinessSubject(
        { name: "Ada Lovelace" },
        { locale: "cs-CZ" }
      )}`
    );
    expect(businessEmail.html).toContain(
      m.contactEmailBusinessHeading({}, { locale: "cs-CZ" })
    );
    expect(businessEmail.text).toContain(
      m.contactEmailMessageHeading({}, { locale: "cs-CZ" }).toUpperCase()
    );
    expect(businessEmail.text).toContain(
      m.contactEmailNameLabel({}, { locale: "cs-CZ" })
    );
    expect(businessEmail.text).toContain("Ada Lovelace");
    expect(businessEmail.text).toContain(
      m.contactEmailPhoneLabel({}, { locale: "cs-CZ" })
    );
    expect(businessEmail.text).toContain("+420 123 456 789");
    expect(businessEmail.text).toContain(
      m.contactEmailSubmittedAtLabel({}, { locale: "cs-CZ" })
    );
    expect(businessEmail.html).not.toContain(
      m.contactEmailBusinessHeading({}, { locale: "en-US" })
    );
    expect(businessEmail.text).not.toContain(
      m.contactEmailMessageHeading({}, { locale: "en-US" })
    );
    expect(businessEmail.html).toContain("Deskohub");
    expect(businessEmail.html).toContain(
      'content="width=device-width, initial-scale=1.0" name="viewport"'
    );

    expect(confirmationEmail.subject).toBe(
      m.contactEmailConfirmationSubject({}, { locale: "en-US" })
    );
    expect(confirmationEmail.html).toContain(
      m.contactEmailCustomerHeading({}, { locale: "en-US" })
    );
  });
});
