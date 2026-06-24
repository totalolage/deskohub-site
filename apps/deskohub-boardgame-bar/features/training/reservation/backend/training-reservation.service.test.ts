import { describe, expect, mock, test } from "bun:test";
import {
  type EmailSendResult,
  EmailServiceError,
  EmailServiceTag,
} from "@deskohub/email";
import { Effect, Layer } from "effect";
import {
  TrainingReservationService,
  TrainingReservationServiceLive,
} from "./training-reservation.service";

const input = {
  firstName: "Ada",
  lastName: "Lovelace",
  company: "Analytical Engines",
  role: "Engineer",
  email: "ada@example.test",
  phone: "+420777777777",
  date: new Date("2026-06-20T12:00:00.000Z"),
  time: "18:00",
  duration: 2,
  specialRequirements: "Projector",
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
      const service = yield* TrainingReservationService;
      return yield* service.submit(input, "en-US");
    }).pipe(
      Effect.provide(TrainingReservationServiceLive),
      Effect.provide(
        Layer.succeed(EmailServiceTag, {
          send,
          sendTemplate: mock(() => Effect.succeed(sent("template"))),
          verify: mock(() => Effect.succeed(true)),
        })
      )
    )
  );

describe("TrainingReservationService", () => {
  test("first send failure rejects with send failure message", async () => {
    const send = mock(() => Effect.fail(new EmailServiceError("nope")));

    await expect(runSubmit(send)).rejects.toThrow(
      "Failed to send reservation. Please try again later."
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("confirmation send failure does not fail reservation", async () => {
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
