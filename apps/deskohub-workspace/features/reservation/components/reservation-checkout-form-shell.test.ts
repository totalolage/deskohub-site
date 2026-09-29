import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..", "..");

describe("ReservationCheckoutForm shell slot and message placeholder", () => {
  test("does not declare afterCustomerFields or messagePlaceholder props", () => {
    const source = readFileSync(
      join(
        root,
        "features/reservation/components/reservation-checkout-form.tsx"
      ),
      "utf8"
    );
    expect(source).not.toContain("afterCustomerFields");
    expect(source).not.toContain("messagePlaceholder");
  });

  test("meeting-room form does not pass messagePlaceholder", () => {
    const source = readFileSync(
      join(
        root,
        "features/meeting-room/components/meeting-room-reservation-form.tsx"
      ),
      "utf8"
    );
    expect(source).not.toContain("messagePlaceholder");
  });

  test("office form does not pass messagePlaceholder", () => {
    const source = readFileSync(
      join(root, "features/office/components/office-reservation-form.tsx"),
      "utf8"
    );
    expect(source).not.toContain("messagePlaceholder");
  });
});
