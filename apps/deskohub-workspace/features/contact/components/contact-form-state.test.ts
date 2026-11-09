import { describe, expect, test } from "bun:test";
import type { ContactFormState } from "@/features/contact/actions/contact";
import { m } from "@/features/i18n";
import { resolveContactFormState } from "./contact-form-state";

describe("resolveContactFormState", () => {
  test("uses native success state when the hydrated state action has no outcome", () => {
    const success: ContactFormState = {
      status: "success",
      message: m.contactSuccessMessage({}, { locale: "en-US" }),
    };

    expect(
      resolveContactFormState({}, { data: success }, "Send failed.")
    ).toEqual(success);
  });

  test("projects server validation values and messages from either action state", () => {
    const locale = "cs-CZ";
    const validationError: ContactFormState = {
      status: "error",
      message: m.contactValidationReviewMessage({}, { locale }),
      values: {
        name: " S ",
        email: "bad",
        phone: "",
        message: " short ",
      },
      fieldErrors: {
        name: m.contactValidationNameMinimum({ min: 2 }, { locale }),
        email: m.contactValidationEmailInvalid({}, { locale }),
      },
    };
    const nativeSuccess: ContactFormState = {
      status: "success",
      message: m.contactSuccessMessage({}, { locale }),
    };

    expect(
      resolveContactFormState({}, { data: validationError }, "Send failed.")
    ).toEqual(validationError);
    expect(
      resolveContactFormState(
        { data: validationError },
        { data: nativeSuccess },
        "Send failed."
      )
    ).toEqual(validationError);
  });

  test("keeps hydrated action errors authoritative over the native fallback", () => {
    const genericError = "The contact request could not be sent.";
    const nativeSuccess: ContactFormState = {
      status: "success",
      message: m.contactSuccessMessage({}, { locale: "en-US" }),
    };

    expect(
      resolveContactFormState(
        { serverError: "internal" },
        { data: nativeSuccess },
        genericError
      )
    ).toEqual({ status: "error", message: genericError });
  });
});
