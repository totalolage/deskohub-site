import { Effect, Order } from "effect";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { WorkspaceTransaction } from "./database.service";
import type { DatabaseQueryError } from "./sql-constraint";
import {
  holdSection,
  type LockWait,
  type TransactionLockRequest,
  takeTransactionLock,
} from "./workspace-lock-ledger";

type TransactionLock = Effect.Effect<
  void,
  DatabaseQueryError,
  WorkspaceTransaction
>;

/** Reads the marker so every lock requires an open Workspace transaction. */
const take = (lock: TransactionLockRequest): TransactionLock =>
  Effect.andThen(WorkspaceTransaction, takeTransactionLock(lock));

const customerAccount = (accountId: CustomerAccountId): TransactionLock =>
  take({
    name: "customerAccount",
    rank: 20,
    pair: ["customer-account", accountId],
  });

/**
 * Advisory locks held until the current Workspace transaction ends. Take them
 * in ascending rank; equal ranks in ascending key. Each keeps its
 * pre-registry encoding exactly, so old and new code lock the same key during
 * a rollout.
 */
export const WorkspaceLocks = {
  referralGraph: (wait?: LockWait): TransactionLock =>
    take({
      name: "referralGraph",
      rank: 10,
      pair: ["referral-attribution", "graph"],
      wait,
    }),
  customerAccount,
  /** Every account, deduplicated, in ascending ID order. */
  customerAccounts: (
    accountIds: Iterable<CustomerAccountId>
  ): TransactionLock =>
    Effect.forEach(
      Array.from(new Set(accountIds)).sort(Order.String),
      customerAccount,
      { discard: true }
    ),
  referralFirstBooking: (customerId: DotyposCustomerId): TransactionLock =>
    take({
      name: "referralFirstBooking",
      rank: 30,
      pair: ["referral-first-booking", customerId],
    }),
  checkoutSession: (lockKey: bigint): TransactionLock =>
    take({ name: "checkoutSession", rank: 40, bigint: lockKey }),
  manualInvoiceCreation: (invoiceId: string): TransactionLock =>
    take({
      name: "manualInvoiceCreation",
      rank: 50,
      pair: ["manual-invoice-creation", invoiceId],
    }),
  manualInvoiceNewCustomer: (): TransactionLock =>
    take({
      name: "manualInvoiceNewCustomer",
      rank: 51,
      pair: ["manual-invoice-new-customer", "global"],
    }),
  /** A single `hashtext` key, sharing the one-bigint space with `checkoutSession`. */
  manualInvoiceIssue: (invoiceId: string): TransactionLock =>
    take({ name: "manualInvoiceIssue", rank: 52, hashed: invoiceId }),
  automationFireEntry: (campaignId: string): TransactionLock =>
    take({
      name: "automationFireEntry",
      rank: 60,
      pair: ["email-automation-fire-entry", campaignId],
    }),
  requestBudget: (policyKey: string): TransactionLock =>
    take({
      name: "requestBudget",
      rank: 70,
      pair: ["request-budget", policyKey],
    }),
  standaloneAccessCodeDevice: (deviceWindowKey: string): TransactionLock =>
    take({
      name: "standaloneAccessCodeDevice",
      rank: 80,
      pair: ["standalone-access-code", deviceWindowKey],
    }),
  legacyAdministrator: (legacyUsername: string): TransactionLock =>
    take({
      name: "legacyAdministrator",
      rank: 85,
      pair: ["legacy-administrator", legacyUsername],
    }),
  /** Always the transaction's last lock. */
  automationUnitSlots: (): TransactionLock =>
    take({
      name: "automationUnitSlots",
      rank: 90,
      pair: ["email-automation-unit-slots", "engine"],
    }),
} as const;

/**
 * Session-held sections on a dedicated connection, for a lock held across
 * non-transactional work. They never provide `WorkspaceTransaction`; enter
 * them outside every Workspace transaction.
 */
export const WorkspaceLockSections = {
  signInEmail: (addressDigest: string) =>
    holdSection({
      name: "signInEmail",
      rank: 0,
      pair: ["sign-in-email", addressDigest],
    }),
  customerAccount: (accountId: CustomerAccountId) =>
    holdSection({
      name: "customerAccount",
      rank: 20,
      pair: ["customer-account", accountId],
    }),
} as const;
