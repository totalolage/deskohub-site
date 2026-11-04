import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { NexiWebhookEventIdSchema } from "@deskohub/nexi";
import { Cause, Effect, Exit } from "effect";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import { WebhookEventRepository } from "./webhook-event.repository";

describe("WebhookEventRepository.insertReceived", () => {
  test("dies when a conflicting event vanishes before its duplicate is read", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    // The insert conflicts and returns nothing, then the read finds nothing.
    recording.setRows([[], []]);
    const eventId = NexiWebhookEventIdSchema.make("nexi-event-vanished");

    const exit = await Effect.runPromise(
      Effect.exit(
        Effect.gen(function* () {
          const repository = yield* WebhookEventRepository;
          return yield* repository.insertReceived({
            eventId,
            receivedAt: Temporal.Instant.from("2026-10-20T08:00:00Z"),
          });
        }).pipe(
          Effect.provide(WebhookEventRepository.Default),
          Effect.provide(recording.layer)
        )
      )
    );

    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
    expect(recording.statements.map(({ sql }) => sql.split(" ")[0])).toEqual([
      "insert",
      "select",
    ]);
    expect(recording.statements[1]?.params).toEqual([eventId, 1]);
  });
});
