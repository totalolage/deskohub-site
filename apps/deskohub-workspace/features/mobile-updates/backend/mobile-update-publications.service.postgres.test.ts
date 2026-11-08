import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import {
  syntheticUpdate,
  uniqueRuntimeVersion,
} from "@/features/mobile-updates/mobile-update-routes.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { MobileUpdatePublications } from "./mobile-update-publications.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const frozenAt = Temporal.Instant.from("2026-11-07T09:00:00.123456Z");

describe.skipIf(!testDatabase)(
  "MobileUpdatePublications on disposable Postgres",
  () => {
    if (!testDatabase) return;

    /** Runs `use` with the clock frozen, as when publications race. */
    const atFrozenTime = <A, E>(
      use: (
        publications: MobileUpdatePublications["Service"]
      ) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        TestClock.setTime(frozenAt.epochMilliseconds).pipe(
          Effect.andThen(Effect.flatMap(MobileUpdatePublications, use)),
          Effect.provide(
            Layer.merge(
              MobileUpdatePublications.Default.pipe(
                Layer.provide(testDatabase.layer)
              ),
              TestClock.layer()
            )
          )
        )
      );

    test("keeps each newer publication strictly newer at millisecond precision", async () => {
      const target = {
        platform: "android" as const,
        runtimeVersion: uniqueRuntimeVersion(),
      };
      const first = syntheticUpdate(target);
      const second = syntheticUpdate(target);

      const [afterFirst, afterSecond] = await atFrozenTime((publications) =>
        Effect.gen(function* () {
          yield* publications.publish(first);
          const afterFirst = yield* publications.latest(target);
          yield* publications.publish(second);
          return [afterFirst, yield* publications.latest(target)] as const;
        })
      );

      const firstPublished = Option.getOrThrow(afterFirst);
      const secondPublished = Option.getOrThrow(afterSecond);
      expect(firstPublished.publication.id).toBe(first.id);
      expect(firstPublished.publishedAt.toString()).toBe(
        "2026-11-07T09:00:00.123Z"
      );
      expect(secondPublished.publication.id).toBe(second.id);
      expect(secondPublished.publishedAt.toString()).toBe(
        "2026-11-07T09:00:00.124Z"
      );
    });

    test("records every one of several concurrent publications", async () => {
      const target = {
        platform: "ios" as const,
        runtimeVersion: uniqueRuntimeVersion(),
      };
      const updates = Array.from({ length: 5 }, () => syntheticUpdate(target));

      const outcomes = await atFrozenTime((publications) =>
        Effect.all(updates.map(publications.publish), {
          concurrency: "unbounded",
        })
      );

      expect(outcomes).toEqual(Array.from({ length: 5 }, () => "published"));
    });
  }
);
