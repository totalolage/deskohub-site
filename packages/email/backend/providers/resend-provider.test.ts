import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";

let send = mock(async () => ({ data: { id: "resend-id" } }));
let listDomains = mock(async () => ({ data: [] }));

mock.module("resend", () => ({
  Resend: class {
    emails = { send: send };
    domains = { list: listDomains };
  },
}));

const { ResendEmailProviderLive } = await import("./resend-provider");
const { EmailConfigTag, EmailProviderTag } = await import("../service");

beforeEach(() => {
  send = mock(async () => ({ data: { id: "resend-id" } }));
  listDomains = mock(async () => ({ data: [] }));
});

const config = {
  provider: "resend" as const,
  defaultFrom: { email: "deskohub@example.test" },
  apiKey: "api-key",
};

const runProvider = <A, E>(effect: Effect.Effect<A, E, EmailProviderTag>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(ResendEmailProviderLive),
      Effect.provide(Layer.succeed(EmailConfigTag, config))
    )
  );

const message = {
  from: { email: "deskohub@example.test" },
  to: { email: "ada@example.test" },
  subject: "Hello",
  html: "<p>Hello</p>",
};

describe("ResendEmailProvider", () => {
  test("maps 4xx and invalid errors to EmailServiceError", async () => {
    for (const error of [
      { statusCode: 400, message: "Bad request" },
      { message: "Invalid API key" },
    ]) {
      send = mock(async () => ({ error }));
      const result = await runProvider(
        Effect.gen(function* () {
          const provider = yield* EmailProviderTag;
          return yield* provider.send(message).pipe(Effect.result);
        })
      );

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure._tag).toBe("EmailServiceError");
      }
    }
  });

  test("maps 5xx and network errors to NetworkError", async () => {
    for (const failure of [
      async () => ({ error: { statusCode: 500, message: "Server error" } }),
      async () => {
        throw new Error("network down");
      },
    ]) {
      send = mock(failure);
      const result = await runProvider(
        Effect.gen(function* () {
          const provider = yield* EmailProviderTag;
          return yield* provider.send(message).pipe(Effect.result);
        })
      );

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure._tag).toBe("NetworkError");
      }
    }
  });

  test("send result includes status", async () => {
    const result = await runProvider(
      Effect.gen(function* () {
        const provider = yield* EmailProviderTag;
        return yield* provider.send(message);
      })
    );

    expect(result).toMatchObject({
      id: "resend-id",
      provider: "resend",
      status: "sent",
    });
  });

  test("verify fails when Resend returns an error", async () => {
    listDomains = mock(async () => ({ error: { message: "Invalid API key" } }));

    const result = await runProvider(
      Effect.gen(function* () {
        const provider = yield* EmailProviderTag;
        return yield* provider.verify().pipe(Effect.result);
      })
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("EmailServiceError");
    }
  });

  test("layer fails when EMAIL_API_KEY is missing", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* EmailProviderTag;
      }).pipe(
        Effect.provide(ResendEmailProviderLive),
        Effect.provide(
          Layer.succeed(EmailConfigTag, {
            provider: "resend" as const,
            defaultFrom: { email: "deskohub@example.test" },
          })
        ),
        Effect.result
      )
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("EmailServiceError");
    }
  });
});
