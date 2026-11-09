import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { InvoiceEmailDeliveryAudience } from "@/features/accounting/invoice-email-delivery";
import { invoiceIdSchema } from "@/features/accounting/manual-invoice";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type IInvoiceEmailDeliveryRepository,
  InvoiceEmailDeliveryRepository,
} from "./invoice-email-delivery.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const runRepository = <A>(
  operation: (
    repository: IInvoiceEmailDeliveryRepository
  ) => Effect.Effect<A, EffectDrizzleQueryError>
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const repository = yield* InvoiceEmailDeliveryRepository;
      return yield* operation(repository);
    }).pipe(
      Effect.provide(
        InvoiceEmailDeliveryRepository.Default.pipe(
          Layer.provide(
            Layer.succeed(
              WorkspaceDatabase,
              WorkspaceDatabase.make(testDatabase!.db)
            )
          )
        )
      )
    )
  );

// A manual invoice row carries no reservation reference; the encrypted
// document is opaque to delivery claims.
const insertInvoice = async () => {
  const sequence = 100_000 + Math.floor(Math.random() * 2_000_000_000);
  const result = await testDatabase!.pool.query<{ id: string }>(
    `insert into invoices
       (dotypos_customer_id, invoice_number, numbering_year, numbering_sequence,
        key_id, encrypted_document, issued_at)
     values ('delivery-claim-customer', $1, 2026, $2, 'K202608', '\\x00', '2026-06-01T10:00:00Z')
     returning id`,
    [`WS-FV-TEST-${crypto.randomUUID()}`, sequence]
  );
  return invoiceIdSchema.make(result.rows[0]!.id);
};

const readDelivery = async (
  invoiceId: string,
  audience: InvoiceEmailDeliveryAudience
) => {
  const result = await testDatabase!.pool.query<{
    state: string;
    attempt_count: number;
  }>(
    `select state, attempt_count from invoice_email_deliveries
     where invoice_id = $1 and audience = $2`,
    [invoiceId, audience]
  );
  return result.rows[0];
};

// Ages a delivery as if its worker had gone quiet for that many seconds.
const ageDelivery = async (
  invoiceId: string,
  audience: InvoiceEmailDeliveryAudience,
  seconds: number
) => {
  await testDatabase!.pool.query(
    `update invoice_email_deliveries
     set updated_at = updated_at - make_interval(secs => $3)
     where invoice_id = $1 and audience = $2`,
    [invoiceId, audience, seconds]
  );
};

const expireLease = (
  invoiceId: string,
  audience: InvoiceEmailDeliveryAudience
) => ageDelivery(invoiceId, audience, 60 * 60);

const acceptedAt = Temporal.Instant.from("2026-06-01T10:05:00Z");

