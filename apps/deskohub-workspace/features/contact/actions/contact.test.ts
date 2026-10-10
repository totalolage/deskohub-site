import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import {
  type ContactFormValues,
  getContactSchema,
} from "@/features/contact/schemas/contact";
import { type Locale, m } from "@/features/i18n";

mock.module("server-only", () => ({}));

const data: ContactFormValues = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420 777 777 777",
  message: "Please contact me about a workspace reservation.",
};

const execute = async (
  values = data,
  locale: Locale = "en-US",
  verify = mock(() => Effect.void),
  submit = mock(() =>
    Effect.succeed({
      ...values,
      submittedAt: "2026-07-15T12:00:00.000Z",
      locale,
    })
  )
) => {
  const { ContactService } = await import(
    "@/features/contact/backend/contact.service"
  );
  const { processContactSubmission } = await import("./contact");
  const { BotProtectionServiceMock } = await import(
    "@/shared/backend/bot-protection/bot-protection.service.mock"
  );
  const effect = processContactSubmission({
    locale,
    submittedValues: values,
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        BotProtectionServiceMock({ verifyHuman: verify }),
        Layer.succeed(ContactService, { submit })
      )
    )
  );
  return { effect, submit, verify };
};

describe("processContactSubmission", () => {
  test("verifies before sending trimmed values", async () => {
    const order: string[] = [];
    const verify = mock(() => Effect.sync(() => order.push("bot")));
    const submit = mock(() =>
      Effect.sync(() => {
        order.push("submit");
        return {
          ...data,
          submittedAt: "2026-07-15T12:00:00.000Z",
          locale: "en-US" as const,
        };
      })
    );
    const values = {
      ...data,
      name: " Ada Lovelace ",
      email: " ada@example.com ",
      phone: ` ${data.phone} `,
      message: ` ${data.message} `,
    };
    const result = await execute(values, "en-US", verify, submit);
    await expect(Effect.runPromise(result.effect)).resolves.toMatchObject({
      status: "success",
    });
    expect(verify).toHaveBeenCalledWith({ verificationFailurePolicy: "deny" });
    expect(order).toEqual(["bot", "submit"]);
    expect(submit).toHaveBeenCalledWith(
      { ...data, name: "Ada Lovelace" },
      "en-US"
    );
  });

  test("returns localized field errors and retains entered values", async () => {
    const values = {
      ...data,
      name: " A ",
      email: "bad",
      phone: "bad",
      message: " short ",
    };
    for (const locale of ["en-US", "cs-CZ"] as const) {
      const result = await execute(values, locale);
      expect(await Effect.runPromise(result.effect)).toMatchObject({
        status: "error",
        values,
        fieldErrors: {
          name: m.contactValidationNameMinimum({ min: 2 }, { locale }),
          email: m.contactValidationEmailInvalid({}, { locale }),
          phone: m.contactValidationPhoneInvalid({}, { locale }),
          message: m.contactValidationMessageMinimum({ min: 10 }, { locale }),
        },
      });
      expect(result.submit).not.toHaveBeenCalled();
    }
  });

  test("enforces the shared schema length limits", async () => {
    const schema = Schema.toStandardSchemaV1(getContactSchema("en-US"));
    const email = `${"a".repeat(63)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(58)}.com`;
    const accepted = await schema["~standard"].validate({
      ...data,
      name: "n".repeat(100),
      email,
      message: "m".repeat(1000),
    });
    expect("issues" in accepted).toBe(false);
    const rejected = await schema["~standard"].validate({
      ...data,
      name: "n".repeat(101),
      email: "e".repeat(256),
      phone: "p".repeat(21),
      message: "m".repeat(1001),
    });
    expect(rejected).toMatchObject({ issues: expect.any(Array) });
  });

  test("maps detected bots to the localized rate-limit response", async () => {
    const { BotDetectedError } = await import(
      "@/shared/backend/bot-protection/bot-protection.service"
    );
    const result = await execute(
      data,
      "en-US",
      mock(() => Effect.fail(new BotDetectedError({ message: "blocked" })))
    );
    await expect(Effect.runPromise(result.effect)).resolves.toMatchObject({
      status: "error",
      message: m.contactRateLimitMessage({}, { locale: "en-US" }),
      values: data,
    });
    expect(result.submit).not.toHaveBeenCalled();
  });

  test("maps unavailable BotID verification to the generic error", async () => {
    const { BotVerificationError } = await import(
      "@/shared/backend/bot-protection/bot-protection.service"
    );
    const result = await execute(
      data,
      "en-US",
      mock(() =>
        Effect.fail(
          new BotVerificationError({ cause: new Error("unavailable") })
        )
      )
    );
    await expect(Effect.runPromise(result.effect)).resolves.toMatchObject({
      status: "error",
      message: m.contactEmailSendError({}, { locale: "en-US" }),
      values: data,
    });
    expect(result.submit).not.toHaveBeenCalled();
  });
});
