import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Logger, References } from "effect";

type SendResponse =
  | { readonly data: { readonly id: string }; readonly error?: never }
  | {
      readonly data?: never;
      readonly error: {
        readonly message: string;
        readonly statusCode?: number;
      };
    };
type SendImplementation = () => Promise<SendResponse>;
type ListDomainsResponse =
  | { readonly data: readonly unknown[]; readonly error?: never }
  | { readonly data?: never; readonly error: { readonly message: string } };
type ListDomainsImplementation = () => Promise<ListDomainsResponse>;

let send = mock<SendImplementation>(async () => ({
  data: { id: "resend-id" },
}));
let listDomains = mock<ListDomainsImplementation>(async () => ({ data: [] }));

mock.module("resend", () => ({
  Resend: class {
    emails = { send: send };
    domains = { list: listDomains };
  },
}));

const { ResendEmailProviderLive } = await import("./resend-provider");
const { EmailConfigTag, EmailProviderTag } = await import("../service");

type EmailProviderRequirement = import("../service").EmailProviderTag;

beforeEach(() => {
  send = mock<SendImplementation>(async () => ({
    data: { id: "resend-id" },
  }));
  listDomains = mock<ListDomainsImplementation>(async () => ({ data: [] }));
});

const config = {
  provider: "resend" as const,
  defaultFrom: { email: "deskohub@example.test" },
  apiKey: "api-key",
};

const runProvider = <A, E>(
  effect: Effect.Effect<A, E, EmailProviderRequirement>
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        ResendEmailProviderLive.pipe(
          Layer.provide(Layer.succeed(EmailConfigTag, config))
        )
      )
    )
  );

const message = {
  from: { email: "deskohub@example.test" },
  to: { email: "ada@example.test" },
  subject: "Hello",
  html: "<p>Hello</p>",
};

describe("ResendEmailProvider", () => {
  test("does not log a dynamic subject or provider message on failure", async () => {
    const subject = "SyntheticProviderSubject42";
    const providerMessage = "SyntheticProviderFailure42";
    const records: unknown[] = [];
    send = mock<SendImplementation>(async () => ({
      error: { statusCode: 400, message: providerMessage },
    }));
    const logger = Logger.make((options) => {
      records.push({
        annotations: options.fiber.getRef(References.CurrentLogAnnotations),
        message: options.message,
      });
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* EmailProviderTag;
        return yield* provider
          .send({ ...message, subject })
          .pipe(Effect.result);
      }).pipe(
        Effect.provide(
          ResendEmailProviderLive.pipe(
            Layer.provide(Layer.succeed(EmailConfigTag, config))
          )
        ),
        Effect.provide(Logger.layer([logger]))
      )
    );

    expect(result._tag).toBe("Failure");
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain(subject);
    expect(serialized).not.toContain(providerMessage);
  });

  test("maps 4xx and invalid errors to EmailServiceError", async () => {
    for (const error of [
      { statusCode: 400, message: "Bad request" },
      { message: "Invalid API key" },
    ]) {
      send = mock<SendImplementation>(async () => ({ error }));
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
      send = mock<SendImplementation>(failure);
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
    listDomains = mock<ListDomainsImplementation>(async () => ({
      error: { message: "Invalid API key" },
    }));

    const result = await runProvider(
      Effect.gen(function* () {
        const provider = yield* EmailProviderTag;
        return yield* provider.verify.pipe(Effect.result);
      })
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("EmailServiceError");
    }
  });

  test("layer fails when EMAIL_API_KEY is missing", async () => {
    const result = await Effect.runPromise(
      EmailProviderTag.pipe(
        Effect.provide(
          ResendEmailProviderLive.pipe(
            Layer.provide(
              Layer.succeed(EmailConfigTag, {
                provider: "resend" as const,
                defaultFrom: { email: "deskohub@example.test" },
              })
            )
          )
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
