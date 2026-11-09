import { describe, expect, mock, test } from "bun:test";
import {
  EmailDeliveryIdSchema,
  type EmailMessage,
  type EmailSendResult,
  EmailServiceError,
  EmailServiceTag,
} from "@deskohub/email";
import { Effect, Layer } from "effect";
import { m } from "@/features/i18n/paraglide/messages";
import { ContactService } from "./contact.service";

const input = {
  name: "Ada Lovelace",
  email: "ada@example.test",
  phone: "+420777777777",
  message: "Hello",
};

const sent = (id: string): EmailSendResult => ({
  id: EmailDeliveryIdSchema.make(id),
  status: "sent",
  provider: "fake",
  timestamp: new Date("2026-06-20T12:00:00.000Z"),
});

const runSubmit = (
  send: ReturnType<typeof mock>,
  locale: "en-US" | "cs-CZ" = "en-US"
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* ContactService;
      return yield* service.submit(input, locale);
    }).pipe(
      Effect.provide(
        ContactService.Default.pipe(
          Layer.provide(
            Layer.succeed(EmailServiceTag, {
              send,
              sendBatch: () =>
                Effect.die("Contact submissions do not send batches."),
            })
          )
        )
      )
    )
  );

describe("ContactService", () => {
  test("first send failure rejects with send failure message", async () => {
    const send = mock(() => Effect.fail(new EmailServiceError("nope")));

    await expect(runSubmit(send)).rejects.toThrow(
      "Failed to send message. Please try again later."
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("confirmation send failure does not fail submission", async () => {
    let calls = 0;
    const send = mock(() =>
      calls++ === 0
        ? Effect.succeed(sent("business"))
        : Effect.fail(new EmailServiceError("confirmation failed"))
    );

    const result = await runSubmit(send);

    expect(result).toMatchObject({ ...input, locale: "en-US" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  test("customer confirmation follows the typed locale; business email stays Czech", async () => {
    const messages: EmailMessage[] = [];
    const send = mock((message: EmailMessage) => {
      messages.push(message);
      return Effect.succeed(sent(`msg-${messages.length}`));
    });

    const result = await runSubmit(send, "en-US");

    expect(result.locale).toBe("en-US");
    expect(messages.map((message) => message.subject)).toEqual([
      m["contact.email.businessSubject"](
        { name: input.name },
        { locale: "cs-CZ" }
      ),
      m["contact.email.confirmationSubject"](undefined, { locale: "en-US" }),
    ]);
  });
});
