import { expect, test } from "bun:test";
import { EmailValueName } from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import { suggestedEmailValueName } from "./email-value-names";

const isValueName = Schema.is(EmailValueName);

test("names a customer value after its field's last path segment", () => {
  expect(
    suggestedEmailValueName(["profile", "customer", "displayName"], [])
  ).toBe("display_name");
  expect(suggestedEmailValueName(["activity", "reservations"], [])).toBe(
    "reservations"
  );
  expect(suggestedEmailValueName("discount", [])).toBe("discount");
});

test("numbers a suggestion while another definition has its name", () => {
  expect(
    suggestedEmailValueName(
      ["activity", "reservations"],
      ["reservations", "reservations_2", undefined]
    )
  ).toBe("reservations_3");
  expect(suggestedEmailValueName("discount", ["discount"])).toBe("discount_2");
});

test("suggests only valid value names", () => {
  for (const segment of ["2fa", "", "__", "ÚčetX", "a".repeat(90)])
    expect(isValueName(suggestedEmailValueName([segment], []))).toBe(true);
  expect(isValueName(suggestedEmailValueName([], ["value"]))).toBe(true);
});
