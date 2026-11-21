import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { CustomerAccountId } from "@/features/account/customer-account";
import {
  accountingSnapshotKeyIdSchema,
  workspaceAccountingSupplier,
} from "@/features/accounting/accounting-document-snapshot";
import { AccountingDocumentSnapshots } from "@/features/accounting/backend/accounting-document-snapshots";
import { AccountingSnapshotKeyService } from "@/features/accounting/backend/accounting-snapshot-key.service";
import { testAccountingStorage } from "@/features/accounting/backend/accounting-storage.test-utils";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { orderIdSchema } from "@/features/order";
import {
  defaultReservationBillingSelection,
  type ReservationBillingSelection,
} from "@/features/reservation/reservation-billing";
import { WithdrawalRepository } from "@/features/withdrawal/backend/withdrawal.repository";
import { currencyCZK } from "@/shared/money/currencies";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import type { PassTier } from "../pass-offer";
import { getUnlimitedPassEndDate } from "../unlimited-pass";
import { requireUnlimitedPassWindow } from "./unlimited-pass-orders";
import { UnlimitedPassWithdrawals } from "./unlimited-pass-withdrawals";

const testDatabase = await createWorkspacePostgresSuiteDatabase(
  "unlimited_pass_withdrawals"
);
const paidAt = "2027-03-24T12:00:00Z";
const beforeStart = Temporal.Instant.from("2027-03-26T22:55:00Z");
// The UTC date is still March 27, but the second service day has started.
const secondDay = Temporal.Instant.from("2027-03-27T23:20:00Z");
const amount = currencyCZK(300_050);
const dotyposCustomerId = DotyposCustomerIdSchema.make("1");
const key = {
  id: accountingSnapshotKeyIdSchema.make("WITHDRAWAL_TEST"),
  secret: "synthetic pass withdrawal accounting key",
};

afterAll(() => testDatabase?.close());

