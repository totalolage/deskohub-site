import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  type EmailDeliveryId,
  EmailDeliveryIdSchema,
  type EmailDeliveryObserver,
  type EmailSentEvent,
} from "@deskohub/email";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { EmailKind } from "./email-kind";
import { makePostHogDeliveryTrackingObserver } from "./posthog-delivery-tracking-observer";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const run = crypto.randomUUID().slice(0, 8);
const sentAt = "2026-11-09T12:00:00.000Z";

/** A kind whose delivery reports read one synthetic reference. */
const trackedKind: EmailKind<{ readonly syntheticReference: string }> = {
  category: "synthetic-tracked-kind",
  metadata: Schema.toStandardSchemaV1(
    Schema.Struct({ syntheticReference: Schema.NonEmptyString })
  ),
};

const sentEvent = (
  deliveryId: EmailDeliveryId,
  overrides: Partial<EmailSentEvent> = {}
): EmailSentEvent => ({
  provider: "posthog",
  deliveryId,
  stream: "marketing",
  category: trackedKind.category,
  tags: [trackedKind.category],
  metadata: {
    deploymentEnvironment: "preview",
    syntheticReference: `reference-${run}`,
    attempt: 2,
    retried: true,
    missing: undefined,
  },
  idempotencyKey: undefined,
  at: new Date(sentAt),
  ...overrides,
});

