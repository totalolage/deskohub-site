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

  const newAccountId = () => {
    const accountId = customerAccountIdSchema.make(crypto.randomUUID());
    accountIds.push(accountId);
    return accountId;
  };

  const draftInput = (
    authorAccountId: CustomerAccountId | null
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

  const readAccount = async (id: CustomerAccountId) => {
    const [row] = await postgres.db
      .select()
      .from(customerAccounts)
      .where(eq(customerAccounts.id, id))
      .pipe(Effect.runPromise);
    return row;
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

  test("records the author and creates its durable customer account", async () => {
    const author = newAccountId();

    const draft = await createDraft(draftInput(author));

    expect(await readAuthor(draft.id)).toBe(author);
    expect(await readAccount(author)).toMatchObject({
      id: author,
      deletedAt: null,
    });
  });

  test("reuses the author's existing customer account", async () => {
    const author = newAccountId();

    const first = await createDraft(draftInput(author));
    const second = await createDraft(draftInput(author));

    expect(await readAuthor(first.id)).toBe(author);
    expect(await readAuthor(second.id)).toBe(author);
  });

  const assignAuthor = (
    id: WorkspaceReservationId,
    authorAccountId: CustomerAccountId
  ) =>
    run(
      Effect.gen(function* () {
        const reservations = yield* WorkspaceReservationRepository;
        return yield* reservations.assignAuthor({ id, authorAccountId });
      })
    );

  test("makes the resuming account the author of a legacy unauthored draft", async () => {
    const author = newAccountId();
    const draft = await createDraft(draftInput(null));
    expect(await readAuthor(draft.id)).toBeNull();

    expect(await assignAuthor(draft.id, author)).toBe(author);

    expect(await readAuthor(draft.id)).toBe(author);
    expect(await readAccount(author)).toMatchObject({ deletedAt: null });
  });

  test("never replaces an established author", async () => {
    const author = newAccountId();
    const otherAccount = newAccountId();
    const draft = await createDraft(draftInput(author));

    expect(await assignAuthor(draft.id, otherAccount)).toBe(author);

    expect(await readAuthor(draft.id)).toBe(author);
    expect(await readAccount(otherAccount)).toBeUndefined();
  });

  test("records the author on a superseding replacement", async () => {
    const firstAuthor = newAccountId();
    const replacementAuthor = newAccountId();
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
    expect(await readAccount(replacementAuthor)).toMatchObject({
      deletedAt: null,
    });
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
    const author = newAccountId();

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
    const author = newAccountId();
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
    const author = newAccountId();
    const otherAuthor = newAccountId();
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

  test("rejects a selection key without an agent client", async () => {
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
          agent_selection_key
        ) values ($1, $2, 'draft', 'not_started', 'not_started', $3, 'en-US', $4)`,
        [
          `attempt:${crypto.randomUUID()}`,
          `customer-${crypto.randomUUID()}`,
          JSON.stringify({
            kind: "cowork",
            entryTier: "basic",
            coffee: false,
          }),
          agentSelectionKey,
        ]
      )
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "workspace_reservations_agent_selection_check",
    });
  });
});