describe.skipIf(!testDatabase)("Unlimited pass withdrawals on Postgres", () => {
  if (!testDatabase) return;
  const { pool } = testDatabase;
  const accounting = testAccountingStorage(
    testDatabase.layer,
    Layer.succeed(AccountingSnapshotKeyService, {
      getActive: Effect.succeed(key),
      getById: () => Effect.succeed(key),
    })
  );
  const layer = Layer.mergeAll(
    UnlimitedPassWithdrawals.Default,
    WithdrawalRepository.Default
  ).pipe(Layer.provideMerge(Layer.merge(testDatabase.layer, accounting)));

  const run = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      | UnlimitedPassWithdrawals
      | WithdrawalRepository
      | WorkspaceDatabase
      | AccountingDocumentSnapshots
    >
  ) => Effect.runPromise(effect.pipe(Effect.provide(layer)));

  const seedPass = async (
    paid = amount,
    billing: ReservationBillingSelection = defaultReservationBillingSelection,
    evidence: {
      readonly acceptedAt?: string;
      readonly earlyPerformanceConsent?: boolean;
      readonly deliveredAt?: string | null;
      readonly purchasedAt?: string;
      readonly startDate?: string;
      readonly tier?: PassTier;
    } = {}
  ) => {
    const {
      purchasedAt = paidAt,
      acceptedAt = purchasedAt,
      earlyPerformanceConsent = true,
      deliveredAt = "2027-03-26T20:00:00Z",
      startDate = "2027-03-27",
      tier = "reserved-desk",
    } = evidence;
    const validFrom = plainDateStringSchema.make(startDate);
    const validUntil = getUnlimitedPassEndDate(validFrom);
    const buyer = crypto.randomUUID() as CustomerAccountId;
    const holder = crypto.randomUUID() as CustomerAccountId;
    const id = orderIdSchema.make(crypto.randomUUID());
    const attempt = paymentAttemptIdSchema.make(crypto.randomUUID());
    const internal = paid.value === 0;
    await pool.query("insert into customer_accounts (id) values ($1), ($2)", [
      buyer,
      holder,
    ]);
    await pool.query(
      `insert into orders (id, kind, dotypos_customer_id, payment_state,
         fulfillment_state, active_payment_attempt_id, paid_at, fulfilled_at)
       values ($1, 'pass-purchase', '1', 'paid', 'fulfilled', $2, $3, $3)`,
      [id, attempt, purchasedAt]
    );
    await pool.query(
      `insert into payment_attempts (id, order_id, provider, provider_order_id,
         state, amount_value, amount_exponent, currency)
       values ($1, $2, $3, $4, 'paid', $5, 2, 'CZK')`,
      [
        attempt,
        id,
        internal ? "internal" : "nexi",
        internal ? null : attempt,
        paid.value,
      ]
    );
    await pool.query(
      `insert into pass_purchases (id, buyer_account_id, holder_account_id, product,
         tier, status, valid_from, valid_until, quote, locale, created_at,
         buyer_confirmation_delivered_at, unlimited_coffee)
       values ($1, $2, $3, 'unlimited', $4, 'active',
         $5, $6, '{}', 'en-US', $7, $8, $9)`,
      [
        id,
        buyer,
        holder,
        tier,
        validFrom,
        validUntil,
        purchasedAt,
        deliveredAt,
        tier === "open-space" ? false : null,
      ]
    );
    await pool.query(
      `insert into workspace_reservations (
         checkout_attempt_key, dotypos_customer_id, dotypos_reservation_id,
         author_account_id, reservation_state, payment_state, fulfillment_state,
         reservation_details, locale, pass_id, service_date, pass_day_table_id,
         paid_at, fulfilled_at)
       select uuid_generate_v7(), '1', uuid_generate_v7()::text, $2,
         'confirmed', 'paid', 'fulfilled', '{}', 'en-US', $1,
         $4::date + day, '9', $3, $3
       from generate_series(0, 29) day`,
      [id, buyer, purchasedAt, validFrom]
    );
    await pool.query(
      `insert into legal_evidence_events (
        order_id, document_key, document_path, document_hash, hash_algorithm,
        accepted, accepted_at, locale, source, acknowledgements)
       values ($1, 'termsAndConditions', '/terms', 'test', 'sha256',
         true, $2, 'en-US', 'payment_submit', $3)`,
      [
        id,
        acceptedAt,
        earlyPerformanceConsent
          ? {
              earlyPerformanceConsent: true,
              unlimitedPassEarlyStartRequested: true,
            }
          : {},
      ]
    );
    const product = { kind: "unlimited", tier } as const;
    await run(
      Effect.gen(function* () {
        const { transaction } = yield* WorkspaceDatabase;
        const snapshots = yield* AccountingDocumentSnapshots;
        yield* transaction(
          snapshots.recordPassPurchase({
            paymentAttemptId: attempt,
            orderId: id,
            dotyposCustomerId,
            locale: "en-US",
            amount: paid,
            snapshot: {
              orderId: id,
              dotyposCustomerId,
              locale: "en-US",
              supplier: workspaceAccountingSupplier,
              buyer:
                billing.purpose === "business"
                  ? billing.buyer
                  : { kind: "person", legalName: "Synthetic Buyer" },
              billing,
              delivery: { email: testEmailAddress("unlimited-buyer") },
              product,
              serviceDate: validFrom,
              quote: {
                product,
                discountableSubtotal: paid,
                discounts: [],
                totalDiscount: currencyCZK(0),
                discountedSubtotal: paid,
              },
            },
          })
        );
      })
    );
    return { id, attempt, buyer, holder };
  };

  const find = (id: string, accountId: CustomerAccountId) =>
    run(
      Effect.flatMap(UnlimitedPassWithdrawals, (family) =>
        family.find({ contractId: id, accountId, locale: "en-US" })
      )
    );

  const statementFor = async (
    pass: Awaited<ReturnType<typeof seedPass>>,
    submittedAt: Temporal.Instant
  ) => {
    const contract = Option.getOrThrow(await find(pass.id, pass.buyer));
    const assessment = contract.assess(submittedAt);
    if (!assessment.withdrawable) throw new Error(assessment.reason);
    return {
      contract: contract.ref,
      accountId: pass.buyer,
      locale: "en-US" as const,
      contractLabel: contract.label,
      statementName: "Synthetic Buyer",
      submittedAt,
      periodEndsAt: assessment.periodEndsAt,
      paidAmount: contract.paidAmount,
      refundAmount: assessment.refundAmount,
      refundBasis: assessment.refundBasis,
    };
  };

  type Statement = Awaited<ReturnType<typeof statementFor>>;
  const recordWithdrawal = (statement: Statement) =>
    Effect.flatMap(WithdrawalRepository, (repository) =>
      repository.record(statement)
    );
  const record = (statement: Statement) => run(recordWithdrawal(statement));
  const expectRefused = async (statement: Statement) => {
    const error = await run(Effect.flip(recordWithdrawal(statement)));
    expect(error._tag).toBe("WithdrawalContractChangedError");
  };
  const settleCancellation = (statement: Statement) =>
    run(
      Effect.flatMap(UnlimitedPassWithdrawals, (family) =>
        family.cancel({
          contractId: statement.contract.id,
          refundAmount: statement.refundAmount,
          refundBasis: statement.refundBasis,
        })
      )
    );

  const paymentAndCutoff = async (id: string) =>
    (
      await pool.query(
        `select pass_purchases.status, access_ends_on::text, refund_state, refund_target_value,
          refunded_amount_value from pass_purchases
         join orders on orders.id = pass_purchases.id
         join payment_attempts on payment_attempts.id = orders.active_payment_attempt_id
         where pass_purchases.id = $1`,
        [id]
      )
    ).rows[0];

  test("only the buyer can withdraw the gift, and before start all dates are released", async () => {
    const pass = await seedPass();
    expect(await find(pass.id, pass.holder)).toEqual(Option.none());
    const statement = await statementFor(pass, beforeStart);
    expect(statement.refundAmount).toEqual(amount);
    expect(statement.refundBasis).toEqual({ kind: "full" });
    await expectRefused({ ...statement, accountId: pass.holder });
    expect(await record(statement)).toMatchObject({ recorded: true });
    expect(await paymentAndCutoff(pass.id)).toEqual({
      status: "withdrawn",
      access_ends_on: "2027-03-27",
      refund_state: "required",
      refund_target_value: amount.value,
      refunded_amount_value: null,
    });
    // This period is empty even if the new 30-day window starts earlier
    // and covers the withdrawn pass's original start.
    const validFrom = plainDateStringSchema.make("2027-03-26");
    await run(
      Effect.gen(function* () {
        const { transaction } = yield* WorkspaceDatabase;
        yield* transaction(
          requireUnlimitedPassWindow({
            orderId: orderIdSchema.make(crypto.randomUUID()),
            holderAccountId: pass.holder,
            validFrom,
            validUntil: getUnlimitedPassEndDate(validFrom),
          })
        );
      })
    );
  });

  test("records one rounded-down refund across concurrent statements and keeps the current service day", async () => {
    const pass = await seedPass();
    const statement = await statementFor(pass, secondDay);
    expect(statement.refundAmount).toEqual(currencyCZK(280_000));
    expect(statement.refundBasis).toEqual({
      kind: "partial",
      unit: "day",
      unstarted: 28,
      total: 30,
    });
    const results = await Promise.all([record(statement), record(statement)]);
    expect(results.filter((result) => result.recorded)).toHaveLength(1);
    expect(results[0].withdrawal.id).toBe(results[1].withdrawal.id);
    expect(await paymentAndCutoff(pass.id)).toMatchObject({
      status: "withdrawn",
      access_ends_on: "2027-03-29",
      refund_state: "required",
      refund_target_value: 280_000,
    });

    await expect(settleCancellation(statement)).rejects.toThrow(
      "still has days to release"
    );
    await pool.query(
      `update workspace_reservations set reservation_state = 'cancelled'
       where pass_id = $1 and service_date > '2027-03-29'`,
      [pass.id]
    );
    await pool.query(
      `update workspace_reservations
       set reservation_state = 'hold_expired', dotypos_reservation_id = null
       where pass_id = $1 and service_date = '2027-03-29'`,
      [pass.id]
    );
    await pool.query(
      `insert into unlimited_pass_day_moves
       (generation, reservation_id, customer_id, source_reservation_id, source_table_id,
        target_reservation_id, target_table_id, requested_at, checked_at)
       select uuid_generate_v7(), id, dotypos_customer_id, dotypos_reservation_id,
         pass_day_table_id, 'synthetic-staged-hold', '10', now(), now()
       from workspace_reservations where pass_id = $1 and service_date = '2027-03-30'`,
      [pass.id]
    );
    await expect(settleCancellation(statement)).rejects.toThrow(
      "still has days to release"
    );
    await pool.query(
      "update unlimited_pass_day_moves set settled_at = now() where target_reservation_id = 'synthetic-staged-hold'"
    );
    await settleCancellation(statement);
    const remaining = await pool.query(
      `select service_date::text from workspace_reservations
       where pass_id = $1 and reservation_state = 'confirmed'
       order by service_date`,
      [pass.id]
    );
    expect(remaining.rows).toEqual([
      { service_date: "2027-03-27" },
      { service_date: "2027-03-28" },
    ]);
  });

  test("leaves a smaller back-office refund recorded and requires the remainder", async () => {
    const pass = await seedPass();
    await pool.query(
      `update payment_attempts set refund_state = 'refunded',
       refunded_amount_value = 10000, refunded_at = $2 where id = $1`,
      [pass.attempt, paidAt]
    );
    await record(await statementFor(pass, secondDay));
    expect(await paymentAndCutoff(pass.id)).toMatchObject({
      refund_state: "required",
      refund_target_value: 280_000,
      refunded_amount_value: 10_000,
    });
  });

  test("preserves an existing full refund obligation", async () => {
    const pass = await seedPass();
    await pool.query(
      "update payment_attempts set refund_state = 'required' where id = $1",
      [pass.attempt]
    );
    const statement = await statementFor(pass, secondDay);
    await record(statement);
    expect(await paymentAndCutoff(pass.id)).toMatchObject({
      refund_state: "required",
      refund_target_value: amount.value,
    });
  });

  test("keeps the cancellation pending when the ledger cutoff is missing", async () => {
    const pass = await seedPass();
    const statement = await statementFor(pass, secondDay);
    await record(statement);
    await pool.query(
      "update pass_purchases set access_ends_on = null where id = $1",
      [pass.id]
    );
    await expect(settleCancellation(statement)).rejects.toThrow(
      "pass or its cutoff is missing"
    );
  });

  test("rolls back the cutoff and refund when the withdrawal statement cannot be recorded", async () => {
    const pass = await seedPass();
    const statement = await statementFor(pass, secondDay);
    const error = await run(
      Effect.flip(
        recordWithdrawal({
          ...statement,
          refundBasis: {
            kind: "partial",
            unit: "day",
            unstarted: 30,
            total: 30,
          },
        })
      )
    );
    expect(error._tag).toBe("EffectDrizzleQueryError");
    expect(await paymentAndCutoff(pass.id)).toMatchObject({
      status: "active",
      access_ends_on: null,
      refund_state: "not_required",
      refund_target_value: null,
    });
  });

  test("refuses a previously quoted pass once its status changes", async () => {
    const pass = await seedPass();
    const statement = await statementFor(pass, secondDay);
    await pool.query(
      "update pass_purchases set status = 'cancelled' where id = $1",
      [pass.id]
    );
    await expectRefused(statement);
    expect(await paymentAndCutoff(pass.id)).toMatchObject({
      status: "cancelled",
      access_ends_on: null,
      refund_state: "not_required",
    });
  });

  test("withdraws a zero-payment pass without creating a provider refund", async () => {
    const pass = await seedPass(currencyCZK(0));
    await record(await statementFor(pass, secondDay));
    expect(await paymentAndCutoff(pass.id)).toMatchObject({
      status: "withdrawn",
      refund_state: "not_required",
      refund_target_value: null,
    });
  });

  test("starts the withdrawal period when the buyer receives the confirmation", async () => {
    const pass = await seedPass(amount, defaultReservationBillingSelection, {
      acceptedAt: "2027-03-20T09:00:00Z",
      deliveredAt: "2027-03-25T20:00:00Z",
    });
    const contract = Option.getOrThrow(await find(pass.id, pass.buyer));
    // Prague midnight after the fourteenth following calendar day.
    const cutoff = Temporal.Instant.from("2027-04-08T22:00:00Z");
    expect(contract.assess(cutoff.subtract({ seconds: 1 }))).toMatchObject({
      withdrawable: true,
      periodEndsAt: cutoff,
    });
    expect(contract.assess(cutoff)).toEqual({
      withdrawable: false,
      reason: "period_ended",
    });
  });

  test("does not offer online withdrawal while buyer confirmation delivery is unknown", async () => {
    const pass = await seedPass(amount, defaultReservationBillingSelection, {
      deliveredAt: null,
    });
    const contract = Option.getOrThrow(await find(pass.id, pass.buyer));
    expect(contract.assess(beforeStart)).toEqual({
      withdrawable: false,
      reason: "not_withdrawable",
    });
  });

  test("rechecks the deadline if an earlier delivery is verified after the quote", async () => {
    const pass = await seedPass();
    const statement = await statementFor(
      pass,
      Temporal.Instant.from("2027-04-08T10:00:00Z")
    );
    await pool.query(
      "update pass_purchases set buyer_confirmation_delivered_at = $2 where id = $1",
      [pass.id, "2027-03-24T18:00:00Z"]
    );
    await expectRefused(statement);
    expect(await paymentAndCutoff(pass.id)).toMatchObject({
      status: "active",
      access_ends_on: null,
      refund_state: "not_required",
    });
  });

  test("accepts withdrawal with a full refund when delayed delivery moves service inside the period", async () => {
    const pass = await seedPass(amount, defaultReservationBillingSelection, {
      purchasedAt: "2027-03-01T10:00:00Z",
      deliveredAt: "2027-03-03T10:00:00Z",
      startDate: "2027-03-16",
      earlyPerformanceConsent: false,
    });
    const statement = await statementFor(
      pass,
      Temporal.Instant.from("2027-03-16T10:00:00Z")
    );
    expect(statement).toMatchObject({
      refundAmount: amount,
      refundBasis: { kind: "full" },
    });
    expect(await record(statement)).toMatchObject({ recorded: true });
    expect(await paymentAndCutoff(pass.id)).toMatchObject({
      status: "withdrawn",
      access_ends_on: "2027-03-17",
      refund_state: "required",
      refund_target_value: amount.value,
    });
  });

  test("accepts a zero-refund statement on the final day before the tier closes", async () => {
    const pass = await seedPass(amount, defaultReservationBillingSelection, {
      deliveredAt: "2027-04-20T12:00:00Z",
      tier: "open-space",
    });
    const close = Temporal.Instant.from("2027-04-25T15:00:00Z");
    const contract = Option.getOrThrow(await find(pass.id, pass.buyer));
    expect(contract.assess(close)).toEqual({
      withdrawable: false,
      reason: "performance_started",
    });
    const statement = await statementFor(pass, close.subtract({ minutes: 1 }));
    const refundBasis = {
      kind: "partial",
      unit: "day",
      unstarted: 0,
      total: 30,
    };
    expect(statement).toMatchObject({
      refundAmount: currencyCZK(0),
      refundBasis,
    });
    await expectRefused({ ...statement, submittedAt: close });
    expect(await record(statement)).toMatchObject({
      recorded: true,
      withdrawal: { refundBasis },
    });
    await settleCancellation(statement);
    expect(await paymentAndCutoff(pass.id)).toMatchObject({
      status: "withdrawn",
      access_ends_on: "2027-04-26",
      refund_state: "not_required",
      refund_target_value: null,
    });
    const { rows } = await pool.query(
      `select reservation_state from workspace_reservations
       where pass_id = $1 and service_date = '2027-04-25'`,
      [pass.id]
    );
    expect(rows).toEqual([{ reservation_state: "confirmed" }]);
  });

  test.each([0, 24])(
    "accepts an in-time full refund %d hours after service ends without early performance consent",
    async (hours) => {
      const pass = await seedPass(amount, defaultReservationBillingSelection, {
        deliveredAt: "2027-04-20T12:00:00Z",
        earlyPerformanceConsent: false,
        tier: "open-space",
      });
      const close = Temporal.Instant.from("2027-04-25T15:00:00Z");
      const statement = await statementFor(pass, close.add({ hours }));
      expect(statement).toMatchObject({
        refundAmount: amount,
        refundBasis: { kind: "full" },
      });
      expect(await record(statement)).toMatchObject({
        recorded: true,
        withdrawal: { refundAmount: amount, refundBasis: { kind: "full" } },
      });
      await settleCancellation(statement);
      expect(await paymentAndCutoff(pass.id)).toMatchObject({
        status: "withdrawn",
        access_ends_on: "2027-04-26",
        refund_state: "required",
        refund_target_value: amount.value,
      });
    }
  );

  test("refuses consumer withdrawal from a business purchase", async () => {
    const pass = await seedPass(amount, {
      purpose: "business",
      invoice: "required",
      buyer: {
        kind: "business",
        legalName: "Synthetic Business",
        companyId: "12345678",
        address: {
          line1: "Test Street 1",
          city: "Prague",
          postalCode: "180 00",
          country: "CZ",
        },
      },
    });
    const contract = Option.getOrThrow(await find(pass.id, pass.buyer));
    expect(contract.assess(beforeStart)).toEqual({
      withdrawable: false,
      reason: "business_purpose",
    });
  });

  test("refuses a pass day as a standalone reservation withdrawal", async () => {
    const pass = await seedPass();
    const { rows } = await pool.query<{ id: string }>(
      "select id from workspace_reservations where pass_id = $1 limit 1",
      [pass.id]
    );
    const statement = await statementFor(pass, beforeStart);
    const day = rows[0];
    if (!day) throw new Error("Expected a pass day");
    await expectRefused({
      ...statement,
      contract: { kind: "reservation", id: day.id },
    });
  });
});
