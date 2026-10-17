import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compares a presented secret with the configured one in constant time.
 * Comparing fixed-length digests keeps the timing independent of where the
 * values differ and of either value's length.
 */
export const isMatchingSecret = (presented: string, configured: string) =>
  timingSafeEqual(digestSecret(presented), digestSecret(configured));

const digestSecret = (value: string) =>
  createHash("sha256").update(value, "utf8").digest();
