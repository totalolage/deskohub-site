import { describe, expect, test } from "bun:test";
import {
  type MutationFormFeedback,
  reconcileMutationFormFeedback,
} from "./mutation-form-feedback";

type Values = { readonly code: string };

const shownValues: Values = { code: "SUMMER10" };

describe("reconcileMutationFormFeedback", () => {
  test("keeps the absence of feedback", () => {
    expect(reconcileMutationFormFeedback(null, shownValues)).toBeNull();
  });

  test("adopts the values new feedback first renders with", () => {
    const feedback: MutationFormFeedback<Values> = {
      kind: "success",
      message: "Saved.",
    };

    expect(reconcileMutationFormFeedback(feedback, shownValues)).toEqual({
      ...feedback,
      formValues: shownValues,
    });
  });

  test("keeps the same feedback while its values stay unchanged", () => {
    const feedback: MutationFormFeedback<Values> = {
      kind: "error",
      message: "Check the form.",
      formValues: shownValues,
    };

    expect(reconcileMutationFormFeedback(feedback, shownValues)).toBe(feedback);
  });

  test("clears feedback once the operator edits the values it was shown with", () => {
    expect(
      reconcileMutationFormFeedback(
        { kind: "error", message: "Check the form.", formValues: shownValues },
        { code: "SUMMER11" }
      )
    ).toBeNull();
  });
});
