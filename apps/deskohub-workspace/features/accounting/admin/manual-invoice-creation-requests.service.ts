import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { WorkspaceDatabase } from "@/db/database.service";
import { manualInvoiceCreationRequests } from "@/db/schema";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import {
  type AccountingSnapshotKeyError,
  AccountingSnapshotKeyService,
} from "../backend/accounting-snapshot-key.service";

export type ManualInvoiceCreationClaim =
  | { readonly kind: "claimed" }
  | { readonly kind: "completed" }
  | { readonly kind: "in-progress" }
  | { readonly kind: "mismatch" };

export class ManualInvoiceCreationRequestError extends Data.TaggedError(
  "ManualInvoiceCreationRequestError"
)<{ readonly message: string }> {}

interface IManualInvoiceCreationRequests {
  readonly withNewCustomerLock: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | EffectDrizzleQueryError | SqlError, R>;
  readonly withLock: <A, E, R>(
    invoiceId: InvoiceId,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | EffectDrizzleQueryError | SqlError, R>;
  readonly claim: (input: {
    readonly invoiceId: InvoiceId;
    readonly normalizedRequestJson: string;
  }) => Effect.Effect<
    ManualInvoiceCreationClaim,
    AccountingSnapshotKeyError | EffectDrizzleQueryError
  >;
  readonly complete: (
    invoiceId: InvoiceId
  ) => Effect.Effect<
    void,
    ManualInvoiceCreationRequestError | EffectDrizzleQueryError
  >;
}

export class ManualInvoiceCreationRequests extends Context.Service<
  ManualInvoiceCreationRequests,
  IManualInvoiceCreationRequests
>()("@deskohub-workspace/accounting/ManualInvoiceCreationRequests") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const keys = yield* AccountingSnapshotKeyService;

      // ponytail: one global new-customer lock avoids putting email PII in SQL;
      // shard by a keyed normalized-email digest if admin throughput matters.
      const withNewCustomerLock: IManualInvoiceCreationRequests["withNewCustomerLock"] =
        (effect) =>
          db.transaction((tx) =>
            tx
              .execute(
                sql`select pg_advisory_xact_lock(hashtext('manual-invoice-new-customer'), hashtext('global'))`
              )
              .pipe(Effect.andThen(effect))
          );

      const withLock: IManualInvoiceCreationRequests["withLock"] = (
        invoiceId,
        effect
      ) =>
        db.transaction((tx) =>
          tx
            .execute(
              sql`select pg_advisory_xact_lock(hashtext('manual-invoice-creation'), hashtext(${invoiceId}))`
            )
            .pipe(Effect.andThen(effect))
        );

      const claim: IManualInvoiceCreationRequests["claim"] = (input) =>
        Effect.gen(function* () {
          const activeKey = yield* keys.getActive;
          const requestDigest = getManualInvoiceCreationRequestDigest(
            input.normalizedRequestJson,
            activeKey.secret
          );
          const claimedAt = Temporal.Now.instant();
          const inserted = yield* db
            .insert(manualInvoiceCreationRequests)
            .values({
              invoiceId: input.invoiceId,
              keyId: activeKey.id,
              requestDigest,
              claimedAt,
            })
            .onConflictDoNothing()
            .returning({ invoiceId: manualInvoiceCreationRequests.invoiceId });
          if (inserted.length > 0) return { kind: "claimed" } as const;

          const [existing] = yield* db
            .select({
              keyId: manualInvoiceCreationRequests.keyId,
              requestDigest: manualInvoiceCreationRequests.requestDigest,
              completedAt: manualInvoiceCreationRequests.completedAt,
            })
            .from(manualInvoiceCreationRequests)
            .where(eq(manualInvoiceCreationRequests.invoiceId, input.invoiceId))
            .limit(1);
          if (!existing) return { kind: "in-progress" } as const;

          const existingKey = yield* keys.getById(existing.keyId);
          const retryDigest = getManualInvoiceCreationRequestDigest(
            input.normalizedRequestJson,
            existingKey.secret
          );
          if (!requestDigestsEqual(existing.requestDigest, retryDigest)) {
            return { kind: "mismatch" } as const;
          }
          if (existing.completedAt !== null) {
            return { kind: "completed" } as const;
          }

          const reclaimed = yield* db
            .update(manualInvoiceCreationRequests)
            .set({ claimedAt })
            .where(
              and(
                eq(manualInvoiceCreationRequests.invoiceId, input.invoiceId),
                eq(
                  manualInvoiceCreationRequests.requestDigest,
                  existing.requestDigest
                ),
                isNull(manualInvoiceCreationRequests.completedAt),
                lte(
                  manualInvoiceCreationRequests.claimedAt,
                  claimedAt.subtract({ minutes: 1 })
                )
              )
            )
            .returning({ invoiceId: manualInvoiceCreationRequests.invoiceId });
          return reclaimed.length > 0
            ? ({ kind: "claimed" } as const)
            : ({ kind: "in-progress" } as const);
        }).pipe(Effect.withTracerEnabled(false));

      const complete = Effect.fn("ManualInvoiceCreationRequests.complete")(
        (invoiceId: InvoiceId) =>
          db
            .update(manualInvoiceCreationRequests)
            .set({ completedAt: Temporal.Now.instant() })
            .where(
              and(
                eq(manualInvoiceCreationRequests.invoiceId, invoiceId),
                isNull(manualInvoiceCreationRequests.completedAt)
              )
            )
            .returning({ invoiceId: manualInvoiceCreationRequests.invoiceId })
            .pipe(
              Effect.flatMap((rows) =>
                rows.length > 0
                  ? Effect.void
                  : new ManualInvoiceCreationRequestError({
                      message:
                        "The claimed invoice creation request could not be completed.",
                    })
              )
            )
      );

      return {
        claim,
        complete,
        withLock,
        withNewCustomerLock,
      } satisfies IManualInvoiceCreationRequests;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.merge(
        WorkspaceDatabase.Default,
        AccountingSnapshotKeyService.Default
      )
    )
  );
}

export const getManualInvoiceCreationRequestDigest = (
  normalizedRequestJson: string,
  secret: string
) =>
  createHmac("sha256", secret)
    .update(normalizedRequestJson, "utf8")
    .digest("base64url");

const requestDigestsEqual = (left: string, right: string) => {
  const leftBytes = Buffer.from(left, "base64url");
  const rightBytes = Buffer.from(right, "base64url");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
};
