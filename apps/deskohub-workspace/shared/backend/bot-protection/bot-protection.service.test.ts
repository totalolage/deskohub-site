import { beforeEach, expect, mock, test } from "bun:test";
import { Effect, Logger } from "effect";
import type { AgentTraffic } from "@/shared/agent-traffic/agent-traffic";
import type { AgentTrafficEvent } from "@/shared/backend/agent-traffic/agent-traffic-events";
import type { VerifiedBotPolicy } from "./bot-protection.service";

mock.module("server-only", () => ({}));

let vercelEnvironment: "development" | "preview" | "production" = "production";

mock.module("./bot-protection.runtime", () => ({
  isWorkspaceBotIdEnforcedAtRuntime: () => vercelEnvironment === "production",
}));

type CheckBotIdResult = {
  readonly isHuman: boolean;
  readonly isBot: boolean;
  readonly isVerifiedBot: boolean;
  readonly verifiedBotName?: string;
  readonly verifiedBotCategory?: string;
  readonly bypassed: boolean;
};

const human: CheckBotIdResult = {
  isHuman: true,
  isBot: false,
  isVerifiedBot: false,
  bypassed: false,
};

const unverifiedBot: CheckBotIdResult = {
  isHuman: false,
  isBot: true,
  isVerifiedBot: false,
  bypassed: false,
};

// BotID reports a signed agent as a bot that is also verified.
const verifiedBot = (verifiedBotName: string): CheckBotIdResult => ({
  isHuman: false,
  isBot: true,
  isVerifiedBot: true,
  verifiedBotName,
  verifiedBotCategory: "ai_assistant",
  bypassed: false,
});

const checkBotId = mock(
  (): Promise<CheckBotIdResult> => Promise.resolve(human)
);

mock.module("botid/server", () => ({ checkBotId }));

const scheduledEvents: AgentTrafficEvent[] = [];
mock.module("@/shared/backend/agent-traffic/agent-traffic-events", () => ({
  scheduleAgentTrafficEvent: (event: AgentTrafficEvent) =>
    Effect.sync(() => {
      scheduledEvents.push(event);
    }),
}));

beforeEach(() => {
  vercelEnvironment = "production";
  scheduledEvents.length = 0;
  checkBotId.mockClear();
  checkBotId.mockImplementation(() => Promise.resolve(human));
});

const allowOperator: VerifiedBotPolicy = { allow: ["chatgpt-operator"] };

const getVerificationEffect = async (
  verificationFailurePolicy: "allow" | "deny",
  {
    verifiedBots = allowOperator,
    requestTraffic = { category: "unclassified" },
  }: {
    readonly verifiedBots?: VerifiedBotPolicy;
    readonly requestTraffic?: AgentTraffic;
  } = {}
) => {
  const { BotProtectionService } = await import("./bot-protection.service");
  const { CurrentAgentTraffic } = await import("../workspace-request-context");

  return Effect.gen(function* () {
    const service = yield* BotProtectionService;
    yield* service.verifyHuman({
      verificationFailurePolicy,
      verifiedBots,
      callSite: "contact.submit",
    });
  }).pipe(
    Effect.provide(BotProtectionService.Default),
    Effect.provideService(CurrentAgentTraffic, requestTraffic)
  );
};

const captureLogs = () => {
  const messages: unknown[] = [];
  const logger = Logger.make((options) => {
    messages.push(options.message);
  });
  return {
    layer: Logger.layer([logger]),
    parts: () =>
      messages.flatMap((message) =>
        Array.isArray(message) ? message : [message]
      ),
  };
};

