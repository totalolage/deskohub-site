import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Result } from "effect";
import { coworkReservationOrderSchema as coworkReservationOrderDefinition } from "@/features/reservation/cowork-reservation";
import { makeSchemaParser } from "@/shared/utils/schema-parser";
import {
  deriveCheckoutAttemptKey,
  deriveCheckoutSessionKey,
} from "./checkout-session-key.server";

const coworkReservationOrderSchema = makeSchemaParser(
  coworkReservationOrderDefinition
);

const parseReservation = (input: Record<string, unknown>) => {
  const result = coworkReservationOrderSchema.safeParse(input);
  if (Result.isFailure(result)) {
    throw new Error(
      `Synthetic reservation fixture is invalid: ${result.failure}`
    );
  }
  return result.success;
};

const baseInput = {
  kind: "cowork",
  entryTier: "basic",
  date: "2099-06-10",
  coffee: false,
  name: "Synthetic Person",
  email: "synthetic@example.test",
  phone: "+420777777777",
  message: "Quiet desk, please.",
} as const;

const deriveAttempt = (reservationInput: Record<string, unknown>) =>
  deriveCheckoutAttemptKey({
    checkoutSessionId: "session-id",
    checkoutAttemptId: "attempt-id",
    reservation: parseReservation(reservationInput),
  });

describe("checkout reservation identity keys", () => {
  test("changes the attempt HMAC for every complete reservation identity field", () => {
    const base = deriveAttempt(baseInput);
    const fieldVariants = [
      { ...baseInput, name: "Different Synthetic Person" },
      { ...baseInput, email: "different@example.test" },
      { ...baseInput, phone: "+420777777778" },
      { ...baseInput, message: "Window desk, please." },
      { ...baseInput, date: "2099-06-11" },
      {
        ...baseInput,
        entryTier: "plus",
        coffee: true,
        monitorOption: undefined,
      },
      { ...baseInput, coffee: true },
      {
        ...baseInput,
        entryTier: "profi",
        coffee: true,
        monitorOption: "2x27-qhd",
      },
      {
        ...baseInput,
        entryTier: "profi",
        coffee: true,
        monitorOption: "2x32-qhd",
      },
    ];

    for (const variant of fieldVariants) {
      expect(deriveAttempt(variant)).not.toBe(base);
    }

    expect(deriveAttempt({ ...baseInput, coffee: true })).not.toBe(
      deriveAttempt({
        ...baseInput,
        entryTier: "plus",
        coffee: true,
        monitorOption: undefined,
      })
    );
    expect(
      deriveAttempt({
        ...baseInput,
        entryTier: "profi",
        coffee: true,
        monitorOption: "2x27-qhd",
      })
    ).not.toBe(
      deriveAttempt({
        ...baseInput,
        entryTier: "profi",
        coffee: true,
        monitorOption: "2x32-qhd",
      })
    );
  });

  test("rotates on a message-only edit while normalized equivalents reuse exactly", () => {
    const firstMessage = deriveAttempt(baseInput);
    const changedMessage = deriveAttempt({
      ...baseInput,
      message: "A different synthetic note.",
    });
    const normalizedWhitespace = deriveAttempt({
      ...baseInput,
      name: "  Synthetic Person  ",
      email: " synthetic@example.test ",
      phone: " +420777777777 ",
      message: "  Quiet desk, please.  ",
    });
    const omittedMessage = deriveAttempt({
      ...baseInput,
      message: undefined,
    });
    const blankMessage = deriveAttempt({
      ...baseInput,
      message: "   ",
    });

    expect(changedMessage).not.toBe(firstMessage);
    expect(normalizedWhitespace).toBe(firstMessage);
    expect(blankMessage).toBe(omittedMessage);
  });

  test("keeps stable session identity distinct from per-attempt identity", () => {
    const sessionKey = deriveCheckoutSessionKey("session-id");
    const editedAttempt = deriveAttempt({
      ...baseInput,
      message: "Edited synthetic note.",
    });

    expect(deriveCheckoutSessionKey("session-id")).toBe(sessionKey);
    expect(editedAttempt).not.toBe(deriveAttempt(baseInput));
    expect(
      deriveCheckoutAttemptKey({
        checkoutSessionId: "session-id",
        checkoutAttemptId: "different-attempt-id",
        reservation: parseReservation(baseInput),
      })
    ).not.toBe(deriveAttempt(baseInput));
  });
});
