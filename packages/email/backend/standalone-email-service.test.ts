import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { EmailConfigTag, EmailServiceTag } from "./service";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("EmailServiceTag.LiveWithDependencies", () => {
  test("materializes with config and verifies console provider", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.EMAIL_API_KEY;

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const email = yield* EmailServiceTag;
        return yield* email.verify;
      }).pipe(
        Effect.provide(
          EmailServiceTag.LiveWithDependencies.pipe(
            Layer.provide(
              Layer.succeed(EmailConfigTag, {
                provider: "console",
                defaultFrom: { email: "deskohub@example.test" },
              })
            )
          )
        )
      )
    );

    expect(result).toBeTrue();
  });
});