describe.skipIf(!testDatabase)(
  "PostHog delivery tracking observer on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const deliveryIds: EmailDeliveryId[] = [];

    const deliveryId = (label: string) => {
      const id = EmailDeliveryIdSchema.make(`posthog-${run}-${label}`);
      deliveryIds.push(id);
      return id;
    };

    afterAll(() =>
      testDatabase.pool.query(
        "delete from posthog_email_deliveries where message_id = any($1)",
        [deliveryIds]
      )
    );

    const observe = (
      notify: (observer: EmailDeliveryObserver) => Effect.Effect<void>
    ) =>
      Effect.runPromise(
        makePostHogDeliveryTrackingObserver([trackedKind]).pipe(
          Effect.flatMap(notify),
          Effect.provide(testDatabase.layer)
        )
      );

    const trackedRows = async (id: EmailDeliveryId) =>
      (
        await testDatabase.pool.query(
          `select message_id, category, tags, status, reason,
                  sent_at::text as sent_at, status_at,
                  next_poll_at::text as next_poll_at, last_polled_at,
                  poll_count, settled_at
             from posthog_email_deliveries where message_id = $1`,
          [id]
        )
      ).rows;

    test("tracks an email PostHog accepted, tagged as its delivery reports will be", async () => {
      const id = deliveryId("accepted");

      await observe((observer) => observer.onSent(sentEvent(id)));

      expect(await trackedRows(id)).toEqual([
        {
          message_id: id,
          category: trackedKind.category,
          tags: {
            category: trackedKind.category,
            deploymentEnvironment: "preview",
            syntheticReference: `reference-${run}`,
          },
          status: "queued",
          reason: null,
          sent_at: "2026-11-09 12:00:00+00",
          status_at: null,
          next_poll_at: "2026-11-09 12:00:00+00",
          last_polled_at: null,
          poll_count: 0,
          settled_at: null,
        },
      ]);
    });

    const trackedTags = async (id: EmailDeliveryId) =>
      (await trackedRows(id)).map(({ category, tags }) => ({ category, tags }));

    test("tracks an uncategorised email without metadata with no tags", async () => {
      const id = deliveryId("bare");

      await observe((observer) =>
        observer.onSent(
          sentEvent(id, { category: undefined, tags: [], metadata: undefined })
        )
      );

      expect(await trackedTags(id)).toEqual([{ category: null, tags: {} }]);
    });

    test("keeps no metadata the email's kind doesn't declare, such as a contact's name or address", async () => {
      const id = deliveryId("personal");

      await observe((observer) =>
        observer.onSent(
          sentEvent(id, {
            metadata: {
              deploymentEnvironment: "preview",
              syntheticReference: `reference-${run}`,
              contactName: "Ada Example",
              contactEmail: testEmailAddress("ada"),
            },
          })
        )
      );

      expect(await trackedTags(id)).toEqual([
        {
          category: trackedKind.category,
          tags: {
            category: trackedKind.category,
            deploymentEnvironment: "preview",
            syntheticReference: `reference-${run}`,
          },
        },
      ]);
    });

    test("keeps declared metadata Resend's tag characters can't carry", async () => {
      const id = deliveryId("punctuation");

      await observe((observer) =>
        observer.onSent(
          sentEvent(id, {
            metadata: { syntheticReference: "2026-11-09T12:00:00Z" },
          })
        )
      );

      expect(await trackedTags(id)).toEqual([
        {
          category: trackedKind.category,
          tags: {
            category: trackedKind.category,
            syntheticReference: "2026-11-09T12:00:00Z",
          },
        },
      ]);
    });

    test.each([
      [
        "of no tracked kind",
        {
          category: "synthetic-untracked-kind",
          tags: ["synthetic-untracked-kind"],
        },
      ],
      ["whose metadata its kind rejects", { category: trackedKind.category }],
    ])(
      "keeps only the category and deployment of an email %s",
      async (label, overrides) => {
        const id = deliveryId(label.replaceAll(" ", "-"));

        await observe((observer) =>
          observer.onSent(
            sentEvent(id, {
              ...overrides,
              metadata: {
                deploymentEnvironment: "preview",
                syntheticReference: "",
                contactName: "Ada Example",
              },
            })
          )
        );

        expect(await trackedTags(id)).toEqual([
          {
            category: overrides.category,
            tags: {
              category: overrides.category,
              deploymentEnvironment: "preview",
            },
          },
        ]);
      }
    );

    test("keeps the email's own category when its metadata names another", async () => {
      const id = deliveryId("category-metadata");

      await observe((observer) =>
        observer.onSent(sentEvent(id, { metadata: { category: "campaign" } }))
      );

      expect(await trackedTags(id)).toEqual([
        {
          category: trackedKind.category,
          tags: { category: trackedKind.category },
        },
      ]);
    });

    test("keeps the first record when the same delivery is reported again", async () => {
      const id = deliveryId("replayed");
      await observe((observer) => observer.onSent(sentEvent(id)));
      const firstRecord = await trackedRows(id);

      await observe((observer) =>
        observer.onSent(
          sentEvent(id, {
            category: "campaign",
            metadata: { deploymentEnvironment: "production" },
            at: new Date("2026-11-09T12:05:00.000Z"),
          })
        )
      );

      expect(await trackedRows(id)).toEqual(firstRecord);
    });

    test("ignores emails other providers accepted", async () => {
      const id = deliveryId("resend");

      await observe((observer) =>
        observer.onSent(sentEvent(id, { provider: "resend" }))
      );

      expect(await trackedRows(id)).toEqual([]);
    });

    test("tracks nothing when the email falls back to another provider", async () => {
      const id = deliveryId("fallback");

      await observe((observer) => observer.onFallback(sentEvent(id)));

      expect(await trackedRows(id)).toEqual([]);
    });

    test("leaves the caller's transaction usable when a delivery can't be recorded", async () => {
      // Postgres text rejects NUL bytes, so this insert fails in the database.
      const unstorable = EmailDeliveryIdSchema.make(`posthog-${run}-\u0000`);
      const id = deliveryId("after-unstorable");

      await observe((observer) =>
        Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
          transaction(
            Effect.andThen(
              observer.onSent(sentEvent(unstorable)),
              observer.onSent(sentEvent(id))
            )
          ).pipe(Effect.orDie)
        )
      );

      expect(await trackedRows(id)).toHaveLength(1);
    });
  }
);
