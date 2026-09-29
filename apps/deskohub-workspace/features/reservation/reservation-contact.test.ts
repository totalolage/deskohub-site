import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { droppingRetiredReservationCustomerMessage } from "./reservation-contact";

describe("dropping retired reservation customer message", () => {
  test("removes only message before decoding an object", () => {
    const decode = Schema.decodeUnknownSync(
      droppingRetiredReservationCustomerMessage(
        Schema.Struct({ name: Schema.String })
      ),
      { onExcessProperty: "error" }
    );

    expect(decode({ name: "Ada", message: "Legacy note" })).toEqual({
      name: "Ada",
    });
    expect(() =>
      decode({ name: "Ada", message: "Legacy note", extra: true })
    ).toThrow();
  });

  test("leaves arrays and primitive input unchanged for decoding", () => {
    const decodeArray = Schema.decodeUnknownSync(
      droppingRetiredReservationCustomerMessage(Schema.Array(Schema.String))
    );
    const decodeString = Schema.decodeUnknownSync(
      droppingRetiredReservationCustomerMessage(Schema.String)
    );

    expect(decodeArray(["legacy"])).toEqual(["legacy"]);
    expect(decodeString("legacy")).toBe("legacy");
  });
});
