import { describe, expect, test } from "bun:test";
import type { FieldErrors } from "react-hook-form";
import { getInvalidFormFields } from "./form-field-errors";

type Values = {
  readonly name: string;
  readonly email: string;
  readonly billing: { readonly companyId: string; readonly vatId: string };
  readonly seats: readonly { readonly label: string }[];
};

describe("getInvalidFormFields", () => {
  test("lists every rejected field by dotted path with its message", () => {
    const errors: FieldErrors<Values> = {
      name: { type: "required", message: "Enter your name." },
      billing: {
        companyId: { type: "pattern", message: "Enter a valid company ID." },
      },
      seats: [{ label: { type: "required", message: "Name the seat." } }],
    };

    expect(getInvalidFormFields(errors)).toEqual([
      { name: "name", message: "Enter your name." },
      { name: "billing.companyId", message: "Enter a valid company ID." },
      { name: "seats.0.label", message: "Name the seat." },
    ]);
  });

  test("keeps a field without a text message", () => {
    expect(
      getInvalidFormFields<Values>({ email: { type: "required" } })
    ).toEqual([{ name: "email" }]);
  });

  test("gives nothing for a valid form", () => {
    expect(getInvalidFormFields<Values>({})).toEqual([]);
  });
});
