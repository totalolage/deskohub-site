import { sql } from "drizzle-orm";
import type { PostgresAdvisoryLockKey } from "@/db/postgres-advisory-lock";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";

export const referralGraphAdvisoryLockKey: PostgresAdvisoryLockKey = [
  "referral-attribution",
  "graph",
];

export const referralFirstBookingLockKey = (
  customerId: DotyposCustomerId
): PostgresAdvisoryLockKey => ["referral-first-booking", customerId];

export const referralAdvisoryLockStatement = (key: PostgresAdvisoryLockKey) => {
  const [namespace, lockKey] = key;
  return sql`select pg_advisory_xact_lock(hashtext(${namespace}), hashtext(${lockKey}))`;
};

export const referralFirstBookingLockStatement = (
  customerId: DotyposCustomerId
) => referralAdvisoryLockStatement(referralFirstBookingLockKey(customerId));
