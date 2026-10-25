import "@/shared/polyfills/temporal";

import type { EmailDeliveryId } from "@deskohub/email";
import { and, eq, inArray, lt, or, type SQL, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { invoiceEmailDeliveries } from "@/db/schema";
import type {
  InvoiceDeliveryStatus,
  InvoiceEmailDeliveryAudience,
  InvoiceEmailDeliveryFailureCode,
} from "@/features/accounting/invoice-email-delivery";
import type { InvoiceId } from "@/features/accounting/manual-invoice";

export interface InvoiceEmailDeliveryClaim {
  readonly attemptNumber: number;
}

export interface InvoiceDeliverySummary
  extends Readonly<
    Record<InvoiceEmailDeliveryAudience, InvoiceDeliveryStatus>
  > {
  /** An audience is missing or failed, or its delivery outlived its lease. */
  readonly needsAttention: boolean;
}

export interface IInvoiceEmailDeliveryRepository {
  readonly claim: (input: {
    readonly invoiceId: string;
    readonly audience: InvoiceEmailDeliveryAudience;
  }) => Effect.Effect<
    InvoiceEmailDeliveryClaim | null,
    EffectDrizzleQueryError
  >;
  readonly claimResend: (input: {
    readonly invoiceId: string;
  }) => Effect.Effect<
    InvoiceEmailDeliveryClaim | null,
    EffectDrizzleQueryError
  >;
  readonly markAccepted: (input: {
    readonly invoiceId: string;
    readonly audience: InvoiceEmailDeliveryAudience;
    readonly attemptNumber: number;
    readonly providerDeliveryId: EmailDeliveryId;
    readonly acceptedAt: Temporal.Instant;
  }) => Effect.Effect<void, EffectDrizzleQueryError>;
  readonly markFailed: (input: {
    readonly invoiceId: string;
    readonly audience: InvoiceEmailDeliveryAudience;
    readonly attemptNumber: number;
    readonly failureCode: InvoiceEmailDeliveryFailureCode;
  }) => Effect.Effect<void, EffectDrizzleQueryError>;
  /** Summarizes every requested invoice, including one with no delivery yet. */
  readonly status: (
    invoiceIds: readonly InvoiceId[]
  ) => Effect.Effect<
    ReadonlyMap<InvoiceId, InvoiceDeliverySummary>,
    EffectDrizzleQueryError
  >;
}

export class InvoiceEmailDeliveryRepository extends Context.Service<
  InvoiceEmailDeliveryRepository,
  IInvoiceEmailDeliveryRepository
>()("@deskohub-workspace/accounting/InvoiceEmailDeliveryRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      return {
        claim: Effect.fn("InvoiceEmailDeliveryRepository.claim")(function* ({
          audience,
          invoiceId,
        }) {
          const now = Temporal.Now.instant();
          const [claimed] = yield* db
            .insert(invoiceEmailDeliveries)
            .values({
              invoiceId,
              audience,
              state: "processing",
              attemptCount: 1,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [
                invoiceEmailDeliveries.invoiceId,
                invoiceEmailDeliveries.audience,
              ],
              set: {
                state: "processing",
                attemptCount: sql`${invoiceEmailDeliveries.attemptCount} + 1`,
                providerDeliveryId: null,
                failureCode: null,
                acceptedAt: null,
                updatedAt: now,
              },
              setWhere: or(
                eq(invoiceEmailDeliveries.state, "failed"),
                isStaleProcessing()
              ),
            })
            .returning({
              attemptNumber: invoiceEmailDeliveries.attemptCount,
            });

          return claimed ?? null;
        }),
        claimResend: Effect.fn("InvoiceEmailDeliveryRepository.claimResend")(
          function* ({ invoiceId }) {
            const now = Temporal.Now.instant();
            const [claimed] = yield* db
              .insert(invoiceEmailDeliveries)
              .values({
                invoiceId,
                audience: "customer",
                state: "processing",
                attemptCount: 1,
                updatedAt: now,
              })
              .onConflictDoUpdate({
                target: [
                  invoiceEmailDeliveries.invoiceId,
                  invoiceEmailDeliveries.audience,
                ],
                set: {
                  state: "processing",
                  attemptCount: sql`case when ${invoiceEmailDeliveries.state} = 'processing' then ${invoiceEmailDeliveries.attemptCount} else ${invoiceEmailDeliveries.attemptCount} + 1 end`,
                  failureCode: null,
                  updatedAt: now,
                },
                setWhere: or(
                  eq(invoiceEmailDeliveries.state, "accepted"),
                  eq(invoiceEmailDeliveries.state, "failed"),
                  isStaleProcessing()
                ),
              })
              .returning({
                attemptNumber: invoiceEmailDeliveries.attemptCount,
              });

            return claimed ?? null;
          }
        ),
        markAccepted: Effect.fn("InvoiceEmailDeliveryRepository.markAccepted")(
          function* (input) {
            yield* db
              .update(invoiceEmailDeliveries)
              .set({
                state: "accepted",
                providerDeliveryId: input.providerDeliveryId,
                failureCode: null,
                acceptedAt: input.acceptedAt,
                updatedAt: input.acceptedAt,
              })
              .where(
                and(
                  eq(invoiceEmailDeliveries.invoiceId, input.invoiceId),
                  eq(invoiceEmailDeliveries.audience, input.audience),
                  eq(invoiceEmailDeliveries.state, "processing"),
                  eq(invoiceEmailDeliveries.attemptCount, input.attemptNumber)
                )
              );
          }
        ),
        markFailed: Effect.fn("InvoiceEmailDeliveryRepository.markFailed")(
          function* (input) {
            yield* db
              .update(invoiceEmailDeliveries)
              .set({
                state: "failed",
                failureCode: input.failureCode,
                updatedAt: Temporal.Now.instant(),
              })
              .where(
                and(
                  eq(invoiceEmailDeliveries.invoiceId, input.invoiceId),
                  eq(invoiceEmailDeliveries.audience, input.audience),
                  eq(invoiceEmailDeliveries.state, "processing"),
                  eq(invoiceEmailDeliveries.attemptCount, input.attemptNumber)
                )
              );
          }
        ),
        status: Effect.fn("InvoiceEmailDeliveryRepository.status")(
          function* (invoiceIds) {
            const rows =
              invoiceIds.length === 0
                ? []
                : yield* db
                    .select({
                      invoiceId: invoiceEmailDeliveries.invoiceId,
                      audience: invoiceEmailDeliveries.audience,
                      state: invoiceEmailDeliveries.state,
                      stale: sql<boolean>`${isStaleProcessing()}`,
                    })
                    .from(invoiceEmailDeliveries)
                    .where(
                      inArray(invoiceEmailDeliveries.invoiceId, invoiceIds)
                    );
            const deliveriesByInvoice = Map.groupBy(
              rows,
              ({ invoiceId }) => invoiceId
            );
            return new Map(
              invoiceIds.map((invoiceId) => {
                const deliveries = deliveriesByInvoice.get(invoiceId) ?? [];
                const statusOf = (
                  audience: InvoiceEmailDeliveryAudience
                ): InvoiceDeliveryStatus =>
                  deliveries.find((delivery) => delivery.audience === audience)
                    ?.state ?? "missing";
                const customer = statusOf("customer");
                const internal = statusOf("internal");
                const summary: InvoiceDeliverySummary = {
                  customer,
                  internal,
                  needsAttention:
                    deliveries.some(({ stale }) => stale) ||
                    [customer, internal].some(
                      (status) => status === "missing" || status === "failed"
                    ),
                };
                return [invoiceId, summary] as const;
              })
            );
          }
        ),
      } satisfies IInvoiceEmailDeliveryRepository;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}

/** How long a claimed delivery stays processing before another worker may reclaim it. */
const processingLease = Temporal.Duration.from({ minutes: 1 });

/** Matches a processing delivery whose claim outlived its lease. */
const isStaleProcessing = (): SQL =>
  sql`(${eq(invoiceEmailDeliveries.state, "processing")} and ${lt(
    invoiceEmailDeliveries.updatedAt,
    Temporal.Now.instant().subtract(processingLease)
  )})`;
