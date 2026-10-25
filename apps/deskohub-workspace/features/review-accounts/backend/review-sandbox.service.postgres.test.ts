import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { beforeAll, describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Option } from "effect";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { checkoutSessionIdSchema } from "@/features/checkout/checkout-identifiers";
import { getWorkspaceMeetingRoomPriceForDuration } from "@/features/checkout/product-catalog";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  ReviewSandbox,
  type ReviewSandboxHoldRequest,
} from "./review-sandbox.service";
import { getReviewSampleReservations } from "./review-sandbox-reservation";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)("ReviewSandbox on disposable Postgres", () => {
  if (!testDatabase) return;

  const reviewer = customerAccountIdSchema.make(crypto.randomUUID());
  const otherReviewer = customerAccountIdSchema.make(crypto.randomUUID());

  beforeAll(() => {
    const fixtures = workspaceFixtures(testDatabase.db);
    return Effect.runPromise(
      Effect.forEach([reviewer, otherReviewer], (id) =>
        fixtures.customerAccount({ id, review: true })
      )
    );
  });

  const run = <A, E>(
    operation: (sandbox: typeof ReviewSandbox.Service) => Effect.Effect<A, E>
  ) =>
    Effect.runPromise(
      Effect.flatMap(ReviewSandbox, operation).pipe(
        Effect.provide(
          ReviewSandbox.Default.pipe(Layer.provide(testDatabase.layer))
        )
      )
    );

  const duration = { unit: "hour", amount: 1 } as const;
  const hold = (
    reservationDate: string,
    overrides: Partial<ReviewSandboxHoldRequest> = {}
  ): ReviewSandboxHoldRequest => ({
    accountId: reviewer,
    locale: "cs-CZ",
    checkoutSessionId: checkoutSessionIdSchema.make(crypto.randomUUID()),
    selection: "selection",
    reservation: {
      kind: "meeting-room",
      duration,
      reservationDate,
      startsAt: `${reservationDate}T08:00:00Z`,
      endsAt: `${reservationDate}T09:00:00Z`,
      name: "App Review",
      email: testEmailAddress("app-review"),
      phone: "unused",
      billing: { purpose: "personal", invoice: "none" },
    } as ReviewSandboxHoldRequest["reservation"],
    total: getWorkspaceMeetingRoomPriceForDuration(duration),
    bookedAt: Temporal.Now.instant(),
    ...overrides,
  });

  test("keeps no contact detail of the booking", async () => {
    const held = await run((sandbox) =>
      sandbox.prepareHold(hold("2099-01-05"))
    );
    const stored = await testDatabase.pool.query(
      "select * from review_account_holds where id = $1",
      [held.orderId]
    );

    expect(JSON.stringify(stored.rows[0])).not.toContain("App Review");
  });

  test("lists the samples and holds with the order IDs their status pages use", async () => {
    const held = await run((sandbox) =>
      sandbox.prepareHold(hold("2099-02-01"))
    );
    const history = await run((sandbox) => sandbox.history(reviewer));
    if (history.kind !== "available") throw new Error("Expected a history");
    const items = [
      ...history.groups.current,
      ...history.groups.past,
      ...history.groups.unavailable,
    ];
    const samples = getReviewSampleReservations(
      reviewer,
      Temporal.Now.instant()
    );

    expect(history.groups.past.length).toBeGreaterThan(0);
    expect(history.groups.current.length).toBeGreaterThan(0);
    expect(
      items.map(({ workspaceReservationId }) => workspaceReservationId)
    ).toEqual(
      expect.arrayContaining([
        held.orderId,
        ...samples.map(({ orderId }) => orderId),
      ])
    );
    expect(items.every((item) => item.reviewSandbox === true)).toBe(true);
  });

  test("reports a hold's status and a sample's status without access", async () => {
    const held = await run((sandbox) =>
      sandbox.prepareHold(hold("2099-03-01"))
    );
    const [sample] = getReviewSampleReservations(
      reviewer,
      Temporal.Now.instant()
    );
    if (!sample) throw new Error("Expected a sample");

    const holdStatus = await run((sandbox) =>
      sandbox.status({ orderId: held.orderId, returnOutcome: "unknown" })
    );
    const sampleStatus = await run((sandbox) =>
      sandbox.status({ orderId: sample.orderId, returnOutcome: "unknown" })
    );

    expect(Option.getOrThrow(holdStatus)).toMatchObject({
      status: "created",
      paymentStatus: "not_started",
      reviewSandbox: true,
    });
    expect(Option.getOrThrow(sampleStatus)).toMatchObject({
      status: "fulfilled",
      paymentStatus: "paid",
      reviewSandbox: true,
    });
  });

  test("knows no other order", async () => {
    const status = await run((sandbox) =>
      sandbox.status({
        orderId: workspaceReservationIdSchema.make("review-sample-unknown"),
        returnOutcome: "unknown",
      })
    );

    expect(Option.isNone(status)).toBe(true);
  });

  test("tells an account's own sandbox orders from another account's", async () => {
    const held = await run((sandbox) =>
      sandbox.prepareHold(hold("2099-04-01"))
    );
    const [sample] = getReviewSampleReservations(
      reviewer,
      Temporal.Now.instant()
    );
    if (!sample) throw new Error("Expected a sample");

    const owns = (accountId: typeof reviewer, orderId: typeof held.orderId) =>
      run((sandbox) => sandbox.isOrderOf({ accountId, orderId }));

    expect(await owns(reviewer, held.orderId)).toBe(true);
    expect(await owns(reviewer, sample.orderId)).toBe(true);
    expect(await owns(otherReviewer, held.orderId)).toBe(false);
    expect(await owns(otherReviewer, sample.orderId)).toBe(false);
  });

  test("starts a new hold for a selection whose hold expired", async () => {
    const request = hold("2099-05-01", {
      bookedAt: Temporal.Now.instant().subtract({ hours: 1 }),
    });
    const expired = await run((sandbox) => sandbox.prepareHold(request));
    const next = await run((sandbox) =>
      sandbox.prepareHold({ ...request, bookedAt: Temporal.Now.instant() })
    );
    const status = await run((sandbox) =>
      sandbox.status({ orderId: expired.orderId, returnOutcome: "unknown" })
    );

    expect(next.orderId).not.toBe(expired.orderId);
    expect(Option.getOrThrow(status).status).toBe("expired");
  });
});
