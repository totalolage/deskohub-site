import { expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import type { EmailMessage } from "../types/email.types";
import { EmailConfigTag } from "./capabilities";
import { makeEmailProviderFake } from "./email-provider.test-utils";
import { EmailServiceTag } from "./service";

const message: EmailMessage = {
  from: { email: testEmailAddress("sender") },
  to: { email: testEmailAddress("recipient") },
  subject: "Synthetic delivery",
  text: "Synthetic body",
};

const runWithFake = <A, E>(
  fake: ReturnType<typeof makeEmailProviderFake>,
  effect: Effect.Effect<A, E, EmailServiceTag>
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        EmailServiceTag.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              fake.layer,
              Layer.succeed(EmailConfigTag, { defaultFrom: message.from })
            )
          )
        )
      )
    )
  );

const withInstantRetries = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect);
    yield* TestClock.adjust("1 minute");
    return yield* Fiber.join(fiber);
  }).pipe(Effect.provide(TestClock.layer()));

test("single-send retry after a lost response makes one delivery", async () => {
  const fake = makeEmailProviderFake();
  fake.respondWith(() => "accept-lost");
  const result = await runWithFake(
    fake,
    Effect.gen(function* () {
      const email = yield* EmailServiceTag;
      return yield* email.send(message);
    }).pipe(withInstantRetries)
  );

  expect(fake.requests()).toHaveLength(2);
  expect(fake.requests()[1]?.key).toBe(fake.requests()[0]?.key);
  expect(fake.mailed()).toEqual([testEmailAddress("recipient")]);
  expect(result.provider).toBe("resend");
});

test("a batch makes one request; the caller replays lost acceptance under the same key", async () => {
  const fake = makeEmailProviderFake();
  fake.respondWith(() => "accept-lost");
  const messages = [
    message,
    { ...message, to: { email: testEmailAddress("second") } },
  ];
  await runWithFake(
    fake,
    Effect.gen(function* () {
      const email = yield* EmailServiceTag;
      const first = yield* email
        .sendBatch(messages, { idempotencyKey: "batch" })
        .pipe(Effect.result);
      expect(first._tag).toBe("Failure");
      expect(fake.requests()).toHaveLength(1);
      expect(fake.mailed()).toHaveLength(2);
      const replay = yield* email.sendBatch(messages, {
        idempotencyKey: "batch",
      });
      const again = yield* email.sendBatch(messages, {
        idempotencyKey: "batch",
      });
      expect(again).toEqual(replay);
      expect(replay.map(({ id }) => id)).toHaveLength(2);
      expect(replay[0]?.id).not.toBe(replay[1]?.id);
    })
  );
  expect(fake.requests()).toHaveLength(3);
  expect(fake.mailed()).toEqual([
    testEmailAddress("recipient"),
    testEmailAddress("second"),
  ]);
});

test("changed payload under an accepted key is uncertain and never mailed", async () => {
  const fake = makeEmailProviderFake();
  await runWithFake(
    fake,
    Effect.gen(function* () {
      const email = yield* EmailServiceTag;
      yield* email.sendBatch([message], { idempotencyKey: "batch" });
      const mismatch = yield* email
        .sendBatch([{ ...message, subject: "Changed" }], {
          idempotencyKey: "batch",
        })
        .pipe(Effect.result);
      expect(mismatch._tag).toBe("Failure");
      if (mismatch._tag === "Failure")
        expect(mismatch.failure._tag).toBe("NetworkError");
    })
  );
  expect(fake.mailed()).toHaveLength(1);
  expect(fake.subjects()).toEqual([
    { to: testEmailAddress("recipient"), subject: message.subject },
  ]);
});

test("a refused request sends nothing and can be accepted on a later attempt", async () => {
  const fake = makeEmailProviderFake();
  fake.respondWith(() => "refuse");
  await runWithFake(
    fake,
    Effect.gen(function* () {
      const email = yield* EmailServiceTag;
      const refused = yield* email
        .send({ ...message, idempotencyKey: "send" })
        .pipe(Effect.result);
      expect(refused._tag).toBe("Failure");
      if (refused._tag === "Failure")
        expect(refused.failure._tag).toBe("EmailServiceError");
      expect(fake.requests()).toHaveLength(1);
      expect(fake.mailed()).toEqual([]);
      fake.respondWith(() => "accept");
      yield* email.send({ ...message, idempotencyKey: "send" });
    })
  );
  expect(fake.mailed()).toHaveLength(1);
});

test.each(["hang", "accept-hang"] as const)(
  "%s can be interrupted, then replayed",
  async (mode) => {
    const fake = makeEmailProviderFake();
    fake.respondWith(() => mode);
    const reached = fake.nextRequest();
    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          fake.provider.sendBatch([message], { idempotencyKey: "batch" })
        );
        yield* Effect.promise(() => reached);
        yield* Fiber.interrupt(fiber);
      })
    );
    expect(fake.mailed()).toHaveLength(mode === "hang" ? 0 : 1);
    fake.respondWith(() => "accept");
    await Effect.runPromise(
      fake.provider.sendBatch([message], { idempotencyKey: "batch" })
    );
    expect(fake.mailed()).toHaveLength(1);
    expect(fake.requests()).toHaveLength(2);
  }
);

test("provider hooks run before recording and unkeyed executions are independent", async () => {
  const fake = makeEmailProviderFake();
  const counts: number[] = [];
  fake.beforeEachRequest(async () => {
    counts.push(fake.requests().length);
  });
  const send = fake.provider.send(message);
  expect(fake.requests()).toEqual([]);
  await Effect.runPromise(send);
  await Effect.runPromise(send);
  await Effect.runPromise(
    fake.provider.send({ ...message, idempotencyKey: "shared" })
  );
  await Effect.runPromise(
    fake.provider.sendBatch([message], { idempotencyKey: "shared" })
  );
  expect(counts).toEqual([0, 1, 2, 3]);
  expect(fake.mailed()).toHaveLength(4);
});
