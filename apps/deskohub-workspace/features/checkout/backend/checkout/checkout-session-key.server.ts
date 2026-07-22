import "server-only";

import { createHmac } from "node:crypto";
import { env } from "@/env";
import type { NormalizedCoworkReservationOrder } from "@/features/reservation/cowork-reservation";

const deriveCheckoutKey = (payload: object) =>
  createHmac("sha256", env.CHECKOUT_PAY_STATE_KEYS)
    .update(JSON.stringify(payload))
    .digest("hex");

export const deriveCheckoutSessionKey = (checkoutSessionId: string) =>
  deriveCheckoutKey({
    schema: "workspace-checkout-session-key",
    schemaVersion: 1,
    checkoutSessionId,
  });

export const deriveCheckoutAttemptKey = (input: {
  readonly checkoutSessionId: string;
  readonly checkoutAttemptId: string;
  readonly reservation: NormalizedCoworkReservationOrder;
}) =>
  deriveCheckoutKey({
    schema: "workspace-checkout-attempt-key",
    schemaVersion: 1,
    checkoutSessionId: input.checkoutSessionId,
    checkoutAttemptId: input.checkoutAttemptId,
    reservation: {
      kind: input.reservation.kind,
      name: input.reservation.name,
      email: input.reservation.email,
      phone: input.reservation.phone,
      date: input.reservation.date,
      entryTier: input.reservation.entryTier,
      coffee: input.reservation.coffee,
      monitorOption: input.reservation.monitorOption ?? null,
    },
  });
