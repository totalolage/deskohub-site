import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";

mock.module("server-only", () => ({}));

const submittedValues = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420 777 777 777",
  message: "I would like to learn more about Deskohub.",
};

const runContactSubmission = async (options?: {
  readonly verifyHuman?: ReturnType<typeof mock>;
  readonly submit?: ReturnType<typeof mock>;
}) => {
  const { ContactService } = await import(
    "@/features/contact/backend/contact.service"
  );
  const { processContactSubmission } = await import("./contact");
  const { BotProtectionServiceMock } = await import(
    "@/shared/backend/bot-protection/bot-protection.service.mock"
  );

  const verifyHuman = options?.verifyHuman ?? mock(() => Effect.void);
  const submit =
    options?.submit ??
    mock(() =>
      Effect.succeed({
        ...submittedValues,
        submittedAt: "2026-07-15T12:00:00.000Z",
        locale: "en-US" as const,
      })
    );
  const effect = processContactSubmission({
    locale: "en-US",
    submittedValues,
  }).pipe(
    Effect.provide(BotProtectionServiceMock({ verifyHuman })),
    Effect.provide(Layer.succeed(ContactService, { submit }))
  );

  return { effect, verifyHuman, submit };
};

describe("processContactSubmission", () => {
  test("verifies with the deny policy before submitting contact email", async () => {
    const eventOrder: string[] = [];
    const verifyHuman = mock(() =>
      Effect.sync(() => {
        eventOrder.push("bot-verification");
      })
    );
    const submit = mock(() =>
      Effect.sync(() => {
        eventOrder.push("contact-submit");
        return {
          ...submittedValues,
          submittedAt: "2026-07-15T12:00:00.000Z",
          locale: "en-US" as const,
        };
      })
    );
    const scenario = await runContactSubmission({ verifyHuman, submit });

    await expect(Effect.runPromise(scenario.effect)).resolves.toMatchObject({
      status: "success",
    });
    expect(verifyHuman).toHaveBeenCalledWith({
      verificationFailurePolicy: "deny",
    });
    expect(eventOrder).toEqual(["bot-verification", "contact-submit"]);
  });

  test("rejects a classified bot before submitting contact email", async () => {
    const { BotDetectedError } = await import(
      "@/shared/backend/bot-protection/bot-protection.service"
    );
    const { m } = await import("@/features/i18n");
    const verifyHuman = mock(() =>
      Effect.fail(
        new BotDetectedError({ message: "Automated request detected" })
      )
    );
    const scenario = await runContactSubmission({ verifyHuman });

    const result = await Effect.runPromise(scenario.effect);

    expect(result).toMatchObject({
      status: "error",
      message: m.contactRateLimitMessage({}, { locale: "en-US" }),
      values: submittedValues,
    });
    expect(scenario.submit).not.toHaveBeenCalled();
  });

  test("fails closed with the generic error when verification is unavailable", async () => {
    const { BotVerificationError } = await import(
      "@/shared/backend/bot-protection/bot-protection.service"
    );
    const { m } = await import("@/features/i18n");
    const verificationCause = new Error("BotID unavailable");
    const verifyHuman = mock(() =>
      Effect.fail(new BotVerificationError({ cause: verificationCause }))
    );
    const scenario = await runContactSubmission({ verifyHuman });

    const result = await Effect.runPromise(scenario.effect);

    expect(result).toMatchObject({
      status: "error",
      message: m.contactEmailSendError({}, { locale: "en-US" }),
      values: submittedValues,
    });
    expect(scenario.submit).not.toHaveBeenCalled();
  });
});
