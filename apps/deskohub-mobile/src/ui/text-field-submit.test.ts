import { expect, test } from "bun:test";
import { textFieldSubmit } from "./text-field-submit";

test("an editable field submits", () => {
  const submit = () => {};
  expect(textFieldSubmit(true, submit)).toBe(submit);
  expect(textFieldSubmit(undefined, submit)).toBe(submit);
});

test("a read-only field submits nothing when Enter is pressed", () => {
  expect(textFieldSubmit(false, () => {})).toBeUndefined();
});
