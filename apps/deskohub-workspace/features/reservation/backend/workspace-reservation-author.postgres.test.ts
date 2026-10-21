import "@/shared/testing/workspace-test-env";

import { afterEach, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { eq, inArray } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { customerAccounts, workspaceReservations } from "@/db/schema";
import { customerAgentClientIdSchema } from "@/features/account";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import {
  checkoutAttemptKeySchema,
  checkoutSessionKeySchema,
} from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { agentSelectionKeySchema } from "./booking-agent";
import {
  type CreateWorkspaceReservationDraftInput,
  WorkspaceReservationRepository,
} from "./workspace-reservation.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)("Reservation authors on Postgres", () => {
  const postgres = testDatabase!;
  const reservationIds: WorkspaceReservationId[] = [];
  const accountIds: CustomerAccountId[] = [];

  const run = <A, E>(
    effect: Effect.Effect<A, E, WorkspaceReservationRepository>
  ) =>
    effect.pipe(
      Effect.provide(
        WorkspaceReservationRepository.Default.pipe(
          Layer.provide(postgres.layer)
        )
      ),
      Effect.runPromise
    );

  /** A signed-in account, whose customer account sign-up created. */
  const newAccountId = async () => {
    const accountId = customerAccountIdSchema.make(crypto.randomUUID());
    accountIds.push(accountId);
    await postgres.db
      .insert(customerAccounts)
      .values({ id: accountId })
      .pipe(Effect.runPromise);
    return accountId;
  };

  const draftInput = (
    authorAccountId: CustomerAccountId
  ): CreateWorkspaceReservationDraftInput => {
    const checkoutSessionKey = checkoutSessionKeySchema.make(
      `session:${crypto.randomUUID()}`
    );
    const checkoutAttemptKey = checkoutAttemptKeySchema.make(
      `attempt:${crypto.randomUUID()}`
    );
    return {
      checkoutSessionKey,
      checkoutAttemptKey,
      dotyposCustomerId: DotyposCustomerIdSchema.make(
        `customer-${crypto.randomUUID()}`
      ),
      authorAccountId,
      reservationPurpose: "personal",
      reservationDetails: { kind: "cowork", entryTier: "basic", coffee: false },
      locale: "en-US",
      checkoutSessionLockKey: BigInt(Math.floor(Math.random() * 2 ** 48)),
      acceptedCheckoutSessionKeys: [checkoutSessionKey],
      acceptedCheckoutAttemptKeys: [checkoutAttemptKey],
    };
  };

  const createDraft = (input: CreateWorkspaceReservationDraftInput) =>
    run(
      Effect.gen(function* () {
        const reservations = yield* WorkspaceReservationRepository;
        return yield* reservations.createDraft(input);
      })
    ).then((draft) => {
      reservationIds.push(draft.id);
      return draft;
    });

  const readAuthor = async (id: WorkspaceReservationId) => {
    const [row] = await postgres.db
      .select({ authorAccountId: workspaceReservations.authorAccountId })
      .from(workspaceReservations)
      .where(eq(workspaceReservations.id, id))
      .pipe(Effect.runPromise);
    return row?.authorAccountId;
  };

  afterEach(async () => {
    if (reservationIds.length > 0) {
      await postgres.db
        .delete(workspaceReservations)
        .where(inArray(workspaceReservations.id, reservationIds))
        .pipe(Effect.runPromise);
      reservationIds.length = 0;
    }
    if (accountIds.length > 0) {
      await postgres.db
        .delete(customerAccounts)
        .where(inArray(customerAccounts.id, accountIds))
        .pipe(Effect.runPromise);
      accountIds.length = 0;
    }
  });

  test("records the signed-in account as the author", async () => {
    const author = await newAccountId();

    const draft = await createDraft(draftInput(author));

    expect(await readAuthor(draft.id)).toBe(author);
  });

  test("refuses an author without a customer account", async () => {
    const author = customerAccountIdSchema.make(crypto.randomUUID());

    const created = await run(
      Effect.gen(function* () {
        const reservations = yield* WorkspaceReservationRepository;
        return yield* reservations.createDraft(draftInput(author));
      }).pipe(Effect.result)
    );

    expect(created._tag).toBe("Failure");
  });

  test("records the author on a superseding replacement", async () => {
    const firstAuthor = await newAccountId();
    const replacementAuthor = await newAccountId();
    const superseded = await createDraft(draftInput(firstAuthor));
    await postgres.db
      .update(workspaceReservations)
      .set({
        reservationState: "cancelling",
        dotyposReservationId: `dotypos-${crypto.randomUUID()}` as never,
      })
      .where(eq(workspaceReservations.id, superseded.id))
      .pipe(Effect.runPromise);

    const replacementDraft = await run(
      Effect.gen(function* () {
        const reservations = yield* WorkspaceReservationRepository;
        return yield* reservations.completeSupersessionAndCreateDraft({
          cancelledReservationId: superseded.id,
          cancelledAt: Temporal.Now.instant(),
          replacement: draftInput(replacementAuthor),
        });
      })
    );
    reservationIds.push(replacementDraft.id);

    expect(await readAuthor(replacementDraft.id)).toBe(replacementAuthor);
  });
  const agentClientId = customerAgentClientIdSchema.make(
    "https://assistant.example/oauth-client.json"
  );

  const readAgentBooking = async (id: WorkspaceReservationId) => {
    const [row] = await postgres.db
      .select({
        agentClientId: workspaceReservations.agentClientId,
        agentSelectionKey: workspaceReservations.agentSelectionKey,
      })
      .from(workspaceReservations)
      .where(eq(workspaceReservations.id, id))
      .pipe(Effect.runPromise);
    return row;
  };

  test("records the agent client that started a draft, and none for the site", async () => {
    const author = await newAccountId();

    const agentDraft = await createDraft({
      ...draftInput(author),
      agentClientId,
    });
    const siteDraft = await createDraft(draftInput(author));

    expect(await readAgentBooking(agentDraft.id)).toEqual({
      agentClientId,
      agentSelectionKey: null,
    });
    expect(await readAgentBooking(siteDraft.id)).toEqual({
      agentClientId: null,
      agentSelectionKey: null,
    });
  });

  test("stores the selection key on supersession replacements", async () => {
    const author = await newAccountId();
    const agentSelectionKey = agentSelectionKeySchema.make(
      `selection:${crypto.randomUUID()}`
    );
    const superseded = await createDraft({
      ...draftInput(author),
      agentClientId,
    });
    await postgres.db
      .update(workspaceReservations)
      .set({
        reservationState: "cancelling",
        dotyposReservationId: `dotypos-${crypto.randomUUID()}` as never,
      })
      .where(eq(workspaceReservations.id, superseded.id))
      .pipe(Effect.runPromise);

    const replacementDraft = await run(
      Effect.gen(function* () {
        const reservations = yield* WorkspaceReservationRepository;
        return yield* reservations.completeSupersessionAndCreateDraft({
          cancelledReservationId: superseded.id,
          cancelledAt: Temporal.Now.instant(),
          replacement: {
            ...draftInput(author),
            agentClientId,
            agentSelectionKey,
          },
        });
      })
    );
    reservationIds.push(replacementDraft.id);

    expect(await readAgentBooking(replacementDraft.id)).toEqual({
      agentClientId,
      agentSelectionKey,
    });
  });

  test("finds an agent booking request's latest two reservations, newest first", async () => {
    const author = await newAccountId();
    const otherAuthor = await newAccountId();
    const selectionKey = agentSelectionKeySchema.make(
      `selection:${crypto.randomUUID()}`
    );
    const otherSelectionKey = agentSelectionKeySchema.make(
      `selection:${crypto.randomUUID()}`
    );
    const firstCreatedAt = Temporal.Instant.from("1990-01-01T00:00:00Z");

    const createSelectedDraft = async (input: {
      readonly authorAccountId: CustomerAccountId;
      readonly agentSelectionKey: typeof selectionKey;
      readonly createdAt: Temporal.Instant;
    }) => {
      const draft = await createDraft({
        ...draftInput(input.authorAccountId),
        agentClientId,
        agentSelectionKey: input.agentSelectionKey,
      });
      await postgres.db
        .update(workspaceReservations)
        .set({ createdAt: input.createdAt })
        .where(eq(workspaceReservations.id, draft.id))
        .pipe(Effect.runPromise);
      return draft;
    };

    const first = await createSelectedDraft({
      authorAccountId: author,
      agentSelectionKey: selectionKey,
      createdAt: firstCreatedAt,
    });
    const second = await createSelectedDraft({
      authorAccountId: author,
      agentSelectionKey: selectionKey,
      createdAt: firstCreatedAt.add({ minutes: 1 }),
    });
    const third = await createSelectedDraft({
      authorAccountId: author,
      agentSelectionKey: selectionKey,
      createdAt: firstCreatedAt.add({ minutes: 2 }),
    });
    await createSelectedDraft({
      authorAccountId: author,
      agentSelectionKey: otherSelectionKey,
      createdAt: firstCreatedAt.add({ minutes: 3 }),
    });
    await createSelectedDraft({
      authorAccountId: otherAuthor,
      agentSelectionKey: selectionKey,
      createdAt: firstCreatedAt.add({ minutes: 4 }),
    });

    const latest = await run(
      Effect.gen(function* () {
        const reservations = yield* WorkspaceReservationRepository;
        return yield* reservations.findLatestByAgentSelectionKey({
          authorAccountId: author,
          agentSelectionKey: selectionKey,
        });
      })
    );

    expect(latest.map(({ id }) => id)).toEqual([third.id, second.id]);
    expect(latest.map(({ id }) => id)).not.toContain(first.id);
  });

  test("finds only the account's holds through one agent client that a new booking may supersede", async () => {
    const author = await newAccountId();
    const otherAuthor = await newAccountId();
    const otherAgentClientId = customerAgentClientIdSchema.make(
      "https://other-assistant.example/oauth-client.json"
    );

    const createReservation = async (input: {
      readonly authorAccountId: CustomerAccountId;
      readonly agentClientId?: typeof agentClientId;
      readonly reservationState: "draft" | "held" | "confirmed";
      readonly paymentState: "not_started" | "failed" | "pending" | "paid";
    }) => {
      const draft = await createDraft({
        ...draftInput(input.authorAccountId),
        agentClientId: input.agentClientId,
      });
      if (input.reservationState !== "draft") {
        await postgres.db
          .update(workspaceReservations)
          .set({
            reservationState: input.reservationState,
            paymentState: input.paymentState,
            dotyposReservationId: `dotypos-${crypto.randomUUID()}` as never,
            paidAt:
              input.paymentState === "paid" ? Temporal.Now.instant() : null,
          })
          .where(eq(workspaceReservations.id, draft.id))
          .pipe(Effect.runPromise);
      }
      return draft;
    };

    const unpaidHold = await createReservation({
      authorAccountId: author,
      agentClientId,
      reservationState: "held",
      paymentState: "not_started",
    });
    const failedPaymentHold = await createReservation({
      authorAccountId: author,
      agentClientId,
      reservationState: "held",
      paymentState: "failed",
    });
    await createReservation({
      authorAccountId: author,
      agentClientId,
      reservationState: "held",
      paymentState: "pending",
    });
    await createReservation({
      authorAccountId: author,
      agentClientId,
      reservationState: "confirmed",
      paymentState: "paid",
    });
    await createReservation({
      authorAccountId: author,
      agentClientId,
      reservationState: "draft",
      paymentState: "not_started",
    });
    await createReservation({
      authorAccountId: author,
      agentClientId: otherAgentClientId,
      reservationState: "held",
      paymentState: "not_started",
    });
    await createReservation({
      authorAccountId: otherAuthor,
      agentClientId,
      reservationState: "held",
      paymentState: "not_started",
    });
    await createReservation({
      authorAccountId: author,
      reservationState: "held",
      paymentState: "not_started",
    });

    const holds = await run(
      Effect.gen(function* () {
        const reservations = yield* WorkspaceReservationRepository;
        return yield* reservations.findSupersedableByAgentClient({
          authorAccountId: author,
          agentClientId,
        });
      })
    );

    expect(holds.map(({ id }) => id).sort()).toEqual(
      [unpaidHold.id, failedPaymentHold.id].sort()
    );
  });

  test("rejects a selection key without an agent client", async () => {
    const author = await newAccountId();
    const agentSelectionKey = agentSelectionKeySchema.make(
      `selection:${crypto.randomUUID()}`
    );

    await expect(
      postgres.pool.query(
        `insert into workspace_reservations (
          checkout_attempt_key,
          dotypos_customer_id,
          reservation_state,
          payment_state,
          fulfillment_state,
          reservation_details,
          locale,
          author_account_id,
          agent_selection_key
        ) values ($1, $2, 'draft', 'not_started', 'not_started', $3, 'en-US', $4, $5)`,
        [
          `attempt:${crypto.randomUUID()}`,
          `customer-${crypto.randomUUID()}`,
          JSON.stringify({
            kind: "cowork",
            entryTier: "basic",
            coffee: false,
          }),
          author,
          agentSelectionKey,
        ]
      )
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "workspace_reservations_agent_selection_check",
    });
  });
});
