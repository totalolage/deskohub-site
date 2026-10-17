import "@/shared/testing/workspace-test-env";

import { afterEach, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { eq, inArray } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { customerAccounts, workspaceReservations } from "@/db/schema";
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

  test("leaves a guest reservation without an author", async () => {
    const draft = await createDraft(draftInput(null));

    expect(await readAuthor(draft.id)).toBeNull();
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

  test("makes the signed-in account the author of a guest draft", async () => {
    const author = newAccountId();
    const draft = await createDraft(draftInput(null));

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
});
