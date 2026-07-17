import { beforeEach, expect, mock, test } from "bun:test";
import { Effect, Logger } from "effect";

mock.module("server-only", () => ({}));

let vercelEnvironment: "development" | "preview" | "production" = "production";

mock.module("./bot-protection.runtime", () => ({
  isWorkspaceBotIdEnforcedAtRuntime: () => vercelEnvironment === "production",
}));

const checkBotId = mock(() =>
  Promise.resolve({
    isHuman: true,
    isBot: false,
    isVerifiedBot: false,
    bypassed: false,
  })
);

mock.module("botid/server", () => ({ checkBotId }));

beforeEach(() => {
  vercelEnvironment = "production";
  checkBotId.mockClear();
  checkBotId.mockImplementation(() =>
    Promise.resolve({
      isHuman: true,
      isBot: false,
      isVerifiedBot: false,
      bypassed: false,
    })
  );
});

const getVerificationEffect = async (
  verificationFailurePolicy: "allow" | "deny"
) => {
  const { BotProtectionService } = await import("./bot-protection.service");

  return Effect.gen(function* () {
    const service = yield* BotProtectionService;
    yield* service.verifyHuman({ verificationFailurePolicy });
  }).pipe(Effect.provide(BotProtectionService.Live));
};

for (const environment of ["preview", "development"] as const) {
  for (const verificationFailurePolicy of ["allow", "deny"] as const) {
    test(`does not call BotID in ${environment} with the ${verificationFailurePolicy} policy`, async () => {
      vercelEnvironment = environment;
      const effect = await getVerificationEffect(verificationFailurePolicy);

      await expect(Effect.runPromise(effect)).resolves.toBeUndefined();
      expect(checkBotId).not.toHaveBeenCalled();
    });
  }
}

for (const verificationFailurePolicy of ["allow", "deny"] as const) {
  test(`allows a human request with the ${verificationFailurePolicy} policy`, async () => {
    const effect = await getVerificationEffect(verificationFailurePolicy);

    await expect(Effect.runPromise(effect)).resolves.toBeUndefined();
    expect(checkBotId).toHaveBeenCalledTimes(1);
    expect(checkBotId).toHaveBeenCalledWith();
  });

  test(`allows a verified bot with the ${verificationFailurePolicy} policy`, async () => {
    checkBotId.mockImplementation(() =>
      Promise.resolve({
        isHuman: false,
        isBot: false,
        isVerifiedBot: true,
        verifiedBotName: "ExampleBot",
        bypassed: false,
      })
    );
    const effect = await getVerificationEffect(verificationFailurePolicy);

    await expect(Effect.runPromise(effect)).resolves.toBeUndefined();
  });

  test(`rejects a bot request with the ${verificationFailurePolicy} policy`, async () => {
    const { BotDetectedError } = await import("./bot-protection.service");
    checkBotId.mockImplementation(() =>
      Promise.resolve({
        isHuman: false,
        isBot: true,
        isVerifiedBot: false,
        bypassed: false,
      })
    );
    const effect = await getVerificationEffect(verificationFailurePolicy);

    const error = await Effect.runPromise(Effect.flip(effect));

    expect(error).toBeInstanceOf(BotDetectedError);
  });
}

test("preserves the cause and rejects when verification fails under the deny policy", async () => {
  const { BotVerificationError } = await import("./bot-protection.service");
  const cause = new Error("BotID unavailable");
  checkBotId.mockImplementation(() => Promise.reject(cause));
  const effect = await getVerificationEffect("deny");

  const error = await Effect.runPromise(Effect.flip(effect));

  expect(error).toBeInstanceOf(BotVerificationError);
  expect(error.cause).toBe(cause);
});

test("logs the cause and allows the request when verification fails under the allow policy", async () => {
  const cause = new Error("BotID unavailable");
  const messages: unknown[] = [];
  const logger = Logger.make((options) => {
    messages.push(options.message);
  });
  checkBotId.mockImplementation(() => Promise.reject(cause));
  const effect = await getVerificationEffect("allow");

  await expect(
    Effect.runPromise(effect.pipe(Effect.provide(Logger.layer([logger]))))
  ).resolves.toBeUndefined();

  const warningParts = messages.flatMap((message) =>
    Array.isArray(message) ? message : [message]
  );
  expect(warningParts).toContain(
    "Workspace BotID verification failed; allowing request"
  );
  expect(warningParts).toContainEqual({
    cause,
    verificationFailurePolicy: "allow",
  });
});