describe.skipIf(!testDatabase)(
  "InvoiceEmailDeliveryRepository on disposable Postgres",
  () => {
    test("claims a new or failed delivery but not an accepted or in-flight one", async () => {
      const invoiceId = await insertInvoice();
      const claim = (repository: IInvoiceEmailDeliveryRepository) =>
        repository.claim({
          invoiceId,
          audience: "customer",
        });

      const outcomes = await runRepository((repository) =>
        Effect.gen(function* () {
          const first = yield* claim(repository);
          const whileProcessing = yield* claim(repository);
          yield* repository.markFailed({
            invoiceId,
            audience: "customer",
            attemptNumber: 1,
            failureCode: "email_send_failed",
          });
          const afterFailure = yield* claim(repository);
          yield* repository.markAccepted({
            invoiceId,
            audience: "customer",
            attemptNumber: 2,
            providerDeliveryId: EmailDeliveryIdSchema.make("email-1"),
            acceptedAt,
          });
          const afterAcceptance = yield* claim(repository);
          return { first, whileProcessing, afterFailure, afterAcceptance };
        })
      );

      expect(outcomes).toEqual({
        first: { attemptNumber: 1 },
        whileProcessing: null,
        afterFailure: { attemptNumber: 2 },
        afterAcceptance: null,
      });
      expect(await readDelivery(invoiceId, "customer")).toEqual({
        state: "accepted",
        attempt_count: 2,
      });
    });

    test("delivers both audiences of one invoice independently", async () => {
      const invoiceId = await insertInvoice();

      const claims = await Promise.all(
        Array.from({ length: 10 }, () =>
          runRepository((repository) =>
            repository.claim({
              invoiceId,
              audience: "customer",
            })
          )
        )
      );
      const outcomes = await runRepository((repository) =>
        Effect.gen(function* () {
          yield* repository.markAccepted({
            invoiceId,
            audience: "customer",
            attemptNumber: 1,
            providerDeliveryId: EmailDeliveryIdSchema.make("customer-email"),
            acceptedAt,
          });
          const customerAfterAcceptance = yield* repository.claim({
            invoiceId,
            audience: "customer",
          });
          const internal = yield* repository.claim({
            invoiceId,
            audience: "internal",
          });
          yield* repository.markFailed({
            invoiceId,
            audience: "internal",
            attemptNumber: 1,
            failureCode: "email_send_failed",
          });
          const internalRetry = yield* repository.claim({
            invoiceId,
            audience: "internal",
          });
          yield* repository.markAccepted({
            invoiceId,
            audience: "internal",
            attemptNumber: 2,
            providerDeliveryId: EmailDeliveryIdSchema.make("internal-email"),
            acceptedAt,
          });
          return { customerAfterAcceptance, internal, internalRetry };
        })
      );

      expect(claims.filter((claim) => claim !== null)).toEqual([
        { attemptNumber: 1 },
      ]);
      expect(outcomes).toEqual({
        customerAfterAcceptance: null,
        internal: { attemptNumber: 1 },
        internalRetry: { attemptNumber: 2 },
      });
      const rows = await testDatabase!.pool.query<{
        audience: InvoiceEmailDeliveryAudience;
        state: string;
        attempt_count: number;
      }>(
        `select audience, state, attempt_count from invoice_email_deliveries
         where invoice_id = $1 order by audience`,
        [invoiceId]
      );
      expect(rows.rows).toEqual([
        { audience: "customer", state: "accepted", attempt_count: 1 },
        { audience: "internal", state: "accepted", attempt_count: 2 },
      ]);
    });

    test("reclaims a stale processing delivery as the next attempt", async () => {
      const invoiceId = await insertInvoice();

      const outcomes = await runRepository((repository) =>
        Effect.gen(function* () {
          const first = yield* repository.claim({
            invoiceId,
            audience: "internal",
          });
          yield* Effect.promise(() => expireLease(invoiceId, "internal"));
          const stale = yield* repository.claim({
            invoiceId,
            audience: "internal",
          });
          return { first, stale };
        })
      );

      expect(outcomes).toEqual({
        first: { attemptNumber: 1 },
        stale: { attemptNumber: 2 },
      });
    });

    test("an explicit resend reclaims an accepted customer delivery", async () => {
      const invoiceId = await insertInvoice();

      const outcomes = await runRepository((repository) =>
        Effect.gen(function* () {
          yield* repository.claim({ invoiceId, audience: "customer" });
          yield* repository.markAccepted({
            invoiceId,
            audience: "customer",
            attemptNumber: 1,
            providerDeliveryId: EmailDeliveryIdSchema.make("email-1"),
            acceptedAt,
          });
          const resend = yield* repository.claimResend({ invoiceId });
          const whileResending = yield* repository.claimResend({ invoiceId });
          yield* Effect.promise(() => expireLease(invoiceId, "customer"));
          const staleResend = yield* repository.claimResend({ invoiceId });
          return { resend, whileResending, staleResend };
        })
      );

      // A stale resend keeps its attempt number, so the retried send reuses
      // the provider idempotency key derived from it.
      expect(outcomes).toEqual({
        resend: { attemptNumber: 2 },
        whileResending: null,
        staleResend: { attemptNumber: 2 },
      });
      expect(await readDelivery(invoiceId, "customer")).toEqual({
        state: "processing",
        attempt_count: 2,
      });
    });

    test("ignores terminal updates from a superseded attempt", async () => {
      const invoiceId = await insertInvoice();

      await runRepository((repository) =>
        Effect.gen(function* () {
          yield* repository.claim({ invoiceId, audience: "customer" });
          yield* Effect.promise(() => expireLease(invoiceId, "customer"));
          yield* repository.claim({ invoiceId, audience: "customer" });
          yield* repository.markAccepted({
            invoiceId,
            audience: "customer",
            attemptNumber: 1,
            providerDeliveryId: EmailDeliveryIdSchema.make("email-1"),
            acceptedAt,
          });
          yield* repository.markFailed({
            invoiceId,
            audience: "customer",
            attemptNumber: 1,
            failureCode: "email_send_failed",
          });
        })
      );

      expect(await readDelivery(invoiceId, "customer")).toEqual({
        state: "processing",
        attempt_count: 2,
      });
    });

    test("reports each requested invoice with missing audiences defaulted", async () => {
      const [undelivered, accepted, failed] = await Promise.all([
        insertInvoice(),
        insertInvoice(),
        insertInvoice(),
      ]);

      const statuses = await runRepository((repository) =>
        Effect.gen(function* () {
          for (const audience of ["customer", "internal"] as const) {
            yield* repository.claim({ invoiceId: accepted, audience });
            yield* repository.markAccepted({
              invoiceId: accepted,
              audience,
              attemptNumber: 1,
              providerDeliveryId: EmailDeliveryIdSchema.make(
                `${audience}-email`
              ),
              acceptedAt,
            });
          }
          yield* repository.claim({ invoiceId: failed, audience: "customer" });
          yield* repository.markFailed({
            invoiceId: failed,
            audience: "customer",
            attemptNumber: 1,
            failureCode: "pdf_render_failed",
          });
          return yield* repository.status([undelivered, accepted, failed]);
        })
      );

      expect(Object.fromEntries(statuses)).toEqual({
        [undelivered]: {
          customer: "missing",
          internal: "missing",
          needsAttention: true,
        },
        [accepted]: {
          customer: "accepted",
          internal: "accepted",
          needsAttention: false,
        },
        [failed]: {
          customer: "failed",
          internal: "missing",
          needsAttention: true,
        },
      });
      expect(
        await runRepository((repository) => repository.status([]))
      ).toEqual(new Map());
    });

    test("flags a processing delivery once its one-minute lease lets a claim reclaim it", async () => {
      const invoiceId = await insertInvoice();

      const outcomes = await runRepository((repository) =>
        Effect.gen(function* () {
          for (const audience of ["customer", "internal"] as const) {
            yield* repository.claim({ invoiceId, audience });
          }
          yield* Effect.promise(() => ageDelivery(invoiceId, "internal", 30));
          const inFlight = yield* repository.status([invoiceId]);
          const inFlightClaim = yield* repository.claim({
            invoiceId,
            audience: "internal",
          });
          yield* Effect.promise(() => ageDelivery(invoiceId, "internal", 60));
          const stale = yield* repository.status([invoiceId]);
          const staleClaim = yield* repository.claim({
            invoiceId,
            audience: "internal",
          });
          return {
            inFlight: inFlight.get(invoiceId),
            inFlightClaim,
            stale: stale.get(invoiceId),
            staleClaim,
          };
        })
      );

      expect(outcomes).toEqual({
        inFlight: {
          customer: "processing",
          internal: "processing",
          needsAttention: false,
        },
        inFlightClaim: null,
        stale: {
          customer: "processing",
          internal: "processing",
          needsAttention: true,
        },
        staleClaim: { attemptNumber: 2 },
      });
    });
  }
);
