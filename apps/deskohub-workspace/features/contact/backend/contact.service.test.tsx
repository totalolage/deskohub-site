import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import {
  type EmailConfig,
  EmailDeliveryIdSchema,
  type EmailMessage,
  type EmailSendResult,
} from "@deskohub/email";
import type { EmailService } from "@deskohub/email/backend/service";
import {
  EmailConfigTag,
  EmailServiceTag,
} from "@deskohub/email/backend/service";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import { m } from "@/features/i18n";
import { workspaceDefaultFromAddress } from "@/shared/backend/config/email.config";
import { ContactService } from "./contact.service";

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
      sendBatch: () => Effect.die("Contact tests do not send batches."),
    };
    const emailConfig: EmailConfig = {
      defaultFrom: {
        email: workspaceDefaultFromAddress,
        name: "Deskohub Workspace",
      },
    };

    const ContactServiceTest = ContactService.Default.pipe(
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
          email: testEmailAddress("ada"),
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

    expect(businessEmail.to).toEqual({
      email: testEmailAddress("workspace-internal"),
      name: "Deskohub Workspace",
    });
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

    expect(confirmationEmail.subject).toBe(
      m.contactEmailConfirmationSubject({}, { locale: "en-US" })
    );
    expect(confirmationEmail.html).toContain(
      m.contactEmailCustomerHeading({}, { locale: "en-US" })
    );
  });
});
