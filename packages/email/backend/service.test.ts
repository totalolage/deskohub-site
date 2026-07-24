import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Logger, References } from "effect";
import type { EmailMessage, EmailProviderConfig } from "../types/email.types";
import { NetworkError } from "./network-error";
import {
  EmailConfigTag,
  type EmailProvider,
  EmailProviderTag,
  EmailServiceError,
  EmailServiceLive,
  EmailServiceTag,
  type EmailTemplateService,
  EmailTemplateServiceTag,
} from "./service";

const config: EmailProviderConfig = {
  provider: "console",
  defaultFrom: { email: "deskohub@example.test", name: "Deskohub" },
};

const success = {
  id: "email-id",
  status: "sent" as const,
  provider: "fake",
  timestamp: new Date("2026-06-20T10:00:00Z"),
};

const makeProvider = (
  send: EmailProvider["send"] = mock((_message: EmailMessage) =>
    Effect.succeed(success)
  )
): EmailProvider => ({
  name: "fake",
  send,
  verify: Effect.succeed(true),
});

const templateService: EmailTemplateService = {
  render: mock(() =>
    Effect.succeed({
      subject: "Rendered subject",
      html: "<p>Rendered</p>",
      text: "Rendered",
    })
  ),
};

const makeEmailLayer = (
  provider: EmailProvider,
  template: EmailTemplateService = templateService
) =>
  EmailServiceLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(EmailProviderTag, provider),
        Layer.succeed(EmailTemplateServiceTag, template),
        Layer.succeed(EmailConfigTag, config)
      )
    )
  );

const runWithEmail = <A, E>(
  effect: Effect.Effect<A, E, EmailServiceTag>,
  provider: EmailProvider,
  template: EmailTemplateService = templateService
) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(makeEmailLayer(provider, template)))
  );

const makeCapturingLogger = (records: unknown[]) =>
  Logger.make((options) => {
    records.push({
      annotations: options.fiber.getRef(References.CurrentLogAnnotations),
      message: options.message,
    });
  });

const message: EmailMessage = {
  from: undefined as never,
  to: { email: "ada@example.test" },
  subject: "Hello",
  html: "<p>Hello</p>",
};

describe("EmailService", () => {
  test("uses defaultFrom when message has no from", async () => {
    const send = mock((_message: EmailMessage) => Effect.succeed(success));
    const provider = makeProvider(send);

    await runWithEmail(
      Effect.gen(function* () {
        const email = yield* EmailServiceTag;
        return yield* email.send(message);
      }),
      provider
    );

    expect(send.mock.calls[0]?.[0]).toMatchObject({ from: config.defaultFrom });
  });

  test("retries NetworkError and not EmailServiceError", async () => {
    let attempts = 0;
    const retrySend = mock((_message: EmailMessage) =>
      Effect.suspend(() => {
        attempts += 1;
        return attempts === 1
          ? Effect.fail(
              new NetworkError({
                message: "offline",
                cause: new Error("offline"),
              })
            )
          : Effect.succeed(success);
      })
    );

    await runWithEmail(
      Effect.gen(function* () {
        const email = yield* EmailServiceTag;
        return yield* email.send(message);
      }),
      makeProvider(retrySend)
    );
    expect(attempts).toBe(2);

    const serviceErrorSend = mock((_message: EmailMessage) =>
      Effect.fail(new EmailServiceError("bad request"))
    );
    const result = await runWithEmail(
      Effect.gen(function* () {
        const email = yield* EmailServiceTag;
        return yield* email.send(message).pipe(Effect.result);
      }),
      makeProvider(serviceErrorSend)
    );

    expect(result._tag).toBe("Failure");
    expect(serviceErrorSend).toHaveBeenCalledTimes(1);
  });

  test("does not log dynamic contact or reservation subjects on provider failure", async () => {
    const contactSubject = "SyntheticContactSubject42";
    const reservationSubject = "SyntheticReservationSubject42";
    const providerMessage = "SyntheticProviderMessage42";
    const records: unknown[] = [];
    const provider = makeProvider(
      mock((_message: EmailMessage) =>
        Effect.fail(new EmailServiceError(providerMessage))
      )
    );
    const render = mock(() =>
      Effect.succeed({
        subject: reservationSubject,
        html: "<p>Rendered</p>",
        text: "Rendered",
      })
    );
    const effects = Effect.gen(function* () {
      const email = yield* EmailServiceTag;
      const contactResult = yield* email
        .send({ ...message, subject: contactSubject })
        .pipe(Effect.result);
      const reservationResult = yield* email
        .sendTemplate("synthetic@example.test", {
          type: "reservation-confirmation",
          data: {
            customerName: "Synthetic Customer",
            reservationId: "synthetic-reservation",
            datetime: new Date("2026-06-20T10:00:00Z"),
            duration: 120,
            guestCount: 2,
          },
        })
        .pipe(Effect.result);
      return { contactResult, reservationResult };
    });

    const results = await Effect.runPromise(
      effects.pipe(
        Effect.provide(makeEmailLayer(provider, { render })),
        Effect.provide(Logger.layer([makeCapturingLogger(records)]))
      )
    );

    expect(results.contactResult._tag).toBe("Failure");
    expect(results.reservationResult._tag).toBe("Failure");
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain(contactSubject);
    expect(serialized).not.toContain(reservationSubject);
    expect(serialized).not.toContain(providerMessage);
  });

  test("sendTemplate sends rendered body, tags, and metadata", async () => {
    const send = mock((_message: EmailMessage) => Effect.succeed(success));
    const render = mock(() =>
      Effect.succeed({
        subject: "Reservation confirmed",
        html: "<p>Confirmed</p>",
        text: "Confirmed",
      })
    );

    await runWithEmail(
      Effect.gen(function* () {
        const email = yield* EmailServiceTag;
        return yield* email.sendTemplate("ada@example.test", {
          type: "reservation-confirmation",
          data: {
            customerName: "Ada",
            reservationId: "reservation-id",
            datetime: new Date("2026-06-20T10:00:00Z"),
            duration: 120,
            guestCount: 2,
          },
        });
      }),
      makeProvider(send),
      { render }
    );

    expect(send.mock.calls[0]?.[0]).toEqual({
      from: config.defaultFrom,
      to: { email: "ada@example.test" },
      subject: "Reservation confirmed",
      html: "<p>Confirmed</p>",
      text: "Confirmed",
      tags: ["reservation-confirmation"],
      metadata: { templateType: "reservation-confirmation" },
    });
  });
});
