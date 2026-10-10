import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { EmailServiceError, EmailTemplateError } from "./capabilities";

describe("email errors", () => {
  test("are yieldable tagged errors that keep their cause", async () => {
    const cause = new Error("provider failure");
    const serviceError = new EmailServiceError("Send failed", cause, "resend");
    const templateError = new EmailTemplateError(
      "Render failed",
      "reservation-confirmation",
      cause
    );

    expect(serviceError).toBeInstanceOf(Error);
    expect(serviceError).toMatchObject({
      _tag: "EmailServiceError",
      message: "Send failed",
      provider: "resend",
      cause,
    });
    expect(templateError).toBeInstanceOf(Error);
    expect(templateError).toMatchObject({
      _tag: "EmailTemplateError",
      message: "Render failed",
      template: "reservation-confirmation",
      cause,
    });

    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* serviceError;
      }).pipe(Effect.flip)
    );
    expect(failure).toBe(serviceError);
  });
});
