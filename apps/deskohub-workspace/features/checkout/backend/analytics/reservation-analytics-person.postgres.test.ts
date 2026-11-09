import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { accountAnalyticsConsentDecisions } from "@/db/schema";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { AnalyticsConsentDecision } from "@/features/legal/analytics-consent-decision";
import { AnalyticsConsentLedger } from "@/features/legal/backend/analytics-consent-ledger";
import { getLegalDocumentVersion } from "@/features/legal/document-version";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { recordServerAnalytics } from "@/shared/backend/analytics/server-analytics.service.mock";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  CheckoutAnalytics,
  type ICheckoutAnalytics,
} from "./checkout-analytics.service";
import { ReservationAnalyticsPerson } from "./reservation-analytics-person";

const testDatabase = await connectWorkspacePostgresTestDatabase();
const fixtures = workspaceFixtures(testDatabase!.db);
const timestamp = Temporal.Instant.from("2099-06-17T12:00:00.000Z");

/**
 * Runs `operation` as one request does: checkout analytics over the stored
 * reservations and ledger, its events recorded as PostHog would receive them.
 */
const captureRun = async (
  operation: (analytics: ICheckoutAnalytics) => Effect.Effect<unknown>
) => {
  const recorder = recordServerAnalytics();
  const database = Layer.succeed(
    WorkspaceDatabase,
    WorkspaceDatabase.make(testDatabase!.db)
  );
  const layer = CheckoutAnalytics.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        recorder.layer,
        ReservationAnalyticsPerson.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              WorkspaceReservationRepository.Default,
              AnalyticsConsentLedger.Default
            )
          ),
          Layer.provide(database)
        )
      )
    )
  );
  await Effect.runPromise(
    Effect.flatMap(CheckoutAnalytics, operation).pipe(Effect.provide(layer))
  );
  return recorder.messages;
};

/** A reservation authored by a fresh account with a login. */
const authoredReservation = async () => {
  const { accountId } = await Effect.runPromise(
    fixtures.account("lifecycle-person")
  );
  const reservation = await Effect.runPromise(
    fixtures.reservation({ stage: { reservation: "held" }, author: accountId })
  );
  return { accountId, reservation };
};

const decide = (
  accountId: CustomerAccountId,
  decision: AnalyticsConsentDecision,
  decidedAt: string,
  documentHash = getLegalDocumentVersion("cs-CZ", "privacy-policy")
) =>
  Effect.runPromise(
    testDatabase!.db.insert(accountAnalyticsConsentDecisions).values({
      accountId,
      decision,
      documentHash,
      locale: "cs-CZ",
      decidedAt: Temporal.Instant.from(decidedAt),
      source: "banner",
    })
  );

describe("Lifecycle events and the author's analytics consent", () => {
  test("links a consenting author's events to the author's person", async () => {
    const { accountId, reservation } = await authoredReservation();
    await decide(accountId, "grant", "2026-11-01T10:00:00Z");

    const messages = await captureRun((analytics) =>
      analytics.reservationStarted({ reservation, timestamp })
    );

    expect(messages).toMatchObject([
      {
        distinctId: `workspace-account:${accountId}`,
        uuid: `${reservation.id}:reservation started`,
        properties: { reservation_id: reservation.id },
      },
    ]);
    expect(messages[0]?.properties).not.toHaveProperty(
      "$process_person_profile"
    );
  });

  test("keeps linking under a grant given for an older privacy notice", async () => {
    const { accountId, reservation } = await authoredReservation();
    await decide(
      accountId,
      "grant",
      "2026-01-01T10:00:00Z",
      "older-privacy-notice-hash"
    );

    const messages = await captureRun((analytics) =>
      analytics.reservationCompleted({ reservation, timestamp })
    );

    expect(messages[0]?.distinctId).toBe(`workspace-account:${accountId}`);
  });

  test("keeps the events of an author who never decided personless", async () => {
    const { reservation } = await authoredReservation();

    const messages = await captureRun((analytics) =>
      analytics.reservationStarted({ reservation, timestamp })
    );

    expect(messages).toMatchObject([
      {
        distinctId: reservation.id,
        properties: {
          $process_person_profile: false,
          reservation_id: reservation.id,
        },
      },
    ]);
  });

  test("captures personless after the author withdraws, from the next request on", async () => {
    const { accountId, reservation } = await authoredReservation();
    const attempt = {
      id: "synthetic-withdrawal-payment-attempt-id",
      workspaceReservationId: reservation.id,
      provider: "nexi" as const,
      amount: { value: 12_500, exponent: 2, currency: "CZK" },
    };
    await decide(accountId, "grant", "2026-11-01T10:00:00Z");

    const started = await captureRun((analytics) =>
      analytics.reservationStarted({ reservation, timestamp })
    );
    await decide(accountId, "withdraw", "2026-11-02T10:00:00Z");
    const paid = await captureRun((analytics) =>
      analytics.paymentStarted({ attempt, timestamp })
    );

    expect(started[0]?.distinctId).toBe(`workspace-account:${accountId}`);
    expect(paid).toMatchObject([
      {
        distinctId: reservation.id,
        uuid: `${attempt.id}:payment started`,
        properties: { $process_person_profile: false },
      },
    ]);
  });

  test("keeps the events of a reservation it can't find personless", async () => {
    const reservation = {
      id: workspaceReservationIdSchema.make(
        "019edbcf-5026-7ecc-821b-000000000000"
      ),
    };

    const messages = await captureRun((analytics) =>
      analytics.reservationAbandoned({ reservation, timestamp })
    );

    expect(messages[0]?.distinctId).toBe(reservation.id);
  });
});