for (const environment of ["development", "preview"] as const) {
  for (const verificationFailurePolicy of ["allow", "deny"] as const) {
    test(`does not call BotID in ${environment} with the ${verificationFailurePolicy} policy`, async () => {
      vercelEnvironment = environment;
      checkBotId.mockImplementation(() => Promise.resolve(unverifiedBot));
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
    expect(scheduledEvents).toEqual([]);
  });

  test(`rejects an unverified bot with the ${verificationFailurePolicy} policy and records it by the request's agent traffic`, async () => {
    const { BotDetectedError } = await import("./bot-protection.service");
    checkBotId.mockImplementation(() => Promise.resolve(unverifiedBot));
    const effect = await getVerificationEffect(verificationFailurePolicy, {
      requestTraffic: { category: "automation" },
    });

    const error = await Effect.runPromise(Effect.flip(effect));

    expect(error).toBeInstanceOf(BotDetectedError);
    expect(error).toMatchObject({ reason: "unverified_bot" });
    expect(scheduledEvents).toEqual([
      {
        event: "bot protection rejection",
        traffic: { category: "automation" },
        properties: { call_site: "contact.submit", verified_bot: false },
        timestamp: expect.any(Temporal.Instant),
      },
    ]);
  });

  test(`allows a verified bot on the allow list with the ${verificationFailurePolicy} policy and logs its name`, async () => {
    checkBotId.mockImplementation(() =>
      Promise.resolve(verifiedBot("chatgpt-operator"))
    );
    const logs = captureLogs();
    const effect = await getVerificationEffect(verificationFailurePolicy);

    await expect(
      Effect.runPromise(effect.pipe(Effect.provide(logs.layer)))
    ).resolves.toBeUndefined();

    expect(logs.parts()).toContain("Workspace BotID allowed a verified bot");
    expect(logs.parts()).toContainEqual({
      verifiedBotName: "chatgpt-operator",
      verifiedBotCategory: "ai_assistant",
    });
    expect(scheduledEvents).toEqual([]);
  });

  test(`rejects a verified bot missing from the allow list with the ${verificationFailurePolicy} policy and records it by its BotID verdict`, async () => {
    const { BotDetectedError } = await import("./bot-protection.service");
    checkBotId.mockImplementation(() =>
      Promise.resolve(verifiedBot("example-crawler"))
    );
    const effect = await getVerificationEffect(verificationFailurePolicy, {
      requestTraffic: { category: "automation" },
    });

    const error = await Effect.runPromise(Effect.flip(effect));

    expect(error).toBeInstanceOf(BotDetectedError);
    expect(error).toMatchObject({
      reason: "verified_bot_not_allowed",
      verifiedBotCategory: "ai_assistant",
    });
    expect(scheduledEvents).toEqual([
      {
        event: "bot protection rejection",
        traffic: { category: "ai_user_agent", name: "other" },
        properties: { call_site: "contact.submit", verified_bot: true },
        timestamp: expect.any(Temporal.Instant),
      },
    ]);
  });

  test(`rejects every verified bot under a deny verified-bot policy with the ${verificationFailurePolicy} policy and records it by its BotID name`, async () => {
    checkBotId.mockImplementation(() =>
      Promise.resolve(verifiedBot("chatgpt-operator"))
    );
    const effect = await getVerificationEffect(verificationFailurePolicy, {
      verifiedBots: "deny",
    });

    const error = await Effect.runPromise(Effect.flip(effect));

    expect(error).toMatchObject({
      _tag: "BotDetectedError",
      reason: "verified_bot_not_allowed",
    });
    expect(scheduledEvents).toEqual([
      {
        event: "bot protection rejection",
        traffic: { category: "ai_user_agent", name: "chatgpt" },
        properties: { call_site: "contact.submit", verified_bot: true },
        timestamp: expect.any(Temporal.Instant),
      },
    ]);
  });
}

test("rejects an allow-listed name that BotID did not verify", async () => {
  checkBotId.mockImplementation(() =>
    Promise.resolve({
      ...unverifiedBot,
      verifiedBotName: "chatgpt-operator",
    })
  );
  const effect = await getVerificationEffect("allow");

  const error = await Effect.runPromise(Effect.flip(effect));

  expect(error).toMatchObject({
    _tag: "BotDetectedError",
    reason: "unverified_bot",
  });
  expect(scheduledEvents).toEqual([
    {
      event: "bot protection rejection",
      traffic: { category: "unclassified" },
      properties: { call_site: "contact.submit", verified_bot: false },
      timestamp: expect.any(Temporal.Instant),
    },
  ]);
});

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
  const logs = captureLogs();
  checkBotId.mockImplementation(() => Promise.reject(cause));
  const effect = await getVerificationEffect("allow");

  await expect(
    Effect.runPromise(effect.pipe(Effect.provide(logs.layer)))
  ).resolves.toBeUndefined();

  expect(logs.parts()).toContain(
    "Workspace BotID verification failed; allowing request"
  );
  expect(logs.parts()).toContainEqual({
    cause,
    verificationFailurePolicy: "allow",
  });
  expect(scheduledEvents).toEqual([]);
});
