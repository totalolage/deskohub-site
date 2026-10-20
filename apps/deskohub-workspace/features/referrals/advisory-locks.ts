import {
  type PostgresAdvisoryLockKey,
  postgresAdvisoryTransactionLockStatement,
} from "@/db/postgres-advisory-lock";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";

export const referralGraphAdvisoryLockKey: PostgresAdvisoryLockKey = [
  "referral-attribution",
  "graph",
];

export const referralFirstBookingLockKey = (
  customerId: DotyposCustomerId
): PostgresAdvisoryLockKey => ["referral-first-booking", customerId];

export { postgresAdvisoryTransactionLockStatement as referralAdvisoryLockStatement } from "@/db/postgres-advisory-lock";

export const referralFirstBookingLockStatement = (
  customerId: DotyposCustomerId
) =>
  postgresAdvisoryTransactionLockStatement(
    referralFirstBookingLockKey(customerId)
  );
