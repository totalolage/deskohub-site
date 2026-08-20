import type { EmailDeliveryId } from "@deskohub/email";
import { and, eq, lt, or, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { invoiceEmailDeliveries } from "@/db/schema";
import type {
  InvoiceEmailDeliveryAudience,
  InvoiceEmailDeliveryFailureCode,
} from "@/features/accounting/invoice-email-delivery";

export interface InvoiceEmailDeliveryClaim {
  readonly attemptNumber: number;
}

export interface IInvoiceEmailDeliveryRepository {
  readonly claim: (input: {
    readonly invoiceId: string;
    readonly audience: InvoiceEmailDeliveryAudience;
    readonly staleProcessingBefore: Temporal.Instant;
  }) => Effect.Effect<
    InvoiceEmailDeliveryClaim | null,
    EffectDrizzleQueryError
  >;
  readonly claimResend: (input: {
    readonly invoiceId: string;
    readonly staleProcessingBefore: Temporal.Instant;
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
          staleProcessingBefore,
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
                and(
                  eq(invoiceEmailDeliveries.state, "processing"),
                  lt(invoiceEmailDeliveries.updatedAt, staleProcessingBefore)
                )
              ),
            })
            .returning({
              attemptNumber: invoiceEmailDeliveries.attemptCount,
            });

          return claimed ?? null;
        }),
        claimResend: Effect.fn("InvoiceEmailDeliveryRepository.claimResend")(
          function* ({ invoiceId, staleProcessingBefore }) {
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
                  and(
                    eq(invoiceEmailDeliveries.state, "processing"),
                    lt(invoiceEmailDeliveries.updatedAt, staleProcessingBefore)
                  )
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
      } satisfies IInvoiceEmailDeliveryRepository;
    })
  );
}
