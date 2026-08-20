import { describe, expect, test } from "bun:test";
import { Option, Schema } from "effect";
import { EmailDeliveryIdSchema } from "./email.types";

describe("EmailDeliveryIdSchema", () => {
  test("decodes non-empty provider delivery identifiers", () => {
    const deliveryId = Schema.decodeUnknownSync(EmailDeliveryIdSchema)(
      "delivery-id"
    );

    expect(deliveryId).toBe(EmailDeliveryIdSchema.make("delivery-id"));
  });

  test("rejects empty delivery identifiers", () => {
    expect(
      Option.isNone(Schema.decodeUnknownOption(EmailDeliveryIdSchema)(""))
    ).toBeTrue();
  });
});
