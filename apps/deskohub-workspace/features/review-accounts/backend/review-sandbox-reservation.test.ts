import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import {
  getReviewSampleReservations,
  isReviewSampleOrderId,
} from "./review-sandbox-reservation";

const reviewer = customerAccountIdSchema.make("review-account-a");
const otherReviewer = customerAccountIdSchema.make("review-account-b");
const now = Temporal.Instant.from("2026-10-22T10:00:00Z");

describe("getReviewSampleReservations", () => {
  test("shows one past and one upcoming booking, dated from today", () => {
    const samples = getReviewSampleReservations(reviewer, now);

    expect(
      samples.filter(({ endsAt }) => Temporal.Instant.compare(endsAt, now) < 0)
    ).toHaveLength(1);
    expect(
      samples.filter(
        ({ startsAt }) => Temporal.Instant.compare(startsAt, now) > 0
      )
    ).toHaveLength(1);
  });

  test("keeps each sample's order ID across days and apart from other accounts", () => {
    const ids = getReviewSampleReservations(reviewer, now).map(
      ({ orderId }) => orderId
    );
    const nextWeek = getReviewSampleReservations(
      reviewer,
      now.add({ hours: 24 * 7 })
    ).map(({ orderId }) => orderId);
    const otherIds = getReviewSampleReservations(otherReviewer, now).map(
      ({ orderId }) => orderId
    );

    expect(nextWeek).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(otherIds.some((id) => ids.includes(id))).toBe(false);
    expect(ids.every(isReviewSampleOrderId)).toBe(true);
  });
});
