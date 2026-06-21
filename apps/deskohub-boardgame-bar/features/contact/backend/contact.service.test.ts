import { describe, expect, mock, test } from "bun:test";
import {
  type EmailSendResult,
  EmailServiceError,
  EmailServiceTag,
} from "@deskohub/email";
import { Effect, Layer } from "effect";
import { ContactService, ContactServiceLive } from "./contact.service";

const input = {
  name: "Ada Lovelace",
  email: "ada@example.test",
  phone: "+420777777777",
  message: "Hello",
};

const sent = (id: string): EmailSendResult => ({
  id,
  status: "sent",
  provider: "fake",
  timestamp: new Date("2026-06-20T12:00:00.000Z"),
});

const runSubmit = (send: ReturnType<typeof mock>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* ContactService;
      return yield* service.submit(input, "en-US");
    }).pipe(
      Effect.provide(ContactServiceLive),
      Effect.provide(
        Layer.succeed(EmailServiceTag, {
          send,
          sendTemplate: mock(() => Effect.succeed(sent("template"))),
          verify: mock(() => Effect.succeed(true)),
        })
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
});
