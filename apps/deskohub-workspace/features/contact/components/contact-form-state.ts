import type { ContactFormState } from "@/features/contact/actions/contact";
import type { submitContactForm } from "@/features/contact/actions/submit-contact";

type ContactActionResult = Awaited<ReturnType<typeof submitContactForm>>;

export const resolveContactFormState = (
  hydratedResult: ContactActionResult,
  nativeResult: ContactActionResult,
  serverErrorMessage: string
): ContactFormState => {
  const hydratedHasOutcome =
    hydratedResult.data !== undefined ||
    hydratedResult.serverError !== undefined ||
    hydratedResult.validationErrors !== undefined;
  const result = hydratedHasOutcome ? hydratedResult : nativeResult;

  if (result.data !== undefined) return result.data;
  if (
    result.serverError !== undefined ||
    result.validationErrors !== undefined
  ) {
    return { status: "error", message: serverErrorMessage };
  }

  return { status: "idle" };
};
